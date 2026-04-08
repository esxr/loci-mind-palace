// ─── Loci Shared Types ───
// Transcribed verbatim from Implementation Specification Section 2.
// This is the central data contract. The server produces it; the client consumes it.

// ─── Union Types / Enums ───

export type SpaceShape = "rectangular" | "circular" | "organic";

export type PathStyle = "corridor" | "trail" | "bridge" | "tunnel";

export type RelationshipType =
  | "prerequisite"
  | "contains"
  | "relates_to"
  | "example_of"
  | "contrasts_with";

export type SpatialHint = "central" | "gateway" | "peripheral" | "standard";

export type DisplaySize = "large" | "medium" | "small";

export type CorridorStyle = "wide" | "narrow" | "bridge";

export type ParticleType =
  | "fireflies"
  | "rain"
  | "snow"
  | "embers"
  | "bubbles"
  | "dust"
  | "stars";

export type ThemeSpaceShape = "organic" | "geometric" | "mixed";

export type ThemePathStyle = "trails" | "corridors" | "bridges" | "tunnels";

export type SkyboxType = "gradient" | "color";

export type PalaceStatus = "generating" | "ready" | "error";

// ─── Room Archetypes & Moods (Feature 6: Memory Anchors) ───

export type RoomArchetype =
  | "laboratory"
  | "library"
  | "garden"
  | "amphitheater"
  | "observatory"
  | "workshop"
  | "gallery"
  | "chamber";

export type AmbientMood =
  | "serene"
  | "energetic"
  | "mysterious"
  | "clinical"
  | "warm";

// ─── Path Direction (Feature 3: Prerequisite Chains) ───

export type PathDirection = "forward" | "lateral" | "none";

// ─── Spatial Layout ───

export interface WorldPosition {
  x: number;                        // World-space voxel coordinate
  y: number;                        // Vertical (0 = ground level)
  z: number;
}

export interface BoundingBox {
  min: WorldPosition;
  max: WorldPosition;
}

// ─── Concept Graph (Input Data, Preserved in Config) ───

export interface ConceptGraph {
  concepts: Concept[];
  relationships: Relationship[];
}

export interface Concept {
  id: string;                       // snake_case unique ID (e.g. "mitochondria")
  name: string;                     // Human-readable (e.g. "Mitochondria")
  description: string;              // 1-2 sentence description
  importance: number;               // 1-10
  cluster_label: string;            // Topic cluster (e.g. "cell_biology")
  source_notes: string[];           // Note titles this concept appears in
  spatial_hint: SpatialHint;
  display_size: DisplaySize;
}

export interface Relationship {
  source_id: string;
  target_id: string;
  type: RelationshipType;
  strength: number;                 // 1-10
  corridor_style: CorridorStyle;
}

// ─── Spaces ───

export interface Space {
  id: string;                       // Matches concept.id
  concept_id: string;               // Reference to the concept
  position: WorldPosition;          // Bottom-left-front corner of the space
  size: {
    width: number;                  // X extent in blocks (8 | 12 | 16 | 20)
    height: number;                 // Y extent in blocks (always 6 for walkability)
    depth: number;                  // Z extent in blocks (8 | 12 | 16 | 20)
  };
  shape: SpaceShape;
  zone_id: number;                  // Louvain cluster ID
  zone_name: string;                // Human-readable cluster name (e.g., "Cell Biology")
  zone_color: string;               // Hex color accent for this zone
  floor_block: string;              // Block type ID from theme palette
  wall_block: string;               // Block type ID from theme palette
  ceiling_block: string | null;     // null = open sky/space
  has_ceiling: boolean;
  archetype: RoomArchetype;         // Room type for distinct spatial identity
  ambient_mood: AmbientMood;        // Feeling/atmosphere of the space
}

// ─── Paths ───

export interface Path {
  id: string;                       // "{source_space_id}_to_{target_space_id}"
  source_space_id: string;
  target_space_id: string;
  waypoints: WorldPosition[];       // Ordered list of points defining the path
  width: number;                    // 2 (narrow) | 3 (standard) | 4 (wide)
  floor_block: string;              // Block type ID from theme palette
  wall_block: string | null;        // null = open path (no corridor walls)
  style: PathStyle;
  direction: PathDirection;         // forward = prerequisite flow, lateral = relates_to
}

// ─── Artifacts ───

export interface Artifact {
  id: string;                       // "{concept_id}_artifact"
  concept_id: string;
  position: WorldPosition;          // World position of the artifact center
  glb_url: string;                  // Public Supabase Storage URL to GLB file
  scale: number;                    // Uniform scale factor (default 1.0)
  rotation_y: number;               // Y-axis rotation in radians
  pedestal: Pedestal;
}

export interface Pedestal {
  block: string;                    // Block type ID from theme palette
  width: number;                    // Pedestal base width in blocks (2 | 3)
  height: number;                   // Pedestal height in blocks (1 | 2)
}

// ─── NPCs ───

export interface NPC {
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

export interface NPCVoxelModel {
  style: string;                    // Theme-defined style ID (e.g. "forest_sage", "robot")
  palette: {
    body: string;                   // Hex color
    head: string;                   // Hex color
    accent: string;                 // Hex color
  };
  height_blocks: number;            // NPC height in blocks (typically 3)
}

// ─── Theme Configuration ───

export interface ThemeConfig {
  id: string;                       // "nature" | "cityscape" | "space_station"
  name: string;                     // Display name
  palette: BlockPalette;
  lighting: LightingConfig;
  fog: FogConfig;
  particles: ParticleConfig[];
  space_shape: ThemeSpaceShape;
  path_style: ThemePathStyle;
  npc_style: NPCStyleConfig;
  pedestal_style: PedestalStyleConfig;
  skybox: SkyboxConfig;
}

export interface BlockPalette {
  ground: BlockType[];              // Floor block options
  walls: BlockType[];               // Wall block options
  paths: BlockType[];               // Path surface options
  accent: BlockType[];              // Decorative block options
  pedestal: BlockType[];            // Artifact pedestal options
}

export interface BlockType {
  id: string;                       // Unique block type ID (e.g. "grass", "stone_brick")
  color: [number, number, number];  // RGB 0-255 for solid color blocks
  texture_url: string | null;       // Optional texture atlas URL (null = solid color)
}

export interface LightingConfig {
  ambient: { color: string; intensity: number };
  directional: {
    color: string;
    intensity: number;
    direction: [number, number, number];
  };
}

export interface FogConfig {
  color: string;                    // Hex color
  near: number;                     // Fog start distance in blocks
  far: number;                      // Fog end distance in blocks
}

export interface ParticleConfig {
  type: ParticleType;
  density: number;                  // 0.0-1.0
  color: string;                    // Hex color
}

export interface SkyboxConfig {
  type: SkyboxType;
  top_color: string;                // Hex color
  bottom_color: string;             // Hex color
}

export interface NPCStyleConfig {
  default_style: string;            // Style ID applied to all NPCs in this theme
  palette_template: {
    body: string;
    head: string;
    accent: string;
  };
}

export interface PedestalStyleConfig {
  default_block: string;            // Block type ID
  default_width: number;
  default_height: number;
}

// ─── Zone Styling (Feature 1: Semantic Clustering) ───

export interface ZoneStyle {
  name: string;
  accent_color: string;             // Hex — used for wall tint, archway color
  wall_tint: [number, number, number];  // RGB modifier applied to base wall color
}

// ─── Top-Level Config ───

export interface PalaceConfig {
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
  learning_path: string[];          // Ordered concept IDs forming the recommended walkthrough
}

export interface PalaceMetadata {
  name: string;                     // Auto-generated or user-provided palace name
  created_at: string;               // ISO 8601 timestamp
  concept_count: number;
  theme_id: string;
  generation_time_ms: number;       // How long generation took
}

// ─── API Request/Response Types ───

export interface NoteContent {
  title: string;                    // Note filename without .md extension
  content: string;                  // Full markdown content including [[wikilinks]]
}

export interface IngestRequest {
  notes: NoteContent[];
  traversal_depth: number;          // 1 | 2 | 3, default 2
}

export interface IngestResponse {
  graph_id: string;                 // UUID
  concept_graph: ConceptGraph;
}

export interface GeneratePalaceRequest {
  graph_id: string;                 // UUID from /ingest response
  theme_id: string;                 // "nature" | "cityscape" | "space_station"
  seed?: number;                    // Optional random seed for deterministic regeneration
}

export interface GeneratePalaceResponse {
  palace_id: string;                // UUID
  palace_url: string;               // https://{VERCEL_URL}/palace/{palace_id}
  palace_config: PalaceConfig;
}

export interface NPCChatRequest {
  palace_id: string;                // UUID
  concept_id: string;               // Concept ID within the palace
  message: string;                  // User's message to the NPC
  conversation_history: ChatMessage[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
