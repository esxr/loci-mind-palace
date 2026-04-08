# Implementation Specification: Loci — Mind Palace Generator

**Version:** 1.0
**Date:** 2026-04-08
**Based on:** HLD v1.1, ADR-Lite v1.0, Intent & Constraints v1.0

---

## 1. API Contracts

All endpoints are Supabase Edge Functions (Deno runtime). No authentication. All requests and responses use `application/json` unless otherwise noted. CORS headers allow all origins.

---

### 1.1 POST /ingest

**Description:** Receives raw Obsidian note content, extracts a structured concept graph using Claude Haiku with structured output, and persists the graph.

**Request:**
```json
{
  "notes": [
    {
      "title": "string — note filename without .md extension",
      "content": "string — full markdown content including [[wikilinks]]"
    }
  ],
  "traversal_depth": "number — 1 | 2 | 3, default 2. Already resolved client-side; informational only."
}
```

**Processing:**
1. Concatenate all note contents with title delimiters.
2. Call Claude Haiku (`claude-haiku-4-20250414`) with structured output (tool_use with JSON schema) to extract concepts and relationships.
3. Enforce NFC-10: if >50 concepts returned, truncate by lowest importance score.
4. Persist the concept graph to `palaces` table (concept_graph column).
5. Return the concept graph and a `graph_id` for the next step.

**Claude Haiku System Prompt (Concept Extraction):**
```
You are a knowledge graph extractor. Given a collection of study notes, extract:
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

Return at most 50 concepts. Prioritize foundational concepts over peripheral details.
```

**Claude Parameters:** `model: claude-haiku-4-20250414`, `max_tokens: 4096`, `temperature: 0.2`

**Response (200 OK):**
```json
{
  "graph_id": "string — UUID",
  "concept_graph": {
    "concepts": [
      {
        "id": "string — snake_case unique ID",
        "name": "string — human-readable name",
        "description": "string — 1-2 sentence description",
        "importance": "number — 1-10",
        "cluster_label": "string — topic cluster name",
        "source_notes": ["string — note titles"]
      }
    ],
    "relationships": [
      {
        "source_id": "string — concept ID",
        "target_id": "string — concept ID",
        "type": "string — prerequisite | contains | relates_to | example_of | contrasts_with",
        "strength": "number — 1-10"
      }
    ]
  }
}
```

**Error Responses:**

| Status | Code | Description | When |
|--------|------|-------------|------|
| 400 | EMPTY_NOTES | No notes provided | `notes` array is empty or missing |
| 400 | NOTES_TOO_LARGE | Content exceeds limit | Total content >100KB |
| 422 | EXTRACTION_FAILED | LLM extraction failed | Claude returns invalid structure after 2 retries |
| 429 | RATE_LIMITED | Too many requests | >10 requests/minute |
| 504 | TIMEOUT | Processing timeout | Extraction takes >30 seconds |

**Rate Limiting:** 10 requests/minute per IP (enforced via in-memory counter, acceptable for single-user).

**Timeout:** 30 seconds. Claude Haiku typically responds in 2-5 seconds for this payload.

---

### 1.2 POST /generate-palace

**Description:** Takes a concept graph and theme, generates a complete palace configuration with spatial layout, artifact URLs, and NPC placements. This is the most compute-intensive endpoint.

**Request:**
```json
{
  "graph_id": "string — UUID from /ingest response",
  "theme_id": "string — nature | cityscape | space_station",
  "seed": "number? — optional random seed for deterministic regeneration"
}
```

**Processing (Two-Stage Pipeline):**

**Stage 1 — Semantic Enrichment (Claude Sonnet):**
1. Load concept graph from DB by `graph_id`.
2. Call Claude Sonnet (`claude-sonnet-4-20250514`) to enrich the graph with spatial hints.
3. Sonnet annotates each concept with: refined importance, spatial hint (e.g., "central", "peripheral", "gateway"), display_size (derived from importance).
4. Sonnet annotates each relationship with: refined type, corridor_style hint.

**Claude Sonnet System Prompt (Semantic Enrichment):**
```
You are a spatial architect for a memory palace. Given a concept graph, enrich it with spatial metadata that will guide a layout algorithm.

For each concept, add:
- spatial_hint: one of "central" (should be near the center), "gateway" (connects major clusters), "peripheral" (edge of the map), "standard" (no special placement)
- display_size: "large" | "medium" | "small" based on importance

For each relationship, add:
- corridor_style: "wide" (strong connection) | "narrow" (weak connection) | "bridge" (cross-cluster)

Also identify 1-3 concepts that should serve as the entry points (where the user spawns).

Return the enriched graph as JSON.
```

**Claude Sonnet Parameters:** `model: claude-sonnet-4-20250514`, `max_tokens: 4096`, `temperature: 0.3`

**Stage 2 — Algorithmic Layout:**
1. Build graphology graph from enriched concepts and relationships.
2. Run Louvain community detection to assign zone IDs (clusters).
3. Run ForceAtlas2 layout (iterations: 500, gravity: 1.0, scalingRatio: 2.0, seed from request or random) to compute 2D positions.
4. Scale positions to world coordinates (1 unit = 1 voxel block). Spaces range from 8x8 (small) to 20x20 (large) based on `display_size`.
5. Run overlap removal pass: push apart any spaces whose bounding boxes overlap, maintaining relative positions.
6. Use rot-js AStar pathfinding to route paths between connected spaces, avoiding space interiors.
7. Assign space floor elevation per zone (zone 0 = y:0, zone 1 = y:0 or y:4 for slight variation).
8. Place artifacts at center of each space on a pedestal (y = floor + 1).
9. Place NPCs at a fixed offset from artifact within each space.
10. Generate Tripo AI 3D models in parallel for all concepts (see Section 8.2). Store GLB URLs.
11. Assemble the full `PalaceConfig` (see Section 2).
12. Persist to `palaces` table.

**Response (200 OK):**
```json
{
  "palace_id": "string — UUID",
  "palace_url": "string — https://{VERCEL_URL}/palace/{palace_id}",
  "palace_config": "PalaceConfig — see Section 2 for full schema"
}
```

**Error Responses:**

| Status | Code | Description | When |
|--------|------|-------------|------|
| 400 | INVALID_THEME | Unknown theme ID | `theme_id` not in allowed set |
| 404 | GRAPH_NOT_FOUND | No concept graph | `graph_id` does not exist |
| 422 | LAYOUT_FAILED | Layout generation failed | Algorithm produces invalid output |
| 504 | TIMEOUT | Processing timeout | Generation exceeds 55 seconds |

**Timeout:** 55 seconds (Supabase Edge Function max is 60s). Tripo AI calls are parallelized to stay within budget. If Tripo times out for individual concepts, fallback placeholder GLB URL is used.

**Cost Per Call:** ~$0.10 (Sonnet enrichment) + ~$0.01 (Haiku from ingest) + ~$0.50-2.00 (Tripo AI, cached after first generation). Total well under $5/map (NFC-8).

---

### 1.3 POST /npc-chat

**Description:** Streams an NPC dialogue response grounded in the concept's source material. Uses Server-Sent Events (SSE) for real-time streaming.

**Request:**
```json
{
  "palace_id": "string — UUID",
  "concept_id": "string — concept ID within the palace",
  "message": "string — user's message to the NPC",
  "conversation_history": [
    {
      "role": "string — user | assistant",
      "content": "string — message text"
    }
  ]
}
```

**Processing:**
1. Load palace config from DB by `palace_id`.
2. Extract the target concept and its 1-hop neighbor concepts from the concept graph.
3. Extract source note excerpts for the concept (stored in concept_graph.concepts[].source_notes).
4. Build system prompt with concept context (see NPC System Prompt below).
5. Stream Claude Haiku response via SSE.
6. Optionally persist conversation to `conversations` table.

**NPC System Prompt:**
```
You are {concept.name}, a guide in a mind palace — a 3D world built from study notes.

You represent the concept: {concept.description}

Related concepts nearby: {neighbor_names_and_descriptions}

Source material you are grounded in:
---
{source_note_excerpts}
---

Rules:
- Speak in first person as if you ARE this concept personified.
- Help the user understand the concept through conversation.
- Reference related concepts and suggest the user visit their spaces.
- Keep responses concise (2-4 sentences) unless the user asks for detail.
- Stay grounded in the source material. Do not invent facts not present in the notes.
- Be friendly, engaging, and slightly theatrical — you are a character in a palace.
```

**Claude Haiku Parameters:** `model: claude-haiku-4-20250414`, `max_tokens: 512`, `temperature: 0.7`, `stream: true`

**Response (200 OK, SSE stream):**
```
Content-Type: text/event-stream

data: {"type": "chunk", "text": "Ah, "}
data: {"type": "chunk", "text": "welcome "}
data: {"type": "chunk", "text": "traveler! "}
...
data: {"type": "done", "full_text": "Ah, welcome traveler! ..."}
```

**Error Responses:**

| Status | Code | Description | When |
|--------|------|-------------|------|
| 400 | INVALID_REQUEST | Missing required fields | `palace_id`, `concept_id`, or `message` missing |
| 404 | PALACE_NOT_FOUND | Palace does not exist | Invalid `palace_id` |
| 404 | CONCEPT_NOT_FOUND | Concept not in palace | `concept_id` not in palace's graph |
| 429 | RATE_LIMITED | Too many chat requests | >30 requests/minute |
| 504 | TIMEOUT | Stream timeout | No response within 10 seconds |

**Rate Limiting:** 30 requests/minute per IP.

---

## 2. Palace Config Schema (TypeScript Interfaces)

This is the central data contract. The server produces it; the client consumes it. Every field is specified.

```typescript
// ─── Top-Level Config ───

interface PalaceConfig {
  schema_version: 1;
  palace_id: string;                // UUID
  seed: number;                     // Random seed used for generation
  theme: ThemeConfig;               // Full theme configuration
  metadata: PalaceMetadata;
  concept_graph: ConceptGraph;      // Original enriched concept graph
  spaces: Space[];                  // All rooms/areas in the palace
  paths: Path[];                    // Corridors connecting spaces
  artifacts: Artifact[];            // 3D objects representing concepts
  npcs: NPC[];                      // NPC guides per concept
  spawn_point: WorldPosition;       // Where the player starts
}

interface PalaceMetadata {
  name: string;                     // Auto-generated or user-provided palace name
  created_at: string;               // ISO 8601 timestamp
  concept_count: number;
  theme_id: string;
  generation_time_ms: number;       // How long generation took
}

// ─── Concept Graph (Input Data, Preserved in Config) ───

interface ConceptGraph {
  concepts: Concept[];
  relationships: Relationship[];
}

interface Concept {
  id: string;                       // snake_case unique ID (e.g. "mitochondria")
  name: string;                     // Human-readable (e.g. "Mitochondria")
  description: string;              // 1-2 sentence description
  importance: number;               // 1-10
  cluster_label: string;            // Topic cluster (e.g. "cell_biology")
  source_notes: string[];           // Note titles this concept appears in
  spatial_hint: "central" | "gateway" | "peripheral" | "standard";
  display_size: "large" | "medium" | "small";
}

interface Relationship {
  source_id: string;
  target_id: string;
  type: "prerequisite" | "contains" | "relates_to" | "example_of" | "contrasts_with";
  strength: number;                 // 1-10
  corridor_style: "wide" | "narrow" | "bridge";
}

// ─── Spatial Layout ───

interface WorldPosition {
  x: number;                        // World-space voxel coordinate
  y: number;                        // Vertical (0 = ground level)
  z: number;
}

interface BoundingBox {
  min: WorldPosition;
  max: WorldPosition;
}

interface Space {
  id: string;                       // Matches concept.id
  concept_id: string;               // Reference to the concept
  position: WorldPosition;          // Bottom-left-front corner of the space
  size: {
    width: number;                  // X extent in blocks (8 | 12 | 16 | 20)
    height: number;                 // Y extent in blocks (always 6 for walkability)
    depth: number;                  // Z extent in blocks (8 | 12 | 16 | 20)
  };
  shape: "rectangular" | "circular" | "organic";
  zone_id: number;                  // Louvain cluster ID
  floor_block: string;              // Block type ID from theme palette
  wall_block: string;               // Block type ID from theme palette
  ceiling_block: string | null;     // null = open sky/space
  has_ceiling: boolean;
}

interface Path {
  id: string;                       // "{source_space_id}_to_{target_space_id}"
  source_space_id: string;
  target_space_id: string;
  waypoints: WorldPosition[];       // Ordered list of points defining the path
  width: number;                    // 2 (narrow) | 3 (standard) | 4 (wide)
  floor_block: string;              // Block type ID from theme palette
  wall_block: string | null;        // null = open path (no corridor walls)
  style: "corridor" | "trail" | "bridge" | "tunnel";
}

// ─── Artifacts ───

interface Artifact {
  id: string;                       // "{concept_id}_artifact"
  concept_id: string;
  position: WorldPosition;          // World position of the artifact center
  glb_url: string;                  // Public Supabase Storage URL to GLB file
  scale: number;                    // Uniform scale factor (default 1.0)
  rotation_y: number;               // Y-axis rotation in radians
  pedestal: Pedestal;
}

interface Pedestal {
  block: string;                    // Block type ID from theme palette
  width: number;                    // Pedestal base width in blocks (2 | 3)
  height: number;                   // Pedestal height in blocks (1 | 2)
}

// ─── NPCs ───

interface NPC {
  id: string;                       // "{concept_id}_npc"
  concept_id: string;
  name: string;                     // Display name (same as concept.name)
  position: WorldPosition;          // World position where NPC stands
  facing: number;                   // Y-axis rotation in radians (faces player spawn)
  voxel_model: NPCVoxelModel;
  dialogue_context: {
    concept_description: string;
    neighbor_ids: string[];         // 1-hop neighbor concept IDs for context
  };
}

interface NPCVoxelModel {
  style: string;                    // Theme-defined style ID (e.g. "forest_sage", "robot")
  palette: {
    body: string;                   // Hex color
    head: string;                   // Hex color
    accent: string;                 // Hex color
  };
  height_blocks: number;            // NPC height in blocks (typically 3)
}

// ─── Theme Configuration ───

interface ThemeConfig {
  id: string;                       // "nature" | "cityscape" | "space_station"
  name: string;                     // Display name
  palette: BlockPalette;
  lighting: LightingConfig;
  fog: FogConfig;
  particles: ParticleConfig[];
  space_shape: "organic" | "geometric" | "mixed";
  path_style: "trails" | "corridors" | "bridges" | "tunnels";
  npc_style: NPCStyleConfig;
  pedestal_style: PedestalStyleConfig;
  skybox: SkyboxConfig;
}

interface BlockPalette {
  ground: BlockType[];              // Floor block options
  walls: BlockType[];               // Wall block options
  paths: BlockType[];               // Path surface options
  accent: BlockType[];              // Decorative block options
  pedestal: BlockType[];            // Artifact pedestal options
}

interface BlockType {
  id: string;                       // Unique block type ID (e.g. "grass", "stone_brick")
  color: [number, number, number];  // RGB 0-255 for solid color blocks
  texture_url: string | null;       // Optional texture atlas URL (null = solid color)
}

interface LightingConfig {
  ambient: { color: string; intensity: number };
  directional: {
    color: string;
    intensity: number;
    direction: [number, number, number];
  };
}

interface FogConfig {
  color: string;                    // Hex color
  near: number;                     // Fog start distance in blocks
  far: number;                      // Fog end distance in blocks
}

interface ParticleConfig {
  type: "fireflies" | "rain" | "snow" | "embers" | "bubbles" | "dust" | "stars";
  density: number;                  // 0.0-1.0
  color: string;                    // Hex color
}

interface SkyboxConfig {
  type: "gradient" | "color";
  top_color: string;                // Hex color
  bottom_color: string;             // Hex color
}

interface NPCStyleConfig {
  default_style: string;            // Style ID applied to all NPCs in this theme
  palette_template: {
    body: string;
    head: string;
    accent: string;
  };
}

interface PedestalStyleConfig {
  default_block: string;            // Block type ID
  default_width: number;
  default_height: number;
}
```

**Size Budget:** For 30 concepts, this JSON is approximately 25-35KB. For 50 concepts, approximately 40-50KB. Within NFC-6 (10-50KB).

---

## 3. Theme Definitions (MVP)

Three themes are required for MVP (FR-25). Each is a static `ThemeConfig` object.

### 3.1 Nature / Garden (`nature`)
```typescript
const NATURE_THEME: ThemeConfig = {
  id: "nature",
  name: "Nature Garden",
  palette: {
    ground: [{ id: "grass", color: [86, 170, 48], texture_url: null }],
    walls: [
      { id: "oak_log", color: [110, 80, 40], texture_url: null },
      { id: "leaves", color: [55, 130, 40], texture_url: null }
    ],
    paths: [{ id: "stone_path", color: [140, 140, 130], texture_url: null }],
    accent: [
      { id: "flower_red", color: [200, 50, 50], texture_url: null },
      { id: "flower_yellow", color: [230, 200, 50], texture_url: null }
    ],
    pedestal: [{ id: "mossy_stone", color: [100, 120, 90], texture_url: null }]
  },
  lighting: {
    ambient: { color: "#fffbe6", intensity: 0.6 },
    directional: { color: "#fff5cc", intensity: 0.8, direction: [-0.5, -1, -0.3] }
  },
  fog: { color: "#c8e6c8", near: 40, far: 100 },
  particles: [{ type: "fireflies", density: 0.3, color: "#aaff66" }],
  space_shape: "organic",
  path_style: "trails",
  npc_style: {
    default_style: "forest_sage",
    palette_template: { body: "#5b8c3e", head: "#8bc34a", accent: "#ffeb3b" }
  },
  pedestal_style: { default_block: "mossy_stone", default_width: 3, default_height: 1 },
  skybox: { type: "gradient", top_color: "#87ceeb", bottom_color: "#e0f7e0" }
};
```

### 3.2 Cityscape (`cityscape`)
```typescript
const CITYSCAPE_THEME: ThemeConfig = {
  id: "cityscape",
  name: "Neon City",
  palette: {
    ground: [{ id: "concrete", color: [160, 160, 160], texture_url: null }],
    walls: [
      { id: "steel", color: [100, 100, 110], texture_url: null },
      { id: "glass", color: [180, 210, 230], texture_url: null }
    ],
    paths: [{ id: "asphalt", color: [60, 60, 65], texture_url: null }],
    accent: [
      { id: "neon_pink", color: [255, 50, 150], texture_url: null },
      { id: "neon_blue", color: [50, 150, 255], texture_url: null }
    ],
    pedestal: [{ id: "metal_platform", color: [80, 80, 90], texture_url: null }]
  },
  lighting: {
    ambient: { color: "#1a1a2e", intensity: 0.4 },
    directional: { color: "#6666aa", intensity: 0.5, direction: [0, -1, 0] }
  },
  fog: { color: "#1a1a2e", near: 30, far: 80 },
  particles: [{ type: "rain", density: 0.5, color: "#aaccff" }],
  space_shape: "geometric",
  path_style: "corridors",
  npc_style: {
    default_style: "cyber_guide",
    palette_template: { body: "#333344", head: "#aabbcc", accent: "#ff44aa" }
  },
  pedestal_style: { default_block: "metal_platform", default_width: 2, default_height: 2 },
  skybox: { type: "gradient", top_color: "#0a0a1a", bottom_color: "#1a1a3e" }
};
```

### 3.3 Space Station (`space_station`)
```typescript
const SPACE_STATION_THEME: ThemeConfig = {
  id: "space_station",
  name: "Space Station",
  palette: {
    ground: [{ id: "hull_panel", color: [180, 185, 190], texture_url: null }],
    walls: [
      { id: "bulkhead", color: [140, 145, 155], texture_url: null },
      { id: "window", color: [20, 20, 40], texture_url: null }
    ],
    paths: [{ id: "grated_floor", color: [120, 125, 130], texture_url: null }],
    accent: [
      { id: "holo_blue", color: [100, 180, 255], texture_url: null },
      { id: "warning_orange", color: [255, 140, 0], texture_url: null }
    ],
    pedestal: [{ id: "holo_pedestal", color: [60, 80, 120], texture_url: null }]
  },
  lighting: {
    ambient: { color: "#e0e8ff", intensity: 0.5 },
    directional: { color: "#ffffff", intensity: 0.6, direction: [0, -1, 0.2] }
  },
  fog: { color: "#000010", near: 50, far: 120 },
  particles: [{ type: "stars", density: 0.4, color: "#ffffff" }],
  space_shape: "geometric",
  path_style: "corridors",
  npc_style: {
    default_style: "robot",
    palette_template: { body: "#88aacc", head: "#ccddee", accent: "#44aaff" }
  },
  pedestal_style: { default_block: "holo_pedestal", default_width: 2, default_height: 1 },
  skybox: { type: "color", top_color: "#000005", bottom_color: "#000010" }
};
```

---

## 4. Obsidian Plugin Specification

### 4.1 Plugin Manifest

```json
{
  "id": "loci-mind-palace",
  "name": "Loci — Mind Palace Generator",
  "version": "0.1.0",
  "minAppVersion": "1.0.0",
  "description": "Transform your notes into walkable 3D mind palaces",
  "author": "Loci Team"
}
```

### 4.2 Commands and UI

**Ribbon Icon:** Brain icon (`lucide-brain`). Clicking opens the Generation Modal.

**Commands (registered via `addCommand`):**

| Command ID | Name | Action |
|-----------|------|--------|
| `generate-palace` | Generate Mind Palace | Opens Generation Modal |
| `open-library` | Palace Library | Opens browser to web app library page |

**Generation Modal (extends `Modal`):**

UI elements (rendered with standard Obsidian `Setting` components):
1. **Note Selector:** Multi-select list of all vault notes. Pre-populated with the currently active note. Shows checkboxes.
2. **Traversal Depth:** Dropdown with options `1`, `2`, `3`. Default: `2`. Label: "Link depth".
3. **Theme Picker:** Visual radio group showing 3 theme cards (Nature, Cityscape, Space Station) with color previews.
4. **Generate Button:** "Build My Palace". Disabled until at least 1 note is selected.
5. **Progress Bar:** Shown after clicking Generate. Displays current stage text (Collecting notes... Extracting concepts... Building palace...).

### 4.3 Wikilink Traversal (Client-Side)

The plugin resolves wikilinks before sending to the backend:

```typescript
async function collectNotes(
  vault: Vault,
  selectedTitles: string[],
  depth: number
): Promise<NoteContent[]> {
  const collected = new Map<string, NoteContent>();
  const queue: Array<{ title: string; currentDepth: number }> =
    selectedTitles.map(t => ({ title: t, currentDepth: 0 }));

  while (queue.length > 0) {
    const { title, currentDepth } = queue.shift()!;
    if (collected.has(title) || currentDepth > depth) continue;

    const file = vault.getAbstractFileByPath(`${title}.md`);
    if (!file || !(file instanceof TFile)) continue;

    const content = await vault.read(file);
    collected.set(title, { title, content });

    if (currentDepth < depth) {
      const wikilinks = content.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g) || [];
      const linkedTitles = wikilinks.map(
        link => link.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/, "$1")
      );
      linkedTitles.forEach(lt => queue.push({ title: lt, currentDepth: currentDepth + 1 }));
    }
  }
  return Array.from(collected.values());
}
```

### 4.4 Backend Communication

Uses Obsidian's `requestUrl` (CORS-free HTTP):

```typescript
async function ingestNotes(notes: NoteContent[], depth: number): Promise<IngestResponse> {
  const response = await requestUrl({
    url: `${settings.apiEndpoint}/ingest`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes, traversal_depth: depth })
  });
  return response.json;
}

async function generatePalace(graphId: string, themeId: string): Promise<GenerateResponse> {
  const response = await requestUrl({
    url: `${settings.apiEndpoint}/generate-palace`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graph_id: graphId, theme_id: themeId })
  });
  return response.json;
}
```

### 4.5 Opening the 3D Viewer

After successful generation, the plugin opens the palace in the default browser:

```typescript
window.open(response.palace_url, "_blank");
// palace_url format: https://{VERCEL_DOMAIN}/palace/{palace_id}
```

The palace ID is also saved to plugin data for the library:

```typescript
this.data.recentPalaces.unshift({ palace_id, theme_id, name, created_at });
this.saveData(this.data);
```

### 4.6 Settings

```typescript
interface LociPluginSettings {
  apiEndpoint: string;  // Default: "https://{SUPABASE_PROJECT}.supabase.co/functions/v1"
}
```

Single setting in the Settings Tab: API Endpoint URL (text input). Allows pointing to local dev or production.

---

## 5. 3D Client Architecture (noa-engine)

### 5.1 Module Breakdown

| Module | File(s) | Responsibility |
|--------|---------|----------------|
| **Engine Setup** | `src/web/engine/setup.ts` | Initialize noa-engine, register block types, configure camera/controls |
| **World Generator** | `src/web/world/generator.ts` | Read PalaceConfig and place voxel blocks for spaces, paths, terrain |
| **Space Builder** | `src/web/world/spaces.ts` | Build individual rooms from Space config (floors, walls, ceilings) |
| **Path Builder** | `src/web/world/paths.ts` | Build corridors/trails between spaces from Path waypoints |
| **Theme Applicator** | `src/web/themes/applicator.ts` | Register block types from ThemeConfig palette, apply lighting/fog/skybox |
| **Artifact Loader** | `src/web/artifacts/loader.ts` | Fetch GLB from URL, place on pedestal via Babylon.js GLTF loader |
| **NPC System** | `src/web/npcs/manager.ts` | Create voxel NPC entities, handle proximity detection, manage click interaction |
| **NPC Renderer** | `src/web/npcs/renderer.ts` | Build NPC voxel body from NPCVoxelModel config using noa block entities |
| **Dialogue UI** | `src/web/ui/dialogue.ts` | HTML/CSS overlay panel for NPC chat (input box, streaming text display) |
| **Minimap** | `src/web/ui/minimap.ts` | 2D canvas overlay showing top-down map with player position |
| **Library Page** | `src/web/ui/library.ts` | List/select palaces, fetch from backend, render cards |
| **Main Entry** | `src/web/main.ts` | Route handling, palace loading orchestration |

### 5.2 Engine Initialization

```typescript
import Engine from "noa-engine";

function createEngine(canvas: HTMLCanvasElement): Engine {
  const noa = new Engine({
    domElement: canvas,
    showFPS: false,
    inverseY: false,
    chunkSize: 32,
    chunkAddDistance: [3, 2],       // Render distance: 3 chunks horizontal, 2 vertical
    chunkRemoveDistance: [4, 3],
    gravity: [0, -10, 0],
    playerHeight: 1.8,
    playerWidth: 0.6,
    playerStart: [0, 2, 0],        // Overridden by palace spawn_point
    blockTestDistance: 8,
    playerAutoStep: true,
  });
  return noa;
}
```

### 5.3 Block Registration from Theme

Each `BlockType` in the theme palette is registered with noa-engine:

```typescript
function registerBlocks(noa: Engine, theme: ThemeConfig): void {
  const allBlocks = [
    ...theme.palette.ground,
    ...theme.palette.walls,
    ...theme.palette.paths,
    ...theme.palette.accent,
    ...theme.palette.pedestal,
  ];

  for (const block of allBlocks) {
    const [r, g, b] = block.color;
    noa.registry.registerMaterial(block.id, { color: [r / 255, g / 255, b / 255] });
    noa.registry.registerBlock(noa.registry.getBlockID(block.id) || nextBlockId++, {
      material: block.id,
      solid: true,
      opaque: true,
    });
  }
}
```

### 5.4 World Generation from PalaceConfig

The generator iterates over `spaces[]` and `paths[]` in the config, placing blocks:

```typescript
async function generateWorld(noa: Engine, config: PalaceConfig): Promise<void> {
  // 1. Build ground plane (thin layer under all spaces and paths)
  buildGroundPlane(noa, config);

  // 2. Build each space (floor, walls, optional ceiling)
  for (const space of config.spaces) {
    buildSpace(noa, space, config.theme);
  }

  // 3. Build paths between spaces
  for (const path of config.paths) {
    buildPath(noa, path, config.theme);
  }

  // 4. Build pedestals and load artifacts
  for (const artifact of config.artifacts) {
    buildPedestal(noa, artifact.pedestal, artifact.position);
    await loadArtifact(noa, artifact);
  }

  // 5. Spawn NPCs
  for (const npc of config.npcs) {
    spawnNPC(noa, npc);
  }

  // 6. Set spawn point
  const sp = config.spawn_point;
  noa.ents.setPosition(noa.playerEntity, [sp.x, sp.y + 1, sp.z]);
}
```

### 5.5 Artifact Loading Pipeline

```typescript
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";

async function loadArtifact(noa: Engine, artifact: Artifact): Promise<void> {
  const scene = noa.rendering.getScene();

  try {
    const result = await SceneLoader.ImportMeshAsync(
      "", artifact.glb_url, "", scene
    );

    const root = result.meshes[0];
    root.scaling.setAll(artifact.scale);
    root.rotation.y = artifact.rotation_y;
    root.position.set(
      artifact.position.x,
      artifact.position.y + artifact.pedestal.height,
      artifact.position.z
    );

    // Attach to noa entity system for chunk management
    const eid = noa.entities.add(
      [artifact.position.x, artifact.position.y, artifact.position.z],
      1, 1, null, null, false, false
    );
    noa.entities.addComponentAgain(eid, "mesh", { mesh: root });
  } catch (err) {
    console.warn(`Failed to load artifact ${artifact.id}, using placeholder`, err);
    createPlaceholderArtifact(noa, artifact);
  }
}
```

### 5.6 NPC System

**Rendering:** NPCs are built from colored voxel blocks (3 blocks tall: legs, body, head) using noa entity meshes.

**Proximity Detection:** Each frame, check distance from player to each NPC. When distance < 4 blocks, show interaction prompt ("Press E to talk").

**Click/Key Interaction:** On E keypress while in proximity, open dialogue UI overlay and pause player movement.

```typescript
function updateNPCProximity(noa: Engine, npcs: NPCEntity[]): void {
  const playerPos = noa.entities.getPositionData(noa.playerEntity)!.position;

  for (const npc of npcs) {
    const dist = vec3Distance(playerPos, [npc.position.x, npc.position.y, npc.position.z]);

    if (dist < 4 && !npc.showingPrompt) {
      showInteractionPrompt(npc.name);
      npc.showingPrompt = true;
    } else if (dist >= 4 && npc.showingPrompt) {
      hideInteractionPrompt();
      npc.showingPrompt = false;
    }
  }
}
```

### 5.7 Dialogue UI (HTML Overlay)

The dialogue panel is a DOM overlay on top of the canvas:

```
┌──────────────────────────────────────────────────┐
│  [NPC Name]                              [X]     │
│──────────────────────────────────────────────────│
│                                                  │
│  NPC: "Welcome, traveler! I am the concept of   │
│  mitochondria. I am the powerhouse of the cell!" │
│                                                  │
│  User: "How do you relate to ATP?"               │
│                                                  │
│  NPC: "Ah, ATP is my primary creation! Through   │
│  oxidative phosphorylation, I convert..."        │
│                                                  │
│──────────────────────────────────────────────────│
│  [Type your message...                    ] [Send]│
└──────────────────────────────────────────────────┘
```

SSE consumption for streaming:

```typescript
async function streamNPCResponse(
  palaceId: string,
  conceptId: string,
  message: string,
  history: ChatMessage[],
  onChunk: (text: string) => void,
  onDone: (fullText: string) => void
): Promise<void> {
  const response = await fetch(`${API_ENDPOINT}/npc-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      palace_id: palaceId,
      concept_id: conceptId,
      message,
      conversation_history: history
    })
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value);
    const lines = text.split("\n").filter(l => l.startsWith("data: "));

    for (const line of lines) {
      const data = JSON.parse(line.slice(6));
      if (data.type === "chunk") onChunk(data.text);
      if (data.type === "done") onDone(data.full_text);
    }
  }
}
```

### 5.8 Performance Strategy

| Technique | Implementation | Traces to |
|-----------|---------------|-----------|
| **Chunk culling** | noa-engine built-in: only meshes chunks within `chunkAddDistance` | NFC-1 |
| **Render distance** | `chunkAddDistance: [3, 2]` = ~96 blocks horizontal view | NFC-1 |
| **LOD for artifacts** | Tripo AI produces low-poly GLBs (~5k triangles); no further LOD needed | NFC-1 |
| **Lazy artifact loading** | Load GLBs only for visible chunks; use placeholder until loaded | NFC-3 |
| **Block batching** | noa-engine greedy meshing combines adjacent same-type blocks into single draw calls | NFC-1 |
| **Fog** | Theme fog hides chunk pop-in at render distance boundary | NFC-1 |

---

## 6. State Machines

### 6.1 Palace Generation Lifecycle

**States:** `idle` | `ingesting` | `extracting` | `enriching` | `layouting` | `generating_artifacts` | `ready` | `error`

**Transitions:**

| From | To | Trigger | Guards | Side Effects |
|------|----|---------|--------|--------------|
| idle | ingesting | user clicks "Build My Palace" | at least 1 note selected | Collect notes via wikilink traversal |
| ingesting | extracting | notes collected | notes array non-empty | POST /ingest |
| extracting | enriching | /ingest returns 200 | concept_graph valid | POST /generate-palace begins Stage 1 |
| enriching | layouting | Sonnet enrichment complete | enriched graph valid | Begin algorithmic layout (Stage 2) |
| layouting | generating_artifacts | layout computed | all spaces positioned | Parallel Tripo AI calls |
| generating_artifacts | ready | all artifacts URLs obtained | palace_config assembled | Persist config, return palace_url |
| ready | idle | user opens palace URL | — | Reset plugin state |
| * | error | any stage fails | — | Show error message with retry button |
| error | idle | user clicks retry or dismisses | — | Reset state |

**Diagram:**
```
[idle] ──Build──▶ [ingesting] ──▶ [extracting] ──▶ [enriching]
                                                        │
         [error] ◀── any failure ── any stage           ▼
           │                                      [layouting]
           └── retry ──▶ [idle]                        │
                                                        ▼
                            [ready] ◀── [generating_artifacts]
                              │
                              └── open URL ──▶ [idle]
```

### 6.2 NPC Dialogue Lifecycle

**States:** `idle` | `loading_context` | `streaming` | `complete` | `error`

**Transitions:**

| From | To | Trigger | Guards | Side Effects |
|------|----|---------|--------|--------------|
| idle | loading_context | user presses E near NPC | player within 4 blocks | Open dialogue panel, lock player controls |
| loading_context | streaming | POST /npc-chat begins streaming | SSE connection established | Show typing indicator |
| streaming | complete | SSE "done" event received | — | Enable user input field |
| complete | streaming | user sends new message | message non-empty | Append to history, POST /npc-chat again |
| complete | idle | user closes dialogue (X or Escape) | — | Close panel, unlock player controls |
| * | error | SSE error or timeout | — | Show "NPC is unavailable" message |
| error | idle | user closes dialogue | — | Close panel, unlock player controls |

### 6.3 Plugin State

**States:** `disconnected` | `connected` | `selecting_notes` | `generating` | `viewing`

**Transitions:**

| From | To | Trigger | Guards | Side Effects |
|------|----|---------|--------|--------------|
| disconnected | connected | plugin loaded, API endpoint valid | health check passes | Enable ribbon icon |
| connected | selecting_notes | user clicks ribbon icon | — | Open Generation Modal |
| selecting_notes | generating | user clicks "Build My Palace" | >= 1 note selected | Start generation pipeline, show progress |
| generating | viewing | generation complete | palace_url received | Open browser with palace URL |
| generating | connected | generation fails or user cancels | — | Show error / close modal |
| viewing | connected | user returns to Obsidian | — | — |
| * | disconnected | API health check fails | — | Show "offline" indicator on ribbon |

---

## 7. Persistence (Supabase)

### 7.1 Database Schema

```sql
-- Palace storage (concept graph + generated config)
CREATE TABLE palaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL DEFAULT 'Untitled Palace',
    concept_graph JSONB NOT NULL,        -- ConceptGraph JSON
    palace_config JSONB,                 -- PalaceConfig JSON (null while generating)
    theme_id TEXT NOT NULL,
    seed INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'generating',  -- generating | ready | error
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    generation_time_ms INTEGER
);

CREATE INDEX idx_palaces_status ON palaces(status);
CREATE INDEX idx_palaces_created ON palaces(created_at DESC);

-- Conversation history for NPC chats
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    palace_id UUID NOT NULL REFERENCES palaces(id) ON DELETE CASCADE,
    concept_id TEXT NOT NULL,
    messages JSONB NOT NULL DEFAULT '[]'::jsonb,  -- Array of {role, content} objects
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversations_palace ON conversations(palace_id);
CREATE UNIQUE INDEX idx_conversations_unique ON conversations(palace_id, concept_id);
```

### 7.2 Storage Buckets

```sql
-- Supabase Storage bucket for 3D model files
-- Created via Supabase dashboard or CLI
INSERT INTO storage.buckets (id, name, public)
VALUES ('artifacts', 'artifacts', true);

-- Public access policy (no auth required)
CREATE POLICY "Public artifact access"
ON storage.objects FOR SELECT
USING (bucket_id = 'artifacts');

CREATE POLICY "Service role artifact upload"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'artifacts');
```

**File naming convention:** `artifacts/{hash(concept_name + concept_description)}.glb`

Caching strategy: before calling Tripo AI, check if a file with the hash key already exists in storage. If yes, reuse the URL. This ensures identical concepts across different palaces share the same model file.

### 7.3 API Endpoints (Supabase Client)

Edge functions use the Supabase JS client with the service role key:

```typescript
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
```

---

## 8. External Service Integration

### 8.1 Claude API (Anthropic)

| Use Case | Model | Temperature | Max Tokens | Estimated Cost | Traces to |
|----------|-------|-------------|------------|----------------|-----------|
| Concept extraction | `claude-haiku-4-20250414` | 0.2 | 4096 | ~$0.01/call | FR-3 |
| Semantic enrichment | `claude-sonnet-4-20250514` | 0.3 | 4096 | ~$0.10/call | FR-5, FR-6 |
| NPC dialogue | `claude-haiku-4-20250414` | 0.7 | 512 | ~$0.001/message | FR-17, FR-18 |

**API Configuration:**
```typescript
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY")!,
});
```

**Structured Output (Concept Extraction):** Use `tool_use` with a JSON schema to guarantee valid output:

```typescript
const response = await anthropic.messages.create({
  model: "claude-haiku-4-20250414",
  max_tokens: 4096,
  temperature: 0.2,
  messages: [{ role: "user", content: notesContent }],
  system: CONCEPT_EXTRACTION_PROMPT,
  tools: [{
    name: "extract_concepts",
    description: "Extract concepts and relationships from study notes",
    input_schema: {
      type: "object",
      properties: {
        concepts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              description: { type: "string" },
              importance: { type: "number", minimum: 1, maximum: 10 },
              cluster_label: { type: "string" },
              source_notes: { type: "array", items: { type: "string" } }
            },
            required: ["id", "name", "description", "importance", "cluster_label", "source_notes"]
          }
        },
        relationships: {
          type: "array",
          items: {
            type: "object",
            properties: {
              source_id: { type: "string" },
              target_id: { type: "string" },
              type: { type: "string", enum: ["prerequisite", "contains", "relates_to", "example_of", "contrasts_with"] },
              strength: { type: "number", minimum: 1, maximum: 10 }
            },
            required: ["source_id", "target_id", "type", "strength"]
          }
        }
      },
      required: ["concepts", "relationships"]
    }
  }],
  tool_choice: { type: "tool", name: "extract_concepts" }
});
```

**Error Handling:** Retry with exponential backoff on 429 (rate limit) and 529 (overloaded). Max 2 retries. Base delay 1 second.

### 8.2 Tripo AI (Text-to-3D)

**API Endpoint:** `https://api.tripo3d.ai/v2/openapi/task`

**Request Flow:**
1. Create a task: POST with `type: "text_to_model"` and a prompt derived from the concept name + description.
2. Poll task status: GET until `status: "success"` (typically 2-8 seconds).
3. Download the GLB from the result URL.
4. Upload to Supabase Storage.

```typescript
async function generateArtifactModel(
  concept: Concept,
  supabase: SupabaseClient
): Promise<string> {
  const cacheKey = hashString(`${concept.name}:${concept.description}`);
  const cachedUrl = await checkStorageCache(supabase, cacheKey);
  if (cachedUrl) return cachedUrl;

  // 1. Create task
  const taskResponse = await fetch("https://api.tripo3d.ai/v2/openapi/task", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("TRIPO_API_KEY")}`
    },
    body: JSON.stringify({
      type: "text_to_model",
      prompt: `Low-poly stylized 3D model of: ${concept.name}. ${concept.description}. Style: game asset, clean, colorful.`,
      model_version: "v2.0-20240919",
      texture: true
    })
  });
  const { data: { task_id } } = await taskResponse.json();

  // 2. Poll for completion (max 30s, poll every 2s)
  let glbUrl: string | null = null;
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const statusResp = await fetch(
      `https://api.tripo3d.ai/v2/openapi/task/${task_id}`,
      { headers: { "Authorization": `Bearer ${Deno.env.get("TRIPO_API_KEY")}` } }
    );
    const { data } = await statusResp.json();
    if (data.status === "success") {
      glbUrl = data.output.model;
      break;
    }
    if (data.status === "failed") throw new Error(`Tripo AI failed for ${concept.name}`);
  }

  if (!glbUrl) throw new Error(`Tripo AI timeout for ${concept.name}`);

  // 3. Download GLB and upload to Supabase Storage
  const glbBlob = await fetch(glbUrl).then(r => r.arrayBuffer());
  const storagePath = `artifacts/${cacheKey}.glb`;
  await supabase.storage.from("artifacts").upload(storagePath, glbBlob, {
    contentType: "model/gltf-binary",
    upsert: true
  });

  const { data: { publicUrl } } = supabase.storage.from("artifacts").getPublicUrl(storagePath);
  return publicUrl;
}
```

**Parallel Execution:** All concepts are generated concurrently using `Promise.allSettled`. Failed models fall back to a placeholder URL:

```typescript
const PLACEHOLDER_GLB = `${SUPABASE_STORAGE_URL}/artifacts/placeholder.glb`;

const artifactResults = await Promise.allSettled(
  concepts.map(c => generateArtifactModel(c, supabase))
);

const artifactUrls = artifactResults.map((result, i) =>
  result.status === "fulfilled" ? result.value : PLACEHOLDER_GLB
);
```

**Fallback:** A pre-uploaded `placeholder.glb` (simple glowing cube, ~10KB) is stored in the artifacts bucket.

### 8.3 Supabase Configuration

**Required Environment Variables (Edge Functions):**
```
SUPABASE_URL=https://{project_ref}.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ANTHROPIC_API_KEY=sk-ant-...
TRIPO_API_KEY=tsk_...
```

**Edge Function Deployment:**
```bash
supabase functions deploy ingest
supabase functions deploy generate-palace
supabase functions deploy npc-chat
```

**CORS Configuration (each function's index.ts):**
```typescript
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Handle OPTIONS preflight
if (req.method === "OPTIONS") {
  return new Response(null, { headers: corsHeaders });
}
```

---

## 9. Module Boundaries and File Structure

```
loci/
├── src/
│   ├── plugin/                          # Obsidian plugin (esbuild bundle)
│   │   ├── main.ts                      # Plugin entry: onload, commands, ribbon
│   │   ├── settings.ts                  # Settings tab (API endpoint)
│   │   ├── api.ts                       # Backend API client (requestUrl wrapper)
│   │   ├── traversal.ts                 # Wikilink traversal logic
│   │   └── modals/
│   │       └── generate-modal.ts        # Generation modal (note select, theme, depth)
│   │
│   ├── web/                             # 3D viewer app (Vite + TypeScript)
│   │   ├── main.ts                      # Entry: routing, palace loading orchestration
│   │   ├── engine/
│   │   │   └── setup.ts                 # noa-engine initialization, block registration
│   │   ├── world/
│   │   │   ├── generator.ts             # Top-level world builder (orchestrates below)
│   │   │   ├── spaces.ts                # Build rooms from Space config
│   │   │   └── paths.ts                 # Build corridors from Path config
│   │   ├── themes/
│   │   │   ├── applicator.ts            # Apply theme to noa (lighting, fog, skybox)
│   │   │   ├── nature.ts                # Nature theme config
│   │   │   ├── cityscape.ts             # Cityscape theme config
│   │   │   └── space-station.ts         # Space Station theme config
│   │   ├── artifacts/
│   │   │   └── loader.ts                # GLB loading via Babylon.js GLTF loader
│   │   ├── npcs/
│   │   │   ├── manager.ts               # NPC lifecycle, proximity, interaction
│   │   │   └── renderer.ts              # Build voxel NPC body from config
│   │   └── ui/
│   │       ├── dialogue.ts              # Chat panel overlay (SSE streaming)
│   │       ├── minimap.ts               # 2D top-down minimap canvas
│   │       ├── hud.ts                   # Interaction prompts, crosshair
│   │       └── library.ts              # Palace selection / library page
│   │
│   ├── shared/                          # Shared between plugin + web
│   │   └── types.ts                     # All TypeScript interfaces from Section 2
│   │
│   └── functions/                       # Supabase Edge Functions (Deno)
│       ├── ingest/
│       │   └── index.ts                 # POST /ingest handler
│       ├── generate-palace/
│       │   ├── index.ts                 # POST /generate-palace handler
│       │   ├── enrichment.ts            # Stage 1: Claude Sonnet enrichment
│       │   ├── layout.ts                # Stage 2: ForceAtlas2 + Louvain + rot-js
│       │   └── tripo.ts                 # Tripo AI integration + caching
│       └── npc-chat/
│           └── index.ts                 # POST /npc-chat handler (SSE)
│
├── public/                              # Static assets for web app
│   └── placeholder.glb                  # Fallback artifact model
│
├── supabase/
│   ├── config.toml                      # Supabase project config
│   └── migrations/
│       └── 001_initial_schema.sql       # Tables from Section 7.1
│
├── package.json                         # Web app dependencies
├── vite.config.ts                       # Vite config for web app
├── tsconfig.json                        # TypeScript config
└── esbuild.config.mjs                   # Plugin build config
```

### Module Dependencies (directed, no cycles)

```
plugin/main.ts
  ├── plugin/settings.ts
  ├── plugin/api.ts ── shared/types.ts
  ├── plugin/traversal.ts
  └── plugin/modals/generate-modal.ts ── plugin/api.ts

web/main.ts
  ├── web/engine/setup.ts ── shared/types.ts
  ├── web/world/generator.ts
  │   ├── web/world/spaces.ts ── shared/types.ts
  │   └── web/world/paths.ts ── shared/types.ts
  ├── web/themes/applicator.ts ── shared/types.ts
  ├── web/artifacts/loader.ts ── shared/types.ts
  ├── web/npcs/manager.ts
  │   └── web/npcs/renderer.ts ── shared/types.ts
  └── web/ui/dialogue.ts ── shared/types.ts

functions/*/index.ts ── shared/types.ts (via copy, Deno cannot import from npm workspace)
```

---

## 10. Web App Routing

The Vite web app uses hash-based routing (no server-side routing needed):

| Route | View | Description |
|-------|------|-------------|
| `/#/` | Library | List of all palaces, click to enter |
| `/#/palace/{palace_id}` | Palace Viewer | Load and render a specific palace |

**Palace Loading Sequence:**
1. Parse `palace_id` from URL hash.
2. Fetch palace config: `GET /rest/v1/palaces?id=eq.{palace_id}&select=palace_config` (Supabase PostgREST).
3. Initialize noa-engine.
4. Register blocks from theme palette.
5. Apply lighting, fog, skybox.
6. Generate world geometry from spaces and paths.
7. Load artifacts (lazy, parallel).
8. Spawn NPCs.
9. Set player position to spawn_point.
10. Start render loop.

Target: steps 3-10 complete in under 10 seconds (NFC-3). Artifact GLB loading may extend beyond this but does not block exploration.

---

## 11. Traceability Matrix

| Requirement | HLD Section | ADR | EIS Section | Implementation Target |
|------------|-------------|-----|-------------|----------------------|
| G-1: Notes to palace | 3.1, 4.1 | — | 1.1, 1.2, 4 | Plugin + Edge Functions |
| G-2: Spatial topology mirrors concepts | 5, 6 (KD-3) | ADR-003 | 1.2 (Stage 2), 2 (Space, Path) | `functions/generate-palace/layout.ts` |
| G-3: Themed environments | 5, 6 (KD-4) | — | 3, 2 (ThemeConfig) | `web/themes/*.ts` |
| G-4: NPC guides with LLM | 3.2, 4.2 | — | 1.3, 2 (NPC), 5.6-5.7 | `web/npcs/`, `functions/npc-chat/` |
| G-5: Multiple maps | 3.2, 4.3 | — | 7, 10 (Library route) | `web/ui/library.ts` |
| G-6: Procedural generation | 5, 6 (KD-1) | — | 1.2 (seed), 5.4 | `web/world/generator.ts` |
| FR-1: User selects notes | 3.2 | — | 4.2 (Generation Modal) | `plugin/modals/generate-modal.ts` |
| FR-2: Wikilink traversal | 3.2 | ADR-004 | 4.3 (collectNotes) | `plugin/traversal.ts` |
| FR-3: Concept extraction | 3.2 | — | 1.1, 8.1 | `functions/ingest/index.ts` |
| FR-5: Spatial layout from graph | 3.2, 5 | ADR-003 | 1.2 (Stage 2) | `functions/generate-palace/layout.ts` |
| FR-6: Importance determines size | 6 (KD-3) | ADR-003 | 2 (Space.size, Concept.display_size) | `functions/generate-palace/layout.ts` |
| FR-7: Paths connect spaces | 5 | — | 2 (Path), 5.4 | `web/world/paths.ts` |
| FR-8: Theme applied | 5, 6 (KD-4) | — | 3, 5.3 | `web/themes/applicator.ts` |
| FR-9: Randomized seed | 5, 6 (KD-1) | — | 1.2 (seed), 2 (PalaceConfig.seed) | `functions/generate-palace/layout.ts` |
| FR-10: Concept clustering | 5 | ADR-003 | 1.2 (Louvain), 2 (Space.zone_id) | `functions/generate-palace/layout.ts` |
| FR-11: FPS exploration | 3.2 | ADR-001 | 5.2 | `web/engine/setup.ts` |
| FR-12: Voxel aesthetic | 3.2 | ADR-001 | 5.2, 5.3 | `web/engine/setup.ts` |
| FR-13: 3D artifacts | 3.2 | ADR-002 | 2 (Artifact), 5.5 | `web/artifacts/loader.ts` |
| FR-14: Concept-related artifacts | 3.2 | ADR-002 | 8.2 (prompt) | `functions/generate-palace/tripo.ts` |
| FR-15: NPC guides | 3.2 | OQ-6 | 2 (NPC), 5.6 | `web/npcs/manager.ts` |
| FR-16: Click to talk | 4.2 | — | 5.6 (proximity + E key) | `web/npcs/manager.ts` |
| FR-17: LLM dialogue | 3.2, 4.2 | — | 1.3 (system prompt) | `functions/npc-chat/index.ts` |
| FR-18: Streaming responses | 4.2 | — | 1.3 (SSE), 5.7 | `web/ui/dialogue.ts` |
| FR-19: Map persistence | 3.2 | — | 7.1 (palaces table) | `functions/generate-palace/index.ts` |
| FR-20: Map library | 3.2, 4.3 | — | 10 (Library route) | `web/ui/library.ts` |
| FR-21: Open from plugin | 3.2 | — | 4.5 | `plugin/main.ts` |
| FR-22: Store metadata | 3.2 | ADR-006 | 2 (PalaceMetadata) | `functions/generate-palace/index.ts` |
| FR-23: Theme picker | 3.2 | — | 4.2 (Generation Modal) | `plugin/modals/generate-modal.ts` |
| FR-24: Theme affects rendering | 5, 6 (KD-4) | — | 3 (full theme definitions) | `web/themes/*.ts` |
| FR-25: 3 MVP themes | 5 | — | 3.1, 3.2, 3.3 | `web/themes/nature.ts`, etc. |
| NFC-1: 30+ FPS | 5 | ADR-001 | 5.2, 5.8 | noa-engine chunk rendering |
| NFC-2: <60s generation | 4.1, 6 (KD-6) | ADR-005 | 1.2 (timeout 55s), 8.2 (parallel) | `functions/generate-palace/` |
| NFC-3: <10s load | 6 (KD-1) | ADR-006 | 5.4, 10 (loading sequence) | `web/main.ts` |
| NFC-4: <2s NPC latency | 4.2 | — | 1.3 (Haiku streaming) | `functions/npc-chat/index.ts` |
| NFC-5: Browser support | 5 | — | 5.2 (noa-engine + Babylon.js) | Vite build |
| NFC-6: 10-50KB config | 6 (KD-1) | ADR-006 | 2 (schema size budget) | All types in `shared/types.ts` |
| NFC-7: Free tier infra | 5 | — | 8.3 | Supabase free + Vercel free |
| NFC-8: <$5/map cost | 5, 6 (KD-6) | ADR-003 | 8.1, 8.2 (cost estimates) | Model selection + caching |
| NFC-9: Standard plugin API | 5 | — | 4 (requestUrl, Modal, Setting) | `plugin/main.ts` |
| NFC-10: Max 50 concepts | 8 | ADR-004 | 1.1 (truncation) | `functions/ingest/index.ts` |
