// ─── Deno Edge Function Types ───
// Inline copy of shared types for Deno runtime (cannot import from npm workspace).

// ─── Concept Graph ───

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
  spatial_hint: "central" | "gateway" | "peripheral" | "standard";
  display_size: "large" | "medium" | "small";
}

export interface Relationship {
  source_id: string;
  target_id: string;
  type: "prerequisite" | "contains" | "relates_to" | "example_of" | "contrasts_with";
  strength: number;                 // 1-10
  corridor_style: "wide" | "narrow" | "bridge";
}

// ─── Spatial Layout ───

export interface WorldPosition {
  x: number;
  y: number;
  z: number;
}

export interface BoundingBox {
  min: WorldPosition;
  max: WorldPosition;
}

export interface Space {
  id: string;
  concept_id: string;
  position: WorldPosition;
  size: {
    width: number;
    height: number;
    depth: number;
  };
  shape: "rectangular" | "circular" | "organic";
  zone_id: number;
  floor_block: string;
  wall_block: string;
  ceiling_block: string | null;
  has_ceiling: boolean;
}

export interface Path {
  id: string;
  source_space_id: string;
  target_space_id: string;
  waypoints: WorldPosition[];
  width: number;
  floor_block: string;
  wall_block: string | null;
  style: "corridor" | "trail" | "bridge" | "tunnel";
}

// ─── Artifacts ───

export interface Artifact {
  id: string;
  concept_id: string;
  position: WorldPosition;
  glb_url: string;
  scale: number;
  rotation_y: number;
  pedestal: Pedestal;
}

export interface Pedestal {
  block: string;
  width: number;
  height: number;
}

// ─── NPCs ───

export interface NPC {
  id: string;
  concept_id: string;
  name: string;
  position: WorldPosition;
  facing: number;
  voxel_model: NPCVoxelModel;
  dialogue_context: {
    concept_description: string;
    neighbor_ids: string[];
  };
}

export interface NPCVoxelModel {
  style: string;
  palette: {
    body: string;
    head: string;
    accent: string;
  };
  height_blocks: number;
}

// ─── Theme Configuration ───

export interface ThemeConfig {
  id: string;
  name: string;
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

export interface BlockPalette {
  ground: BlockType[];
  walls: BlockType[];
  paths: BlockType[];
  accent: BlockType[];
  pedestal: BlockType[];
}

export interface BlockType {
  id: string;
  color: [number, number, number];
  texture_url: string | null;
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
  color: string;
  near: number;
  far: number;
}

export interface ParticleConfig {
  type: "fireflies" | "rain" | "snow" | "embers" | "bubbles" | "dust" | "stars";
  density: number;
  color: string;
}

export interface SkyboxConfig {
  type: "gradient" | "color";
  top_color: string;
  bottom_color: string;
}

export interface NPCStyleConfig {
  default_style: string;
  palette_template: {
    body: string;
    head: string;
    accent: string;
  };
}

export interface PedestalStyleConfig {
  default_block: string;
  default_width: number;
  default_height: number;
}

// ─── Top-Level Config ───

export interface PalaceConfig {
  schema_version: 1;
  palace_id: string;
  seed: number;
  theme: ThemeConfig;
  metadata: PalaceMetadata;
  concept_graph: ConceptGraph;
  spaces: Space[];
  paths: Path[];
  artifacts: Artifact[];
  npcs: NPC[];
  spawn_point: WorldPosition;
}

export interface PalaceMetadata {
  name: string;
  created_at: string;
  concept_count: number;
  theme_id: string;
  generation_time_ms: number;
}

// ─── API Types ───

export interface NoteContent {
  title: string;
  content: string;
}

export interface IngestRequest {
  notes: NoteContent[];
  traversal_depth: number;
}

export interface IngestResponse {
  graph_id: string;
  concept_graph: ConceptGraph;
}

export interface GeneratePalaceRequest {
  graph_id: string;
  theme_id: string;
  seed?: number;
}

export interface GeneratePalaceResponse {
  palace_id: string;
  palace_url: string;
  palace_config: PalaceConfig;
}

export interface NPCChatRequest {
  palace_id: string;
  concept_id: string;
  message: string;
  conversation_history: ChatMessage[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
