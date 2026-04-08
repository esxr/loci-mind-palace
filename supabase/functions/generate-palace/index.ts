import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { getSupabaseClient } from "../_shared/supabase.ts";
import { enrichConceptGraph } from "./enrichment.ts";
import { computeLayout, isValidTheme } from "./layout.ts";
import { generateArtifactModels } from "./tripo.ts";
import type {
  GeneratePalaceRequest,
  GeneratePalaceResponse,
  PalaceConfig,
  ConceptGraph,
} from "../_shared/types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const TOTAL_TIMEOUT_MS = 55_000; // 55s total (Supabase Edge Function max is 60s)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a JSON error Response with CORS headers. */
function errorResponse(
  code: string,
  message: string,
  status: number,
): Response {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  // 1. CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // Global timeout via AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);

  try {
    const startTime = Date.now();

    // 2. Parse & validate request body
    let body: GeneratePalaceRequest;
    try {
      body = await req.json();
    } catch {
      return errorResponse("INVALID_THEME", "Invalid or missing JSON body", 400);
    }

    const { graph_id, theme_id, seed } = body;

    // Validate theme_id
    if (!theme_id || !isValidTheme(theme_id)) {
      return errorResponse(
        "INVALID_THEME",
        `Unknown theme ID "${theme_id}". Must be one of: nature, cityscape, space_station`,
        400,
      );
    }

    // Validate graph_id
    if (!graph_id || typeof graph_id !== "string") {
      return errorResponse(
        "GRAPH_NOT_FOUND",
        "Missing or invalid graph_id",
        404,
      );
    }

    // 3. Load concept graph from palaces table
    const supabase = getSupabaseClient();

    const { data: palaceRow, error: dbError } = await supabase
      .from("palaces")
      .select("id, concept_graph, name")
      .eq("id", graph_id)
      .single();

    if (dbError || !palaceRow) {
      return errorResponse(
        "GRAPH_NOT_FOUND",
        `No concept graph found for graph_id "${graph_id}"`,
        404,
      );
    }

    const conceptGraph = palaceRow.concept_graph as ConceptGraph;

    if (
      !conceptGraph ||
      !Array.isArray(conceptGraph.concepts) ||
      conceptGraph.concepts.length === 0
    ) {
      return errorResponse(
        "GRAPH_NOT_FOUND",
        "Concept graph is empty or malformed",
        404,
      );
    }

    // Check for timeout before Stage 1
    if (controller.signal.aborted) {
      return errorResponse("TIMEOUT", "Processing exceeded 55 second timeout", 504);
    }

    // ---- Stage 1: Semantic Enrichment via Claude Sonnet ----
    let enrichedGraph: ConceptGraph;
    let entryPoints: string[];

    try {
      const enrichment = await enrichConceptGraph(conceptGraph);
      enrichedGraph = enrichment.graph;
      entryPoints = enrichment.entry_points;
    } catch (err: unknown) {
      if (controller.signal.aborted) {
        return errorResponse(
          "TIMEOUT",
          "Processing exceeded 55 second timeout",
          504,
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      return errorResponse("LAYOUT_FAILED", `Enrichment failed: ${message}`, 422);
    }

    // Check for timeout before Stage 2
    if (controller.signal.aborted) {
      return errorResponse("TIMEOUT", "Processing exceeded 55 second timeout", 504);
    }

    // ---- Stage 2: Algorithmic Layout ----
    let layoutResult: ReturnType<typeof computeLayout>;

    try {
      layoutResult = computeLayout(enrichedGraph, theme_id, entryPoints, seed);
    } catch (err: unknown) {
      if (controller.signal.aborted) {
        return errorResponse(
          "TIMEOUT",
          "Processing exceeded 55 second timeout",
          504,
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      return errorResponse("LAYOUT_FAILED", `Layout failed: ${message}`, 422);
    }

    // Check for timeout before Stage 3
    if (controller.signal.aborted) {
      return errorResponse("TIMEOUT", "Processing exceeded 55 second timeout", 504);
    }

    // ---- Stage 3: Generate 3D artifact models via Tripo AI ----
    let modelUrls: Map<string, string>;

    try {
      modelUrls = await generateArtifactModels(
        enrichedGraph.concepts,
        supabase,
      );
    } catch (err: unknown) {
      // Tripo failures are not fatal — use placeholders
      console.error("Tripo AI generation failed, using placeholders:", err);
      modelUrls = new Map();
      for (const concept of enrichedGraph.concepts) {
        modelUrls.set(concept.id, "/placeholder.glb");
      }
    }

    // Update artifact GLB URLs from Tripo results
    for (const artifact of layoutResult.artifacts) {
      const url = modelUrls.get(artifact.concept_id);
      if (url) {
        artifact.glb_url = url;
      }
    }

    // ---- Assemble PalaceConfig ----
    const palaceId = palaceRow.id as string;
    const generationTimeMs = Date.now() - startTime;
    const actualSeed = seed ?? Math.floor(Math.random() * 2147483647);

    const palaceConfig: PalaceConfig = {
      schema_version: 1,
      palace_id: palaceId,
      seed: actualSeed,
      theme: layoutResult.theme,
      metadata: {
        name: (palaceRow.name as string) || "Mind Palace",
        created_at: new Date().toISOString(),
        concept_count: enrichedGraph.concepts.length,
        theme_id,
        generation_time_ms: generationTimeMs,
      },
      concept_graph: enrichedGraph,
      spaces: layoutResult.spaces,
      paths: layoutResult.paths,
      artifacts: layoutResult.artifacts,
      npcs: layoutResult.npcs,
      spawn_point: layoutResult.spawn_point,
    };

    // ---- Update palaces table ----
    const { error: updateError } = await supabase
      .from("palaces")
      .update({
        palace_config: palaceConfig,
        theme_id,
        status: "ready",
        seed: actualSeed,
      })
      .eq("id", palaceId);

    if (updateError) {
      console.error("Failed to update palace record:", updateError);
      // Non-fatal — we still return the config to the client
    }

    // ---- Return response ----
    const supabaseUrl = Deno.env.get("VERCEL_URL") || Deno.env.get("SUPABASE_URL") || "";
    const palaceUrl = `${supabaseUrl}/palace/${palaceId}`;

    const response: GeneratePalaceResponse = {
      palace_id: palaceId,
      palace_url: palaceUrl,
      palace_config: palaceConfig,
    };

    clearTimeout(timeoutId);

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);

    // Check if this was a timeout
    if (controller.signal.aborted) {
      return errorResponse("TIMEOUT", "Processing exceeded 55 second timeout", 504);
    }

    const message = err instanceof Error ? err.message : String(err);
    return errorResponse("LAYOUT_FAILED", message, 422);
  }
});
