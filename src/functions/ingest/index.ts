import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import type {
  IngestRequest,
  IngestResponse,
  ConceptGraph,
} from "../_shared/types.ts";

// ---------------------------------------------------------------------------
// Rate limiting (in-memory, acceptable for single-user edge function)
// ---------------------------------------------------------------------------
const requestCounts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10; // max requests per window
const RATE_WINDOW_MS = 60_000; // 1 minute

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = requestCounts.get(ip);

  if (!entry || now >= entry.resetAt) {
    requestCounts.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }

  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_CONTENT_BYTES = 100_000; // 100 KB
const MAX_CONCEPTS = 50;
const CLAUDE_TIMEOUT_MS = 30_000; // 30 seconds
const MAX_RETRIES = 2; // retry up to 2 times on 429/529

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a JSON error Response with CORS headers. */
function errorResponse(
  code: string,
  message: string,
  status: number,
): Response {
  return new Response(
    JSON.stringify({ code, message }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

/** Call Claude API with retries on 429/529 and an AbortController timeout. */
async function callClaude(
  payload: Record<string, unknown>,
  apiKey: string,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: Response }> {
  let lastError: string | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS);

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      // Retryable status codes: 429 (rate limited) and 529 (overloaded)
      if (res.status === 429 || res.status === 529) {
        // Respect Retry-After header if present, otherwise exponential backoff
        const retryAfter = res.headers.get("retry-after");
        const delayMs = retryAfter
          ? Math.min(Number(retryAfter) * 1000, 10_000)
          : Math.min(1000 * 2 ** attempt, 8000);

        lastError = `Claude API returned ${res.status}`;

        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        // Exhausted retries
        return {
          ok: false,
          error: errorResponse(
            "EXTRACTION_FAILED",
            `Claude API returned ${res.status} after ${MAX_RETRIES + 1} attempts`,
            422,
          ),
        };
      }

      if (!res.ok) {
        const body = await res.text();
        return {
          ok: false,
          error: errorResponse(
            "EXTRACTION_FAILED",
            `Claude API error (${res.status}): ${body.slice(0, 200)}`,
            422,
          ),
        };
      }

      const data = await res.json();
      return { ok: true, data };
    } catch (err: unknown) {
      clearTimeout(timer);

      // AbortController fires a DOMException with name "AbortError"
      if (err instanceof DOMException && err.name === "AbortError") {
        return {
          ok: false,
          error: errorResponse("TIMEOUT", "Claude API call exceeded 30 s timeout", 504),
        };
      }

      lastError = String(err);

      // Network errors are retryable
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
    }
  }

  return {
    ok: false,
    error: errorResponse(
      "EXTRACTION_FAILED",
      `Claude API call failed after ${MAX_RETRIES + 1} attempts: ${lastError}`,
      422,
    ),
  };
}

// ---------------------------------------------------------------------------
// System prompt (from spec Section 1.1)
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are a knowledge graph extractor. Given a collection of study notes, extract:
1. Concepts: the key ideas, terms, entities, and topics discussed.
2. Relationships: how concepts relate to each other.

For each concept, provide:
- A unique snake_case id
- A human-readable name
- A 1-2 sentence description grounded in the source notes
- An importance score from 1-10 (10 = central/foundational, 1 = peripheral/minor)
- A cluster_label grouping it with related concepts (e.g. "cell_biology", "organic_chemistry")
- The titles of source notes it appears in

For each relationship, provide:
- source and target concept IDs
- type: one of "prerequisite", "contains", "relates_to", "example_of", "contrasts_with"
- strength: 1-10 (10 = tightly coupled, 1 = loose association)

Return at most 50 concepts. Prioritize foundational concepts over peripheral details.`;

// ---------------------------------------------------------------------------
// Tool schema for structured output
// ---------------------------------------------------------------------------
const EXTRACT_TOOL = {
  name: "extract_concept_graph",
  description: "Extract a structured concept graph from study notes",
  input_schema: {
    type: "object" as const,
    properties: {
      concepts: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            id: { type: "string" as const },
            name: { type: "string" as const },
            description: { type: "string" as const },
            importance: { type: "number" as const },
            cluster_label: { type: "string" as const },
            source_notes: {
              type: "array" as const,
              items: { type: "string" as const },
            },
          },
          required: [
            "id",
            "name",
            "description",
            "importance",
            "cluster_label",
            "source_notes",
          ],
        },
      },
      relationships: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            source_id: { type: "string" as const },
            target_id: { type: "string" as const },
            type: {
              type: "string" as const,
              enum: [
                "prerequisite",
                "contains",
                "relates_to",
                "example_of",
                "contrasts_with",
              ],
            },
            strength: { type: "number" as const },
          },
          required: ["source_id", "target_id", "type", "strength"],
        },
      },
    },
    required: ["concepts", "relationships"],
  },
};

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  // 1. CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // 2. Rate limiting by IP
    const ip = req.headers.get("x-forwarded-for") ?? "unknown";
    if (isRateLimited(ip)) {
      return errorResponse("RATE_LIMITED", "Too many requests — limit is 10/min", 429);
    }

    // 3. Parse & validate request body
    let body: IngestRequest;
    try {
      body = await req.json();
    } catch {
      return errorResponse("EMPTY_NOTES", "Invalid or missing JSON body", 400);
    }

    if (!body.notes || !Array.isArray(body.notes) || body.notes.length === 0) {
      return errorResponse("EMPTY_NOTES", "No notes provided", 400);
    }

    // Validate individual notes have required fields
    for (const note of body.notes) {
      if (typeof note.title !== "string" || typeof note.content !== "string") {
        return errorResponse(
          "EMPTY_NOTES",
          "Each note must have a string title and content",
          400,
        );
      }
    }

    // 4. Check total content size (100 KB limit)
    const totalSize = body.notes.reduce((sum, n) => sum + n.content.length, 0);
    if (totalSize > MAX_CONTENT_BYTES) {
      return errorResponse(
        "NOTES_TOO_LARGE",
        `Total content size (${totalSize} chars) exceeds the 100 KB limit`,
        400,
      );
    }

    // 5. Concatenate notes with title delimiters
    const concatenated = body.notes
      .map((n) => `--- ${n.title} ---\n${n.content}`)
      .join("\n\n");

    // 6. Call Claude Haiku for concept extraction
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return errorResponse(
        "EXTRACTION_FAILED",
        "Server misconfiguration: missing ANTHROPIC_API_KEY",
        422,
      );
    }

    const claudePayload = {
      model: "claude-haiku-4-20250414",
      max_tokens: 4096,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: concatenated }],
      tools: [EXTRACT_TOOL],
      tool_choice: { type: "tool", name: "extract_concept_graph" },
    };

    const result = await callClaude(claudePayload, apiKey);
    if (!result.ok) return result.error;

    // 7. Extract tool_use block from response
    const content = result.data.content as Array<{ type: string; input?: unknown }>;
    const toolUseBlock = content?.find((b) => b.type === "tool_use");

    if (!toolUseBlock?.input) {
      return errorResponse(
        "EXTRACTION_FAILED",
        "Claude did not return a valid tool_use block",
        422,
      );
    }

    const graph = toolUseBlock.input as ConceptGraph;

    // Basic structural validation
    if (!Array.isArray(graph.concepts) || !Array.isArray(graph.relationships)) {
      return errorResponse(
        "EXTRACTION_FAILED",
        "Extracted graph is missing concepts or relationships array",
        422,
      );
    }

    // 8. Enforce NFC-10: max 50 concepts, truncate by importance
    if (graph.concepts.length > MAX_CONCEPTS) {
      graph.concepts.sort((a, b) => b.importance - a.importance);
      graph.concepts = graph.concepts.slice(0, MAX_CONCEPTS);
      const keptIds = new Set(graph.concepts.map((c) => c.id));
      graph.relationships = graph.relationships.filter(
        (r) => keptIds.has(r.source_id) && keptIds.has(r.target_id),
      );
    }

    // Also prune relationships that reference non-existent concepts
    const allConceptIds = new Set(graph.concepts.map((c) => c.id));
    graph.relationships = graph.relationships.filter(
      (r) => allConceptIds.has(r.source_id) && allConceptIds.has(r.target_id),
    );

    // 9. Persist to Supabase
    const supabase = getSupabaseClient();
    const graphId = crypto.randomUUID();

    const { error: dbError } = await supabase.from("palaces").insert({
      id: graphId,
      concept_graph: graph,
      concept_count: graph.concepts.length,
      status: "generating",
      name: body.notes[0]?.title || "Untitled Palace",
    });

    if (dbError) {
      return errorResponse(
        "EXTRACTION_FAILED",
        `Database insert failed: ${dbError.message}`,
        422,
      );
    }

    // 10. Return response
    const response: IngestResponse = {
      graph_id: graphId,
      concept_graph: graph,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    // Catch-all for unexpected failures
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse("EXTRACTION_FAILED", message, 422);
  }
});
