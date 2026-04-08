# ADR-Lite: Loci — Mind Palace Generator

**Version:** 1.0
**Date:** 2026-04-08
**Status:** Accepted
**Phase:** 3 (Architecture Decision Records)
**Based on:** Intent & Constraints v1.0, High-Level Design v1.0

---

## Decision Summary

All 9 open questions from the HLD have been resolved. Two were resolved during Phase 2 (marked below). The remaining 7 are formally decided in this document.

| ADR | Title | OQ | Decision | Status |
|-----|-------|----|----------|--------|
| ADR-001 | 3D Engine Choice | OQ-1 | **noa-engine** (Babylon.js voxel engine) | Accepted |
| ADR-002 | Artifact Rendering Style | OQ-2 | **Smooth GLB with voxel pedestal** | Accepted |
| ADR-003 | Layout Algorithm Balance | OQ-3 | **Hybrid** (LLM metadata + algorithmic placement) | Accepted |
| ADR-004 | Wikilink Traversal Depth | OQ-4 | **User-configurable, default 2 hops** | Accepted |
| ADR-005 | Voxelization Location | OQ-5 | **No voxelization needed** (follows from ADR-002) | Accepted |
| ADR-006 | Palace Config Schema | OQ-7 | **Detailed with pre-computed positions** | Accepted |
| ADR-007 | Target User Age | OQ-9 | **Primary: university/high school; accessible to younger** | Accepted |
| *(pre-resolved)* | NPC Representation | OQ-6 | **Voxel characters** (block-built figures) | Resolved in HLD |
| *(pre-resolved)* | 3D Engine Ecosystem | OQ-8 | **Dismiss Manifest Engine**, use mainstream WebGL framework | Resolved in HLD |

---

## Pre-Resolved Decisions (from HLD Phase 2)

### OQ-6: NPC Representation (Resolved in HLD)

**Decision:** NPCs are **voxel characters** — block-built figures styled like Minecraft mobs. Each theme defines its own NPC voxel style (e.g., a stone golem for Lava Underground, a holographic figure for Space Station). Simple limb animations (idle sway, talk gesture) provide visual feedback during interaction.

**Rationale:** Aesthetically consistent with the voxel world (FR-12). Avoids the complexity and uncanny valley of smooth humanoid models in a blocky environment. Supports per-theme customization via KD-4 (theme as data).

### OQ-8: Dismiss Manifest Engine (Resolved in HLD)

**Decision:** The CSIRO REQUIREMENTS.md recommends "Manifest Engine," but no established web 3D engine by this name exists with community support, documentation, or proven track record. **Manifest Engine is dismissed.** Loci will use a mainstream WebGL framework — the specific choice (noa-engine on Babylon.js) is covered by ADR-001.

**Rationale:** Hackathon success depends on reliable, well-documented tools with community support. Building on an unknown engine introduces unacceptable risk for a 48-hour timeline.

---

## ADR Entries

### ADR-001: 3D Engine Choice

**Status:** Accepted
**Resolves:** OQ-1 from HLD
**References:** FR-11 (FPS controls), FR-12 (voxel aesthetic), NFC-1 (30+ FPS), NFC-3 (load time <10s), NFC-5 (browser support), R-2 (browser compatibility), R-6 (bundler compatibility)

**Decision:** Use **noa-engine**, a Babylon.js-based voxel engine purpose-built for Minecraft-like browser worlds.

**Alternatives Considered:**

1. **noa-engine (Babylon.js)** — Purpose-built for voxel worlds. Includes chunk meshing, greedy meshing optimization, physics, first-person camera controls, and entity management out of the box. Uses ESM, compatible with Vite. Smaller community than Three.js but laser-focused on the exact use case.
2. **react-three-fiber (Three.js + React)** — Larger ecosystem, declarative React API, excellent documentation. However, provides zero voxel infrastructure: chunk meshing, greedy meshing, voxel physics, and block-based world management would all need to be built from scratch. This is weeks of work, not days.
3. **Raw Babylon.js (no noa)** — Full engine access without the voxel abstraction. More flexible but requires building the same voxel infrastructure that noa provides. No benefit over noa for our use case.

**Rationale:** noa-engine directly satisfies FR-12 (voxel Minecraft aesthetic) with zero custom infrastructure. It provides FR-11 (first-person WASD + mouse controls) out of the box. Chunk-based rendering supports NFC-1 (30+ FPS) through built-in LOD and frustum culling. The hackathon timeline makes "batteries included" critical — building voxel meshing from scratch in R3F would consume the entire timeline with infrastructure rather than features. noa-engine uses ESM modules, mitigating R-6 (bundler compatibility with Vite).

**Consequences:**
- The 3D layer is vanilla TypeScript/JavaScript, not React — the Obsidian plugin (which has its own UI framework) and the 3D renderer are fully separate concerns anyway, so this is not a cost.
- Babylon.js is the underlying renderer, which is well-documented and actively maintained.
- noa-engine has a smaller community than Three.js; if we hit edge cases, we may need to read source code rather than Stack Overflow answers.
- Smooth GLB artifact loading (ADR-002) is straightforward since Babylon.js natively supports GLTF/GLB import alongside voxel geometry.

---

### ADR-002: Artifact Rendering Style

**Status:** Accepted
**Resolves:** OQ-2 from HLD
**References:** FR-13 (3D artifacts in spaces), FR-14 (artifacts visually relate to concepts), FR-12 (voxel aesthetic), R-4 (voxelization performance), NFC-2 (generation time <60s), NFC-3 (load time <10s)

**Decision:** Render Tripo AI GLB models as **smooth 3D objects placed on voxel pedestals**. No voxelization step.

**Alternatives Considered:**

1. **Smooth GLB with voxel pedestal** — Load Tripo AI output directly as smooth meshes. Place them on theme-appropriate voxel pedestals (stone altar, metal platform, coral formation, etc.) to ground them in the voxel world. Visual contrast is a feature: artifacts stand out as "special objects."
2. **Full voxelization** — Convert each GLB model to a voxel grid (e.g., 16x16x16 or 32x32x32) to match the Minecraft aesthetic perfectly. Requires a voxelization algorithm (ray-casting or mesh sampling), adds latency (R-4), loses fine detail from Tripo AI output, and adds an entire processing stage to the pipeline.
3. **Hybrid (smooth + optional voxel toggle)** — Support both rendering modes with a user toggle. Doubles the rendering complexity and testing surface for negligible user benefit during a hackathon demo.

**Rationale:** Voxelization adds pipeline complexity (R-4), latency to generation time (threatening NFC-2), and destroys the detail that makes Tripo AI models visually interesting. The visual contrast between smooth GLB artifacts and the voxel world is actually beneficial — it makes artifacts immediately recognizable as "the important things" in each space, which directly aids the Method of Loci memorization technique. Tripo AI already produces low-poly, stylized models that fit aesthetically alongside voxel geometry without jarring visual conflict. The voxel pedestal bridges the style gap.

**Consequences:**
- The world uses mixed rendering: voxel geometry (via noa-engine) plus smooth GLTF meshes (via Babylon.js loader). This is natively supported by Babylon.js.
- Slight visual inconsistency between world and artifacts, but this is reframed as intentional design — artifacts are meant to stand out.
- Eliminates R-4 (voxelization performance) as a risk entirely.
- Simplifies the generation pipeline: Tripo AI output goes directly to Supabase Storage with no intermediate processing.
- Pedestal design becomes part of the theme configuration (KD-4).

---

### ADR-003: Layout Algorithm Balance

**Status:** Accepted
**Resolves:** OQ-3 from HLD
**References:** FR-5 (spatial layout from concept graph), FR-6 (importance determines size), FR-10 (concept clustering), G-2 (topology mirrors concepts), R-9 (graph layout quality), NFC-8 (API cost <$5/map)

**Decision:** Use a **hybrid two-stage approach**. Stage 1: Claude Sonnet provides semantic metadata (importance scores, cluster labels, relationship types, spatial hints). Stage 2: ForceAtlas2 + Louvain + rot-js handle all geometric placement, path routing, and overlap removal.

**Alternatives Considered:**

1. **Pure algorithmic (ForceAtlas2 only)** — Graph structure alone drives layout. Fast, deterministic, zero LLM cost. But graph topology doesn't capture semantic nuance: two notes may be linked but conceptually distant (e.g., a "References" note linked to everything), or unlinked but thematically close. Produces technically correct but semantically shallow layouts.
2. **Hybrid (LLM metadata + algorithmic placement)** — LLM understands meaning and context; algorithms handle geometry. LLM assigns importance scores (0-10), cluster affinity labels, relationship type annotations (e.g., "prerequisite," "example," "contrast"), and optional spatial hints ("this should be central"). Algorithms consume this enriched graph and compute deterministic positions. Best of both worlds.
3. **Pure LLM (LLM places everything)** — LLM generates full coordinate layouts. Unreliable for precise geometry (R-9): LLMs produce overlapping positions, inconsistent scales, and non-deterministic results across calls. Would require extensive post-processing that negates the point of using the LLM for placement.

**Rationale:** The hybrid approach uses each tool where it excels. LLMs are excellent at understanding semantic relationships between concepts ("mitochondria is more important than cell membrane for a biology exam") but unreliable for coordinate math. Graph algorithms are deterministic, fast, and proven for spatial layout but cannot infer meaning from text. The two-stage pipeline: (1) one Sonnet call enriches the concept graph with semantic metadata (~$0.10 per generation, well within NFC-8), then (2) ForceAtlas2 positions nodes, Louvain detects clusters for zone grouping, and rot-js generates room geometry and path routing. This directly addresses R-9 by combining semantic intelligence with geometric reliability.

**Consequences:**
- Two-stage pipeline adds architectural complexity, but each stage has a well-defined input/output contract (enriched graph JSON between stages).
- LLM cost is one Sonnet call per palace generation (~$0.10), acceptable within the $5/map budget (NFC-8).
- Layout quality depends on LLM metadata quality — if Sonnet assigns poor importance scores, the layout suffers. Mitigation: the algorithmic stage produces reasonable layouts even with flat/default metadata, so the LLM stage is an enhancement, not a dependency.
- The algorithmic stage is deterministic given the same enriched graph + seed (FR-9).

---

### ADR-004: Wikilink Traversal Depth

**Status:** Accepted
**Resolves:** OQ-4 from HLD
**References:** FR-1 (user selects notes), FR-2 (wikilink traversal), NFC-10 (max ~50 concepts), R-7 (scope creep)

**Decision:** **User-configurable traversal depth with a default of 2 hops.** The plugin UI exposes a depth control (dropdown or numeric input) with options 1, 2, or 3. Default is 2.

**Alternatives Considered:**

1. **Fixed depth (always 2 hops)** — Simple to implement, no UI needed. But inflexible: a user with a deeply nested vault structure may need 3 hops, while a user with a flat structure may only want 1. One size does not fit all knowledge graph topologies.
2. **User-configurable with default of 2** — Depth control in the plugin UI. Default of 2 captures the selected notes plus their direct links plus one more layer of context — enough to build a rich concept map without explosion. User adjusts for their vault structure.
3. **Unlimited within boundary** — Follow all wikilinks until no new notes are found. Dangerous: a well-linked vault could pull in hundreds of notes, blowing past NFC-10 (50 concepts) and producing unusable palaces. Would require a separate concept-count cap, adding complexity.

**Rationale:** Depth-2 is the sweet spot for most Obsidian vaults: it captures the user's selected focus (depth 0), their immediate context (depth 1), and the broader neighborhood (depth 2). This typically yields 15-40 notes for a well-linked vault, aligning with NFC-10's ~50 concept cap. Making it configurable costs minimal UI effort (a single dropdown) and respects the diversity of vault structures. The depth limit also serves as the primary safety valve against concept explosion — combined with NFC-10's hard cap of 50 concepts, the system degrades gracefully.

**Consequences:**
- Plugin UI needs a depth selector in the generation dialog — minor UI addition.
- Backend `/ingest` endpoint must respect the depth limit during graph traversal.
- Default of 2 may still produce >50 notes in heavily linked vaults; the backend should enforce NFC-10 by truncating (least-important concepts first, using the LLM importance scores from ADR-003's Stage 1).
- Depth-1 option gives users a "quick map" mode for fast, focused palaces.

---

### ADR-005: Voxelization Location

**Status:** Accepted
**Resolves:** OQ-5 from HLD
**References:** R-4 (voxelization performance), NFC-3 (load time <10s), NFC-6 (config compactness 10-50KB), FR-12 (voxel aesthetic), FR-13 (3D artifacts)

**Decision:** **No voxelization is performed anywhere.** This follows directly from ADR-002: artifacts are rendered as smooth GLB meshes on voxel pedestals. The voxel world itself (rooms, paths, terrain) is generated client-side from the palace config JSON using noa-engine's native block-placement API. Tripo AI GLB models are loaded directly as smooth meshes via Babylon.js GLTF loader.

**Alternatives Considered:**

1. **Server-side voxelization** — Pre-convert GLB models to voxel grids during palace generation. Store voxel data in the palace config or as separate assets. Adds server compute cost, increases config size (violating NFC-6), and adds generation latency (threatening NFC-2).
2. **Client-side voxelization** — Convert GLB to voxels at load time in the browser. Adds load-time latency (threatening NFC-3), requires a client-side voxelization library, and risks poor performance on lower-end machines (R-4).
3. **No voxelization (smooth GLB as-is)** — Per ADR-002, artifacts remain smooth meshes. The only voxel generation is the world geometry itself, which is built client-side from the spatial layout data in the palace config using noa-engine's block API. No GLB-to-voxel conversion anywhere in the pipeline.

**Rationale:** ADR-002 decided that smooth GLB artifacts are the preferred rendering style. This decision makes OQ-5 moot — there is nothing to voxelize. The voxel world (rooms, corridors, terrain, pedestals) is generated entirely client-side from compact spatial layout data in the palace config JSON. This keeps config size within NFC-6 (10-50KB: positions and block types, not geometry). It eliminates R-4 as a risk. The pipeline is simpler: Tripo AI produces GLB, GLB goes to storage, client loads GLB directly.

**Consequences:**
- R-4 (voxelization performance) is fully eliminated as a risk.
- NFC-6 (compact config) is maintained: palace config contains spatial coordinates and block type references, not mesh data. GLB URLs point to Supabase Storage.
- The generation pipeline has fewer stages, reducing NFC-2 (generation time) pressure.
- If a future version wants voxelized artifacts (e.g., for a "retro mode"), it would need to be added as a new feature — but this is explicitly post-MVP.

---

### ADR-006: Palace Config Schema

**Status:** Accepted
**Resolves:** OQ-7 from HLD
**References:** NFC-6 (config 10-50KB), NFC-3 (load time <10s), FR-5 (spatial layout), FR-7 (paths), FR-8 (theme), FR-9 (seed), FR-13 (artifacts), FR-15 (NPCs), FR-22 (metadata), KD-1 (client-side geometry generation)

**Decision:** Use a **detailed schema with pre-computed positions**. The server computes the full spatial layout and sends a complete palace config containing: space positions/dimensions/block types, path waypoints, artifact placements with GLB URLs, NPC positions with concept bindings, theme configuration, generation seed, and metadata. The client is a pure renderer — it reads this config and generates geometry deterministically.

**Alternatives Considered:**

1. **Minimal (graph + theme only)** — Config contains only the concept graph and theme ID. Client runs the full layout algorithm (ForceAtlas2, Louvain, rot-js) to compute positions at load time. Smallest config size (~5KB) but pushes heavy computation to the client, increasing load time (threatening NFC-3) and requiring the client to bundle graph analysis libraries.
2. **Detailed with pre-computed positions** — Server computes everything: spatial positions, room sizes, path waypoints, artifact/NPC placements. Config is 10-50KB. Client only generates voxel geometry from this blueprint. Fast load (NFC-3), thin client, deterministic rendering.
3. **Hybrid (positions computed, decoration deferred)** — Server computes room positions and paths; client handles interior decoration (furniture, details) via Wave Function Collapse at load time. Medium config size, medium client complexity. Adds load-time variability.

**Rationale:** The detailed schema aligns with KD-1 (client-side geometry generation from config) while keeping the client as thin as possible. Pre-computing all positions server-side means the client's only job is translating spatial data into voxel blocks — a fast, deterministic operation that achieves NFC-3 (<10s load). The config size stays within NFC-6: positions and metadata for ~30-50 concepts, paths, and theme data compress well into 10-50KB of JSON. Moving layout computation to the server also means the client doesn't need to bundle graphology, ForceAtlas2, or rot-js, reducing the web app bundle size (benefiting NFC-1 and NFC-3). Same config + same seed = same world, satisfying FR-9.

**Consequences:**
- Config JSON is ~10-50KB (NFC-6 satisfied). For 50 concepts with full metadata, estimated ~40KB.
- Server bears all layout computation cost during `/generate-palace`. This is acceptable since generation is a one-time operation per palace, and Supabase Edge Functions have sufficient compute for graph layout of ~50 nodes.
- Client is a pure renderer — fast load times (NFC-3), simple architecture, easy to debug.
- The precise schema will be defined in the EIS (Phase 5), but the architectural commitment is: server computes, client renders.
- Config versioning should be considered: a `schema_version` field in the config allows future format changes without breaking existing palaces.

---

### ADR-007: Target User Age

**Status:** Accepted
**Resolves:** OQ-9 from HLD
**References:** G-1 (notes to palace), FR-1 (Obsidian note selection), CSIRO challenge statement (young children below grade 6), NFC-9 (Obsidian plugin API)

**Decision:** **Primary target: university and high school students** who use Obsidian for study notes. Design the UI to be accessible and intuitive for younger users. For the hackathon pitch, frame as "students of all ages" with the demo showing university-level content, while acknowledging CSIRO's young learner focus.

**Alternatives Considered:**

1. **University students only** — Matches the Obsidian-using demographic perfectly. Method of Loci is most valuable for complex material (anatomy, law, history). But ignores the CSIRO challenge brief, which explicitly mentions "young children below grade 6." Could hurt judging scores.
2. **Primary school / below grade 6 only** — Matches the CSIRO challenge brief. But the core product requires existing Obsidian notes with `[[wikilinks]]` — the intersection of "Obsidian power users" and "children under 12" is vanishingly small. Would require pivoting to a non-Obsidian input method, fundamentally changing the product.
3. **Primary target university/high school, accessible to younger users** — Build for the users who will actually use the tool (Obsidian students). Design with clean, intuitive UI that doesn't exclude younger users. The 3D voxel world is inherently appealing to younger audiences. NPC dialogue complexity naturally adapts to content level (simple notes produce simple palaces). Pitch acknowledges CSIRO's focus while demonstrating the tool works across age groups.

**Rationale:** The product's value proposition is tightly coupled to Obsidian and complex interlinked notes — this is fundamentally a tool for students who already take structured notes. Redesigning for sub-grade-6 children would require abandoning the Obsidian integration (FR-1, NFC-9), the wikilink-based knowledge graph (FR-2, FR-3), and the Method of Loci framing — essentially building a different product. However, the CSIRO challenge emphasis on young learners cannot be ignored for judging. The resolution: build the tool for its natural user base, but ensure the UI is clean and approachable (benefits all ages), and frame the pitch to show how the concept scales down to younger learners (simpler notes, simpler palaces, same spatial learning benefit).

**Consequences:**
- UI design should prioritize clarity and simplicity — no dense settings panels, no jargon-heavy labels. This benefits all users and satisfies the CSIRO "low barrier to entry" criterion.
- NPC dialogue naturally adapts to content complexity: notes about "cell biology" produce university-level dialogue, notes about "my favorite animals" produce child-appropriate dialogue. No special age-gating logic needed.
- Hackathon pitch must thread the needle: show the university demo, but articulate how the same system serves younger learners. Consider preparing a secondary demo with simpler content.
- The Obsidian plugin dependency means the tool is not standalone for young children. A future non-Obsidian input mode (paste text, upload file) could broaden the age range but is post-MVP scope.

---

## Cross-Cutting Observations

### Risk Retirement

ADR-002 and ADR-005 together **eliminate R-4 (voxelization performance)** from the risk register entirely. No voxelization occurs anywhere in the pipeline.

### Dependencies Between Decisions

- **ADR-002 determines ADR-005:** The smooth-GLB decision makes voxelization location moot.
- **ADR-003 feeds ADR-006:** The hybrid layout algorithm produces the pre-computed positions that the detailed palace config schema requires.
- **ADR-004 feeds ADR-003:** Traversal depth limits the input graph size, which bounds the layout algorithm's workload and the LLM call's input token count.
- **ADR-001 enables ADR-002:** noa-engine runs on Babylon.js, which natively supports GLTF/GLB loading alongside voxel geometry, making mixed rendering (smooth + voxel) straightforward.

### Remaining Work

These ADRs are architectural commitments. The precise specifications (API contracts, config JSON schema, theme data structures, component interfaces) are defined in the **EIS (Phase 5)**. No ADR entries remain open — all 9 OQs from the HLD are resolved.
