import type { Concept } from "../_shared/types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const TRIPO_API_BASE = "https://api.tripo3d.ai/v2/openapi";
const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 15; // 15 * 2s = 30s max per model
const PLACEHOLDER_GLB = "/placeholder.glb";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simple hash for cache keys. Produces a hex string from concept name + description.
 * Uses the Web Crypto API available in Deno.
 */
async function hashString(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Check if a GLB already exists in Supabase Storage for this concept.
 * Returns the public URL if cached, null otherwise.
 */
async function checkStorageCache(
  supabaseClient: ReturnType<typeof Object>,
  cacheKey: string,
): Promise<string | null> {
  // deno-lint-ignore no-explicit-any
  const client = supabaseClient as any;
  const storagePath = `artifacts/${cacheKey}.glb`;

  // Try to get metadata — if the object exists, it's cached
  const { data } = await client.storage
    .from("artifacts")
    .list("artifacts", {
      search: `${cacheKey}.glb`,
      limit: 1,
    });

  if (data && data.length > 0) {
    const {
      data: { publicUrl },
    } = client.storage.from("artifacts").getPublicUrl(storagePath);
    return publicUrl;
  }

  return null;
}

/**
 * Generate a single 3D model for a concept via Tripo AI,
 * then upload the resulting GLB to Supabase Storage.
 */
async function generateSingleArtifact(
  concept: Concept,
  // deno-lint-ignore no-explicit-any
  supabaseClient: any,
  tripoApiKey: string,
): Promise<string> {
  // 1. Compute cache key
  const cacheKey = await hashString(`${concept.name}:${concept.description}`);

  // 2. Check cache
  const cachedUrl = await checkStorageCache(supabaseClient, cacheKey);
  if (cachedUrl) return cachedUrl;

  // 3. Create Tripo task
  const prompt = `Low-poly stylized 3D model of: ${concept.name}. ${concept.description}. Style: game asset, clean, colorful.`;

  const taskResponse = await fetch(`${TRIPO_API_BASE}/task`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tripoApiKey}`,
    },
    body: JSON.stringify({
      type: "text_to_model",
      prompt,
      model_version: "v2.0-20240919",
      texture: true,
    }),
  });

  if (!taskResponse.ok) {
    const errBody = await taskResponse.text();
    throw new Error(
      `Tripo API task creation failed (${taskResponse.status}): ${errBody.slice(0, 200)}`,
    );
  }

  const taskData = await taskResponse.json();
  const taskId = taskData?.data?.task_id;

  if (!taskId) {
    throw new Error(
      `Tripo API did not return a task_id: ${JSON.stringify(taskData).slice(0, 200)}`,
    );
  }

  // 4. Poll for completion
  let glbUrl: string | null = null;

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const statusResp = await fetch(`${TRIPO_API_BASE}/task/${taskId}`, {
      headers: { Authorization: `Bearer ${tripoApiKey}` },
    });

    if (!statusResp.ok) continue; // retry poll on transient errors

    const statusData = await statusResp.json();
    const status = statusData?.data?.status;

    if (status === "success") {
      glbUrl = statusData.data.output?.model;
      break;
    }

    if (status === "failed") {
      throw new Error(
        `Tripo AI failed for ${concept.name}: ${statusData.data.message || "unknown error"}`,
      );
    }

    // "running" / "queued" — keep polling
  }

  if (!glbUrl) {
    throw new Error(`Tripo AI timeout for ${concept.name} (task ${taskId})`);
  }

  // 5. Download the GLB
  const glbResponse = await fetch(glbUrl);
  if (!glbResponse.ok) {
    throw new Error(
      `Failed to download GLB for ${concept.name}: ${glbResponse.status}`,
    );
  }
  const glbBuffer = await glbResponse.arrayBuffer();

  // 6. Upload to Supabase Storage
  const storagePath = `artifacts/${cacheKey}.glb`;
  const { error: uploadError } = await supabaseClient.storage
    .from("artifacts")
    .upload(storagePath, glbBuffer, {
      contentType: "model/gltf-binary",
      upsert: true,
    });

  if (uploadError) {
    throw new Error(
      `Failed to upload GLB for ${concept.name}: ${uploadError.message}`,
    );
  }

  // 7. Return public URL
  const {
    data: { publicUrl },
  } = supabaseClient.storage.from("artifacts").getPublicUrl(storagePath);

  return publicUrl;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate 3D models for all concepts in parallel via Tripo AI.
 *
 * Returns a Map from concept ID to the public GLB URL.
 * Failed models fall back to a placeholder GLB URL.
 *
 * @param concepts - Array of concepts to generate models for
 * @param supabaseClient - Supabase client instance for storage operations
 * @returns Map<conceptId, glbUrl>
 */
export async function generateArtifactModels(
  concepts: Concept[],
  // deno-lint-ignore no-explicit-any
  supabaseClient: any,
): Promise<Map<string, string>> {
  const tripoApiKey = Deno.env.get("TRIPO_API_KEY");

  // If no API key, return all placeholders (useful for dev/testing)
  if (!tripoApiKey) {
    console.warn(
      "TRIPO_API_KEY not set — all artifacts will use placeholder models",
    );
    const result = new Map<string, string>();
    for (const concept of concepts) {
      result.set(concept.id, PLACEHOLDER_GLB);
    }
    return result;
  }

  // Generate all models in parallel
  const results = await Promise.allSettled(
    concepts.map((concept) =>
      generateSingleArtifact(concept, supabaseClient, tripoApiKey),
    ),
  );

  // Collect results, falling back to placeholder on failure
  const modelUrls = new Map<string, string>();

  for (let i = 0; i < concepts.length; i++) {
    const result = results[i];
    const conceptId = concepts[i].id;

    if (result.status === "fulfilled") {
      modelUrls.set(conceptId, result.value);
    } else {
      console.error(
        `Artifact generation failed for concept "${conceptId}":`,
        result.reason,
      );
      modelUrls.set(conceptId, PLACEHOLDER_GLB);
    }
  }

  return modelUrls;
}
