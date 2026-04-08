# High-Level Design: Loci — Mind Palace Generator

**Version:** 1.1
**Date:** 2026-04-08
**Status:** Revised (all open questions resolved)
**Based on:** Intent & Constraints v1.0, ADR-Lite v1.0

---

## 1. Overview

Loci is a two-component system that transforms Obsidian study notes into walkable, procedurally generated 3D mind palaces. An **Obsidian plugin** selects notes, traverses `[[wikilinks]]`, extracts a structured knowledge graph via LLM, and sends it to a **deployed web application** that generates and renders explorable voxel environments. Concepts become spatially encoded artifacts and NPC guides — so walking the palace is walking the knowledge graph.

The system targets the CSIRO hackathon challenge: creating immersive, AI-driven learning experiences where students build and interact with their own 3D worlds.

---

## 2. Goals and Non-Goals

### Goals (from Intent G-1 through G-6)

- **G-1:** Transform user-selected Obsidian notes into a walkable 3D mind palace
- **G-2:** Mirror conceptual relationships in spatial topology (adjacency = relatedness)
- **G-3:** Offer themed environments for variety and engagement
- **G-4:** Enable LLM-powered conversational exploration via NPC guides
- **G-5:** Support multiple distinct maps per subject/chapter/boundary
- **G-6:** Procedural generation with randomized seeds for unique, replayable experiences

### Non-Goals

- User authentication or accounts (single-user tool)
- Payments or credits system
- Multiplayer or collaborative exploration
- Mobile or VR/AR support
- Publishing to Obsidian community plugin registry (manual install for demo)
- Real-time collaborative editing of notes

---

## 3. System Architecture

### 3.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER'S MACHINE                               │
│                                                                     │
│  ┌──────────────────────┐          ┌─────────────────────────────┐  │
│  │   Obsidian Desktop   │          │   Browser (Chrome/FF/Edge)  │  │
│  │                      │          │                             │  │
│  │  ┌────────────────┐  │  opens   │  ┌───────────────────────┐  │  │
│  │  │  Loci Plugin   │──┼──URL────▶│  │  Loci Web App         │  │  │
│  │  │                │  │          │  │  (Vite + TypeScript)   │  │  │
│  │  │ • Note select  │  │          │  │                       │  │  │
│  │  │ • Wikilink     │  │          │  │ • Palace renderer     │  │  │
│  │  │   traversal    │  │          │  │   (noa-engine/         │  │  │
│  │  │   (depth 1-3,  │  │          │  │    Babylon.js)         │  │  │
│  │  │    default 2)  │  │          │  │ • FPS exploration     │  │  │
│  │  │ • Theme picker │  │          │  │ • NPC dialogue UI     │  │  │
│  │  │ • Map library  │  │          │  │ • Map library         │  │  │
│  │  └───────┬────────┘  │          │  └───────────┬───────────┘  │  │
│  └──────────┼───────────┘          │              │              │  │
└─────────────┼──────────────────────┼──────────────┼──────────────┘  │
              │                      │              │                  │
              │  REST API            │              │  REST + SSE      │
              ▼                      │              ▼                  │
┌─────────────────────────────────────────────────────────────────────┐
│                     SUPABASE (hosted, free tier)                     │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    Edge Functions (Deno)                      │   │
│  │                                                              │   │
│  │  ┌──────────┐   ┌──────────────────┐   ┌────────────────┐   │   │
│  │  │ /ingest  │   │ /generate-palace │   │  /npc-chat     │   │   │
│  │  │          │   │                  │   │  (SSE stream)  │   │   │
│  │  └────┬─────┘   └───────┬──────────┘   └───────┬────────┘   │   │
│  │       │                 │                       │            │   │
│  └───────┼─────────────────┼───────────────────────┼────────────┘   │
│          │                 │                       │                 │
│          ▼                 ▼                       ▼                 │
│  ┌────────────┐    ┌────────────┐         ┌────────────┐           │
│  │ Postgres   │    │  Storage   │         │ Postgres   │           │
│  │ (concepts, │    │  (3D model │         │ (concept   │           │
│  │  relations,│    │   GLBs)    │         │  context)  │           │
│  │  palaces)  │    │            │         │            │           │
│  └────────────┘    └────────────┘         └────────────┘           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
              │                 │
              ▼                 ▼
┌──────────────────┐  ┌──────────────────┐
│  Claude API      │  │  Tripo AI API    │
│  (Haiku + Sonnet)│  │  (text-to-3D)    │
│                  │  │                  │
│  • Concept       │  │  • GLB model     │
│    extraction    │  │    generation    │
│  • Layout hints  │  │  • ~2s per model │
│  • NPC dialogue  │  │                  │
└──────────────────┘  └──────────────────┘
```

### 3.2 Component Descriptions

| Component | Responsibility | Key Interfaces | Traces to |
|-----------|---------------|----------------|-----------|
| **Loci Plugin** (Obsidian) | Note selection, wikilink traversal (user-configurable depth, default 2 hops — See ADR-004), note content packaging, theme selection, palace launching | `requestUrl` → Backend REST API; opens browser URL | FR-1, FR-2, FR-4, FR-21, FR-23 |
| **Backend: /ingest** | Receives raw notes, calls Claude for concept extraction, stores concept graph | REST endpoint; Claude API (structured output); Postgres writes | FR-3, FR-4 |
| **Backend: /generate-palace** | Reads concept graph, generates spatial layout via hybrid LLM+algorithmic pipeline (See ADR-003), triggers 3D artifact generation, assembles detailed palace config with pre-computed positions (See ADR-006) | REST endpoint; Claude API; Tripo API; Postgres + Storage writes | FR-5–FR-10, FR-13, FR-14, FR-22 |
| **Backend: /npc-chat** | Loads concept context, streams LLM dialogue response | SSE stream endpoint; Claude API (Haiku) | FR-15–FR-18 |
| **Loci Web App: Palace Renderer** | Loads palace config JSON, generates voxel geometry client-side via noa-engine (See ADR-001), places smooth GLB artifacts on voxel pedestals (See ADR-002), renders themed 3D environment | Fetches config from Backend; renders via noa-engine (Babylon.js) | FR-11, FR-12, FR-8, NFC-1, NFC-3 |
| **Loci Web App: NPC Dialogue UI** | Click-to-talk interaction, streaming text display | SSE client → /npc-chat | FR-16, FR-17, FR-18, NFC-4 |
| **Loci Web App: Map Library** | Browse, select, and load previously generated palaces | REST reads from Backend; browser localStorage for recent maps | FR-19, FR-20 |
| **Supabase Postgres** | Persistent storage for concepts, relationships, palace configs, metadata | SQL via Supabase client | FR-19, FR-22 |
| **Supabase Storage** | Binary storage for generated 3D model files (GLB) | Object storage with public URLs | FR-13, FR-14 |

---

## 4. Data Flow

### 4.1 Palace Generation Flow (Primary)

```
User selects notes + theme in Obsidian
          │
          ▼
┌─── Plugin: Wikilink Traversal ───┐
│ • Reads selected notes            │
│ • Follows [[wikilinks]]           │
│   (user-configurable depth 1-3,   │  ◄── Resolved: default 2 hops (See ADR-004)
│    default 2 hops)                │
│ • Collects all note content       │
│ • Packages as {notes[], theme,    │
│   depth}                          │
└──────────────┬───────────────────┘
               │ POST /ingest
               ▼
┌─── Backend: Concept Extraction ──┐
│ • Sends note content to Claude    │
│   Haiku (structured output)       │
│ • Receives: concepts[] with       │
│   {name, description, importance, │
│    category} + relationships[]    │
│ • Stores in Postgres              │
│ • Returns concept_graph_id        │
└──────────────┬───────────────────┘
               │ POST /generate-palace
               ▼
┌─── Backend: Layout Generation ───┐
│ • Loads concept graph from DB     │
│ • Stage 1: Claude Sonnet enriches │  ◄── Hybrid layout (See ADR-003)
│   graph with importance scores,   │
│   cluster labels, spatial hints   │
│ • Stage 2: Algorithmic placement  │
│   - Louvain clustering → zones    │
│   - ForceAtlas2 → positions       │
│   - rot-js → room geometry, paths │
│ • Applies theme parameters        │
│ • Calls Tripo AI (parallel) →     │  ◄── Smooth GLB, no voxelization (See ADR-002, ADR-005)
│   generates GLB per concept       │
│ • Stores GLBs in Supabase Storage │
│ • Assembles detailed palace config│  ◄── Pre-computed positions (See ADR-006)
│   with all spatial data           │
│ • Stores config in Postgres       │
│ • Returns {palace_id, url}        │
└──────────────┬───────────────────┘
               │
               ▼
Plugin opens URL in default browser
               │
               ▼
┌─── Web App: Palace Loading ──────┐
│ • Fetches palace config JSON      │
│ • Generates voxel geometry from   │
│   spatial config using noa-engine │  ◄── noa-engine on Babylon.js (See ADR-001)
│ • Applies theme (textures,        │
│   lighting, particles)            │
│ • Loads smooth GLB artifact       │  ◄── Smooth GLB on voxel pedestals (See ADR-002)
│   models via Babylon.js GLTF      │
│   loader, places on voxel         │
│   pedestals                       │
│ • Spawns voxel NPC entities       │  ◄── Block-built voxel characters (See ADR OQ-6)
│ • User enters first-person view   │
└──────────────────────────────────┘
```

### 4.2 NPC Interaction Flow

```
User approaches NPC in 3D world → proximity indicator appears
          │
          ▼
User clicks NPC → dialogue panel opens
          │
          ▼
POST /npc-chat {palace_id, concept_id, user_message}
          │
          ▼
Backend loads concept context:
  • concept.name, concept.description
  • source note excerpts
  • related concepts (1-hop neighbors)
          │
          ▼
Claude Haiku streams response (SSE)
  System: "You are {name}, a guide in a mind palace.
           You represent: {description}
           Related concepts: {neighbors}
           Source material: {excerpts}
           Speak in character. Help the user understand."
          │
          ▼
Web App renders text word-by-word in dialogue panel
```

### 4.3 Map Library Flow

```
User opens web app (or clicks "Map Library" in plugin)
          │
          ▼
Web App fetches palace list from Backend
  (filtered by browser localStorage IDs, or all recent)
          │
          ▼
Displays cards: name, theme, concept count, date
          │
          ▼
User selects palace → loads config → renders world
```

---

## 5. Technology Choices

| Layer | Choice | Rationale | Traces to |
|-------|--------|-----------|-----------|
| **Plugin** | TypeScript + esbuild | Standard Obsidian plugin pattern; `requestUrl` for CORS-free HTTP | NFC-9 |
| **Web App Build** | Vite + TypeScript | Fast DX, native ESM, tree-shaking for 3D bundles | NFC-1, NFC-5 |
| **3D / Voxel Engine** | **noa-engine** (Babylon.js voxel engine) (See ADR-001) | Purpose-built for Minecraft-like voxel worlds; built-in chunk meshing, physics, FPS controls; ESM compatible with Vite; Babylon.js GLTF loader enables smooth GLB artifact rendering alongside voxels | FR-11, FR-12, NFC-1, NFC-3 |
| **Graph Analysis** | graphology | In-memory graph library; supports ForceAtlas2 layout + Louvain clustering | FR-5, FR-10 |
| **Spatial Layout** | ForceAtlas2 (via graphology) + LLM semantic enrichment (See ADR-003) | Hybrid two-stage: Sonnet provides importance/cluster metadata, ForceAtlas2 handles coordinate placement | FR-5, G-2 |
| **Clustering** | Louvain community detection (via graphology) | Groups related concepts into zones automatically | FR-10 |
| **Procedural Gen** | rot-js | Roguelike toolkit: cellular automata, BSP trees, A* pathfinding for paths | FR-7, FR-9, G-6 |
| **Interior Decoration** | Wave Function Collapse (`@zakkster/lite-wfc`) | Constraint-based procedural placement for themed details | FR-8, G-6 |
| **Text-to-3D** | Tripo AI API | ~2s generation, low-poly GLB output, cost-effective; rendered as smooth meshes on voxel pedestals (See ADR-002) | FR-13, FR-14 |
| **Backend Runtime** | Supabase Edge Functions (Deno) | Integrated with Postgres + Storage; zero infra setup; free tier | NFC-7 |
| **Database** | Supabase Postgres | Relational model for concept graphs; JSONB for palace configs | FR-19, FR-22 |
| **Object Storage** | Supabase Storage | Public bucket for generated GLB model files | FR-13 |
| **LLM: Extraction** | Claude Haiku (structured output) | Fast, cheap (~$0.001/note), guaranteed valid JSON via grammar-constrained generation | FR-3, NFC-8 |
| **LLM: Layout** | Claude Sonnet (See ADR-003) | Semantic enrichment: importance scores, cluster labels, relationship types, spatial hints for the algorithmic layout stage | FR-5, FR-6 |
| **LLM: NPC Chat** | Claude Haiku (streaming) | Fast, cheap, good enough for conversational dialogue | FR-17, FR-18, NFC-4 |
| **Deployment: Frontend** | Vercel (free tier) | Best Vite support, generous limits (100GB bandwidth), instant deploys | NFC-5, NFC-7 |
| **Deployment: Backend** | Supabase hosted (free tier) | Already managed, 500MB DB + 1GB storage + 500K function invocations | NFC-7 |

---

## 6. Key Design Decisions

### KD-1: Client-Side Geometry Generation

Palace config is a detailed JSON document with pre-computed positions (10–50KB per NFC-6, See ADR-006). The client generates all voxel geometry from this config at load time using noa-engine's block-placement API (See ADR-001). The server never stores or transmits mesh data.

**Why:** Keeps storage minimal, enables deterministic rendering from seed (FR-9), allows client-side LOD adjustment for performance, and means "regeneration" is instant without a server round-trip. Same config + seed = same world. The server computes the full spatial layout (positions, room dimensions, path waypoints, artifact/NPC placements) so the client is a pure renderer with fast load times (NFC-3).

### KD-2: Server-Side LLM and 3D API Calls

All Claude API and Tripo AI calls happen in Supabase Edge Functions. The client never holds API keys.

**Why:** Protects API keys. Allows caching (identical concept text → cached extraction; identical concept name → cached 3D model). Centralizes cost control.

### KD-3: Hybrid Layout Algorithm (LLM + Graph Algorithm) (See ADR-003)

Spatial layout uses a two-stage approach:
1. **LLM (Sonnet)** assigns semantic metadata: importance scores (0-10), cluster affinity labels, relationship type annotations (e.g., "prerequisite," "example," "contrast"), and optional spatial hints ("this should be central")
2. **Algorithm (ForceAtlas2 + Louvain + rot-js)** consumes the enriched graph and handles coordinate placement, overlap removal, room geometry, and path routing

**Why:** Pure LLM layout is unreliable for precise geometry (R-9). Pure algorithmic layout misses semantic nuance. The hybrid approach uses each tool where it excels. LLM cost is one Sonnet call per palace generation (~$0.10), well within NFC-8. The algorithmic stage is deterministic given the same enriched graph + seed (FR-9), and produces reasonable layouts even with flat/default metadata, so the LLM stage is an enhancement, not a dependency.

### KD-4: Theme as Data, Not Code

Each theme is a configuration object defining: block palette (voxel types + colors), lighting parameters, particle effects, space shape rules (organic vs geometric), path generation style, NPC voxel style, and **artifact pedestal design** (See ADR-002). Adding a new theme is adding a JSON/TypeScript config — no rendering code changes.

**Why:** Supports the 3 MVP themes (FR-25) with a clear path to all 6. Keeps the rendering engine theme-agnostic.

### KD-5: No Authentication — URL-Based Access

Palaces are stored server-side with UUID keys and accessed by URL. The plugin stores palace IDs in Obsidian's local plugin data. The web app uses `localStorage` to remember recently visited palaces for the map library.

**Why:** Auth is explicitly out of scope (single-user, hackathon demo). URL-based access is the simplest persistence model. A user's "library" is their plugin's stored IDs + browser history.

### KD-6: Parallel Text-to-3D Generation with Caching

Tripo AI calls are parallelized across all concepts during palace generation. Results are cached in Supabase Storage keyed by a hash of the concept name + description. Subsequent palaces reuse cached models. GLB models are rendered as smooth 3D objects on voxel pedestals — no voxelization step (See ADR-002, ADR-005).

**Why:** Sequential generation of 30 concepts at ~2s each = 60s (R-3). Parallel generation reduces this to ~2–4s wall time. Caching eliminates redundant API calls across palaces.

### KD-7: Smooth GLB Artifacts on Voxel Pedestals (See ADR-002)

Tripo AI GLB models are rendered as smooth 3D objects placed on theme-appropriate voxel pedestals. No voxelization is performed anywhere in the pipeline. The visual contrast between smooth artifacts and the voxel world is an intentional design choice — artifacts stand out as "the important things" in each space, directly aiding the Method of Loci memorization technique.

**Why:** Voxelization adds pipeline complexity, latency (threatening NFC-2), and destroys the detail that makes Tripo AI models visually interesting. Tripo AI already produces low-poly, stylized models that fit aesthetically alongside voxel geometry. This decision eliminates R-4 entirely and simplifies the generation pipeline.

### KD-8: User-Configurable Wikilink Traversal (See ADR-004)

The plugin UI exposes a traversal depth control (dropdown) with options 1, 2, or 3 hops. Default is 2. Combined with NFC-10's hard cap of 50 concepts, the system degrades gracefully for heavily linked vaults.

**Why:** Depth-2 captures the selected focus, immediate context, and broader neighborhood — typically yielding 15-40 notes. Making it configurable costs minimal UI effort and respects diverse vault structures.

### KD-9: Target Audience — Students of All Ages (See ADR-007)

Primary target is university and high school students who use Obsidian for study notes. UI is designed to be clean, intuitive, and accessible to younger users. NPC dialogue naturally adapts to content complexity.

**Why:** The product's value proposition is tightly coupled to Obsidian and complex interlinked notes. The CSIRO challenge emphasis on young learners is addressed through accessible UI design and pitch framing, not product redesign.

---

## 7. Open Questions

All open questions have been resolved via the ADR-Lite process (Phase 3).

### Ambiguities in Requirements

- [x] **~~OQ-1: 3D Engine Choice~~** *(Resolved — See ADR-001)* — **noa-engine** (Babylon.js-based voxel engine) is selected. It is purpose-built for Minecraft-like voxel worlds (FR-12), provides built-in first-person controls (FR-11), handles chunk-based rendering for performance (NFC-1), and avoids reimplementing voxel meshing. Babylon.js natively supports GLTF/GLB loading alongside voxel geometry, enabling the smooth artifact rendering decided in ADR-002.

- [x] **~~OQ-2: Artifact Rendering Style~~** *(Resolved — See ADR-002)* — **Smooth GLB artifacts on voxel pedestals.** Tripo AI GLB models are rendered as smooth 3D objects placed on theme-appropriate voxel pedestals. No voxelization step. The visual contrast is an intentional design choice: artifacts stand out as "special objects," aiding the Method of Loci technique. This eliminates R-4 (voxelization performance) entirely.

- [x] **~~OQ-3: Layout Algorithm Detail~~** *(Resolved — See ADR-003)* — **Hybrid two-stage approach.** Stage 1: Claude Sonnet provides semantic metadata (importance scores, cluster labels, relationship types, spatial hints). Stage 2: ForceAtlas2 + Louvain + rot-js handle all geometric placement, path routing, and overlap removal. LLM cost is ~$0.10 per generation. The algorithmic stage produces reasonable layouts even with default metadata, so the LLM stage is an enhancement, not a dependency.

- [x] **~~OQ-4: Wikilink Traversal Depth~~** *(Resolved — See ADR-004)* — **User-configurable, default 2 hops.** Plugin UI exposes a depth control (dropdown) with options 1, 2, or 3. Default of 2 captures selected focus plus two layers of context, typically yielding 15-40 notes. Combined with NFC-10's hard cap of 50 concepts, the system degrades gracefully.

### Design Alternatives

- [x] **~~OQ-5: Voxelization Location~~** *(Resolved — See ADR-005)* — **No voxelization is performed anywhere.** This follows directly from ADR-002: artifacts are rendered as smooth GLB meshes on voxel pedestals. The voxel world (rooms, paths, terrain) is generated client-side from the palace config JSON using noa-engine's native block-placement API. Tripo AI GLB models are loaded directly as smooth meshes via Babylon.js GLTF loader. R-4 is eliminated.

- [x] **~~OQ-6: NPC Representation~~** *(Resolved in HLD Phase 2)* — NPCs will be **voxel characters** (block-built figures like Minecraft mobs). Aesthetically consistent with the voxel world (FR-12), supports simple limb animations (idle sway, talk gesture). Each theme defines its own NPC voxel style.

- [x] **~~OQ-7: Map Config Schema~~** *(Resolved — See ADR-006)* — **Detailed schema with pre-computed positions.** The server computes the full spatial layout and sends a complete palace config containing: space positions/dimensions/block types, path waypoints, artifact placements with GLB URLs, NPC positions with concept bindings, theme configuration, generation seed, and metadata. The client is a pure renderer. Config size is 10-50KB (NFC-6). A `schema_version` field supports future format changes. Precise schema defined in EIS (Phase 5).

### Clarifications Needed

- [x] **~~OQ-8: 3D Engine Ecosystem~~** *(Resolved in HLD Phase 2)* — CSIRO REQUIREMENTS.md recommends "Manifest Engine," but no established web 3D engine by this name exists. We will use a mainstream engine with strong community support. The specific choice is **noa-engine on Babylon.js** (See ADR-001). Manifest Engine is dismissed.

- [x] **~~OQ-9: Target User Age~~** *(Resolved — See ADR-007)* — **Primary target: university and high school students** who use Obsidian for study notes. UI is designed to be clean, intuitive, and accessible to younger users. NPC dialogue naturally adapts to content complexity. Hackathon pitch frames as "students of all ages" while demonstrating university-level content. The Obsidian dependency means the tool is not standalone for young children; a future non-Obsidian input mode could broaden the age range but is post-MVP scope.

---

## 8. Risks and Mitigations

| ID | Risk | Impact | Likelihood | Mitigation | Status | Traces to |
|----|------|--------|------------|------------|--------|-----------|
| R-2 | Voxel engine browser compatibility — black screens or crashes on some GPUs | High | Medium | Test noa-engine (Babylon.js) on multiple browsers early (day 1); have WebGL error messaging; test on demo hardware (See ADR-001) | Active | NFC-1, NFC-5 |
| R-3 | Text-to-3D latency — 30 concepts × 2s = 60s sequential | High | High | Parallelize Tripo requests; cache in Supabase Storage; fall back to placeholder models if API is slow | Active | FR-13, NFC-2 |
| ~~R-4~~ | ~~Voxelization performance — GLB → voxel grid may be slow client-side~~ | ~~Medium~~ | ~~N/A~~ | **MITIGATED — No voxelization in pipeline.** ADR-002 chose smooth GLB rendering; ADR-005 confirmed no voxelization anywhere. This risk is eliminated. | **Eliminated** (See ADR-002, ADR-005) | ~~NFC-1, NFC-3~~ |
| R-5 | LLM API rate limits — extraction + chat could hit limits during demo | Medium | Medium | Use Haiku for chat (high rate limits); batch concept extraction; implement retry with exponential backoff | Active | FR-3, FR-17 |
| R-6 | Voxel engine + Vite bundler compatibility — CJS/ESM conflicts | Medium | Medium | noa-engine uses ESM, compatible with Vite (See ADR-001); test integration on day 1; have esbuild fallback config | Active | NFC-5 |
| R-7 | Scope creep — 3 themes + artifacts + NPCs + plugin in hackathon timeframe | High | High | Strict MVP: 1 theme first, then add 2 more; pre-generate demo palace as fallback; defer audio | Active | All MVP scope |
| R-8 | Serverless cold starts — edge function latency during demo | Low | Low | Warm functions before demo; optimize bundle size; pre-generate demo palace | Active | NFC-2, NFC-4 |
| R-9 | Graph layout quality — overlapping spaces or ugly path routing | Medium | Medium | Hybrid layout (See ADR-003): LLM semantic enrichment + algorithmic placement reduces risk of meaningless layouts; post-processing: overlap removal, path straightening; manual seed tuning for demo | Active | FR-5, G-2 |
| R-10 | Tripo AI API availability — third-party service could be down during demo | High | Low | Cache all generated models; have a set of pre-generated fallback models for demo concepts; check API status before demo | Active | FR-13, FR-14 |
| R-11 | Palace config too large — >50KB for complex concept graphs (50 concepts) | Medium | Low | Detailed but compact config schema (See ADR-006): positions and metadata, not geometry; store model URLs not model data; set max concept limit with graceful degradation; `schema_version` field for future optimization | Active | NFC-6, NFC-10 |

---

## 9. Traceability

| Intent Requirement | HLD Section | Notes |
|-------------------|-------------|-------|
| G-1: Notes → walkable palace | 3.1 (full pipeline), 4.1 (generation flow) | End-to-end from plugin to rendered world |
| G-2: Spatial topology mirrors concepts | 5 (graphology/ForceAtlas2), 6 (KD-3) | Hybrid layout algorithm (See ADR-003) |
| G-3: Themed environments | 5 (theme tech), 6 (KD-4) | Theme as data, not code; includes pedestal design (See ADR-002) |
| G-4: NPC guides with LLM | 3.2 (/npc-chat), 4.2 (NPC flow) | Streaming Haiku dialogue; voxel NPCs (OQ-6) |
| G-5: Multiple maps | 3.2 (Map Library), 4.3 (library flow) | URL-based, localStorage index |
| G-6: Procedural generation | 5 (rot-js, WFC), 6 (KD-1) | Client-side from config + seed; noa-engine (See ADR-001) |
| FR-1–FR-4: Note input & processing | 3.2 (Plugin), 4.1 (steps 1–4) | Plugin traversal at user-configurable depth (See ADR-004) |
| FR-5–FR-10: Map generation | 3.2 (/generate-palace), 4.1 (steps 5–10), 5 (layout tech), 6 (KD-3) | Hybrid layout (See ADR-003) + detailed config (See ADR-006) |
| FR-11–FR-14: 3D exploration | 3.2 (Palace Renderer), 5 (engine), 6 (KD-1, KD-7) | noa-engine (See ADR-001); smooth GLB artifacts (See ADR-002) |
| FR-15–FR-18: NPC interaction | 3.2 (/npc-chat, NPC UI), 4.2 (NPC flow) | SSE streaming; voxel characters (OQ-6) |
| FR-19–FR-22: Map management | 3.2 (Map Library), 4.3 (library flow), 6 (KD-5) | URL-based, no auth |
| FR-23–FR-25: Theme system | 5 (theme tech), 6 (KD-4) | Data-driven themes with pedestal styles |
| NFC-1: 30+ FPS | 5 (noa-engine), 8 (R-2) | noa-engine chunk-based rendering (See ADR-001) |
| NFC-2: <60s generation | 4.1 (pipeline), 6 (KD-6), 8 (R-3) | Parallel Tripo calls; no voxelization step (See ADR-005) |
| NFC-3: <10s load | 6 (KD-1) | Client-side geometry gen from pre-computed config (See ADR-006) |
| NFC-4: <2s NPC latency | 4.2 (NPC flow), 5 (Haiku streaming) | SSE streaming |
| NFC-5: Browser support | 5 (Vite), 8 (R-2) | No plugins/installs |
| NFC-6: 10–50KB config | 6 (KD-1), 8 (R-11) | Detailed schema with positions, not geometry (See ADR-006) |
| NFC-7: Free tier infra | 5 (Supabase + Vercel free tiers) | All hosting on free plans |
| NFC-8: <$5/map API cost | 5 (Haiku/Sonnet split), 6 (KD-6 caching) | Haiku is cheap; Sonnet ~$0.10/generation (See ADR-003); cache Tripo |
| NFC-9: Standard plugin API | 5 (esbuild + requestUrl) | No Electron-only APIs |
| NFC-10: ≤50 concepts | 8 (R-11) | Graceful degradation; traversal depth cap (See ADR-004) |

---

## Appendix A: Deployment Topology

```
                    ┌─────────────────┐
                    │    Vercel CDN    │
                    │  (static + edge) │
                    │                 │
                    │  Loci Web App   │
                    │  (Vite bundle)  │
                    └────────┬────────┘
                             │
                    HTTPS (REST + SSE)
                             │
                    ┌────────▼────────┐
                    │    Supabase     │
                    │   (hosted)      │
                    │                 │
                    │ • Edge Functions│
                    │ • Postgres      │
                    │ • Storage (GLBs)│
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
      ┌──────────┐   ┌──────────┐   ┌──────────┐
      │Claude API│   │ Tripo AI │   │  (future  │
      │(Anthropic│   │   API    │   │  services)│
      └──────────┘   └──────────┘   └──────────┘
```

**Obsidian Plugin** is installed locally and communicates directly with Supabase Edge Functions via `requestUrl`.

---

## Appendix B: Theme Configuration Shape (Illustrative)

```typescript
interface ThemeConfig {
  id: string;                    // e.g. "nature", "cityscape", "space_station"
  name: string;                  // Display name
  palette: {
    ground: VoxelType[];         // Block types for ground/floor
    walls: VoxelType[];          // Block types for boundaries
    paths: VoxelType[];          // Block types for connecting paths
    accent: VoxelType[];         // Decorative blocks
  };
  lighting: {
    ambient: { color: string; intensity: number };
    directional: { color: string; intensity: number; direction: [number, number, number] };
    fog: { color: string; near: number; far: number };
  };
  spaceShape: "organic" | "geometric" | "mixed";
  pathStyle: "trails" | "corridors" | "bridges" | "tunnels";
  particles: { type: string; density: number; color: string }[];
  npcStyle: string;              // Voxel character style identifier (See OQ-6)
  pedestalStyle: string;         // Artifact pedestal design identifier (See ADR-002)
}
```

This is illustrative — the precise schema is defined in the EIS (Phase 5).
