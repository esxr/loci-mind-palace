import type { ConceptGraph } from "../_shared/types.ts";

// ---------------------------------------------------------------------------
// System prompt (from spec Section 1.2, Stage 1)
// ---------------------------------------------------------------------------
const ENRICHMENT_SYSTEM_PROMPT = `You are a spatial architect for a memory palace. Given a concept graph, enrich it with spatial metadata that will guide a layout algorithm.

For each concept, add:
- spatial_hint: one of "central" (should be near the center), "gateway" (connects major clusters), "peripheral" (edge of the map), "standard" (no special placement)
- display_size: "large" | "medium" | "small" based on importance

For each relationship, add:
- corridor_style: "wide" (strong connection) | "narrow" (weak connection) | "bridge" (cross-cluster)

Also identify 1-3 concepts that should serve as the entry points (where the user spawns).

Return the enriched graph as JSON.`;

// ---------------------------------------------------------------------------
// Tool schema for structured output
// ---------------------------------------------------------------------------
const ENRICH_TOOL = {
  name: "enrich_concept_graph",
  description:
    "Enrich a concept graph with spatial metadata for mind palace layout",
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
            spatial_hint: {
              type: "string" as const,
              enum: ["central", "gateway", "peripheral", "standard"],
            },
            display_size: {
              type: "string" as const,
              enum: ["large", "medium", "small"],
            },
          },
          required: [
            "id",
            "name",
            "description",
            "importance",
            "cluster_label",
            "source_notes",
            "spatial_hint",
            "display_size",
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
            corridor_style: {
              type: "string" as const,
              enum: ["wide", "narrow", "bridge"],
            },
          },
          required: [
            "source_id",
            "target_id",
            "type",
            "strength",
            "corridor_style",
          ],
        },
      },
      entry_points: {
        type: "array" as const,
        items: { type: "string" as const },
        description: "1-3 concept IDs that should serve as entry/spawn points",
      },
    },
    required: ["concepts", "relationships", "entry_points"],
  },
};

// ---------------------------------------------------------------------------
// Retry helper for Claude API
// ---------------------------------------------------------------------------
const MAX_RETRIES = 2;
const CLAUDE_TIMEOUT_MS = 25_000; // keep under the 55s total budget

async function callClaudeWithRetry(
  payload: Record<string, unknown>,
  apiKey: string,
): Promise<Record<string, unknown>> {
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

      if (res.status === 429 || res.status === 529) {
        const retryAfter = res.headers.get("retry-after");
        const delayMs = retryAfter
          ? Math.min(Number(retryAfter) * 1000, 10_000)
          : Math.min(1000 * 2 ** attempt, 8000);

        lastError = `Claude API returned ${res.status}`;
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        throw new Error(
          `Claude API returned ${res.status} after ${MAX_RETRIES + 1} attempts`,
        );
      }

      if (!res.ok) {
        const body = await res.text();
        throw new Error(
          `Claude API error (${res.status}): ${body.slice(0, 200)}`,
        );
      }

      return await res.json();
    } catch (err: unknown) {
      clearTimeout(timer);

      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error("Claude enrichment call timed out");
      }

      lastError = String(err);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      throw err;
    }
  }

  throw new Error(
    `Claude enrichment failed after ${MAX_RETRIES + 1} attempts: ${lastError}`,
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface EnrichmentResult {
  graph: ConceptGraph;
  entry_points: string[];
}

/**
 * Stage 1: Call Claude Sonnet to enrich a concept graph with spatial metadata.
 *
 * Adds spatial_hint and display_size to each concept, corridor_style to each
 * relationship, and identifies 1-3 entry point concepts.
 */
export async function enrichConceptGraph(
  graph: ConceptGraph,
): Promise<EnrichmentResult> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("Server misconfiguration: missing ANTHROPIC_API_KEY");
  }

  const userContent = JSON.stringify(graph, null, 2);

  const payload = {
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    temperature: 0.3,
    system: ENRICHMENT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
    tools: [ENRICH_TOOL],
    tool_choice: { type: "tool", name: "enrich_concept_graph" },
  };

  const data = await callClaudeWithRetry(payload, apiKey);

  // Extract the tool_use block
  const content = data.content as Array<{
    type: string;
    input?: Record<string, unknown>;
  }>;
  const toolUseBlock = content?.find((b) => b.type === "tool_use");

  if (!toolUseBlock?.input) {
    throw new Error("Claude did not return a valid tool_use block");
  }

  const enriched = toolUseBlock.input as {
    concepts: ConceptGraph["concepts"];
    relationships: ConceptGraph["relationships"];
    entry_points: string[];
  };

  // Validate structure
  if (
    !Array.isArray(enriched.concepts) ||
    !Array.isArray(enriched.relationships)
  ) {
    throw new Error(
      "Enriched graph is missing concepts or relationships array",
    );
  }

  // Ensure every concept has spatial fields (fallback if Claude missed any)
  for (const concept of enriched.concepts) {
    if (!concept.spatial_hint) concept.spatial_hint = "standard";
    if (!concept.display_size) {
      concept.display_size =
        concept.importance >= 8
          ? "large"
          : concept.importance >= 5
            ? "medium"
            : "small";
    }
  }

  // Ensure every relationship has corridor_style
  for (const rel of enriched.relationships) {
    if (!rel.corridor_style) {
      rel.corridor_style =
        rel.strength >= 7 ? "wide" : rel.strength >= 4 ? "narrow" : "bridge";
    }
  }

  // Ensure entry_points exist and reference valid concepts
  const conceptIds = new Set(enriched.concepts.map((c) => c.id));
  let entryPoints = (enriched.entry_points || []).filter((id) =>
    conceptIds.has(id),
  );
  if (entryPoints.length === 0) {
    // Fallback: pick the most important concept
    const sorted = [...enriched.concepts].sort(
      (a, b) => b.importance - a.importance,
    );
    entryPoints = [sorted[0].id];
  }

  return {
    graph: {
      concepts: enriched.concepts,
      relationships: enriched.relationships,
    },
    entry_points: entryPoints,
  };
}
