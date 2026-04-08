# Intent & Constraints: Loci — Mind Palace Generator

## 1. Problem Statement

Students accumulate knowledge in tools like Obsidian — dense, interlinked markdown notes. But reading and re-reading notes is passive. The **Method of Loci** (memory palace technique) is one of the most effective memorization strategies known, yet it requires users to mentally construct spatial environments and place concepts within them — a skill barrier that prevents most people from using it.

Meanwhile, the CSIRO hackathon challenge asks: *"How might we create an immersive and interactive AI-driven learning experience where students create and interact with their own 3D worlds, fostering creativity, artistic expression, and imagination?"*

There is a clear opportunity: **automate the construction of memory palaces from existing notes**, turning passive knowledge into walkable, explorable 3D worlds where spatial memory does the heavy lifting.

---

## 2. Vision

An Obsidian-integrated tool that transforms study notes into walkable, procedurally generated 3D mind palaces. Each set of notes becomes a unique explorable "map" (like Counter-Strike maps), where concepts are spatially encoded as 3D artifacts and NPC guides within a voxel Minecraft-aesthetic world.

The key insight: **walking the palace IS walking the knowledge graph.** Related concepts are in adjacent rooms. Important concepts get larger rooms. The spatial layout mirrors the conceptual structure — so exploring the map reinforces understanding through spatial memory.

---

## 3. Goals

| ID | Goal |
|----|------|
| G-1 | Transform a user-defined boundary of Obsidian notes into a walkable 3D mind palace |
| G-2 | Spatially encode the knowledge graph so that map topology mirrors conceptual relationships |
| G-3 | Provide themed environments (nature, lava, library, etc.) for variety and engagement |
| G-4 | Enable conversational exploration of concepts via NPC guides powered by LLM |
| G-5 | Support multiple distinct maps — one per subject, chapter, or any note boundary the user defines |
| G-6 | Use procedural generation so each run produces a unique, replayable experience |

---

## 4. Functional Requirements

### 4.1 Note Input & Processing

| ID | Requirement |
|----|-------------|
| FR-1 | User selects one or more Obsidian notes as the boundary for a map |
| FR-2 | System traverses `[[wikilinks]]` from selected notes, collecting all relevant content within the boundary |
| FR-3 | System extracts a structured concept graph from collected notes — each concept has a name, description, and importance rating; each relationship has a type and strength |
| FR-4 | Extracted concepts and relationships are sent to a backend for map generation |

### 4.2 Map Generation

| ID | Requirement |
|----|-------------|
| FR-5 | System generates a spatial layout derived from the concept graph — related concepts are placed in adjacent spaces |
| FR-6 | Concept importance determines the size of its space (more important = larger area) |
| FR-7 | Paths connect spaces along graph edges (corridors, trails, bridges, etc. — theme-dependent) |
| FR-8 | A user-selected theme is applied to the entire environment (textures, lighting, particles, space shapes, path style) |
| FR-9 | Generation uses a randomized seed — same notes can produce different maps on re-generation |
| FR-10 | Concepts are clustered into zones (groups of related spaces) that correspond to natural topic clusters |

### 4.3 3D Exploration

| ID | Requirement |
|----|-------------|
| FR-11 | User explores the map in first-person with WASD + mouse controls |
| FR-12 | World uses a voxel-based, Minecraft-like aesthetic |
| FR-13 | 3D artifact objects representing concepts are placed within spaces (on pedestals, natural formations, or similar displays — theme-dependent) |
| FR-14 | Artifacts visually relate to the concept they represent (e.g., a DNA helix for genetics) |

### 4.4 NPC Interaction

| ID | Requirement |
|----|-------------|
| FR-15 | NPC guides are placed within spaces, each bound to a specific concept and its source notes |
| FR-16 | User can approach an NPC and click to initiate a dialogue |
| FR-17 | NPC dialogue is LLM-powered, conversational, and grounded in the concept's source material |
| FR-18 | NPC responses stream in real-time (not batch) |

### 4.5 Map Management

| ID | Requirement |
|----|-------------|
| FR-19 | Generated maps are persisted and can be revisited at any time |
| FR-20 | User can browse a library of previously generated maps |
| FR-21 | Maps can be opened directly from the Obsidian plugin ("Open in Palace" action) |
| FR-22 | Each map stores its concept graph, theme, seed, and generation metadata |

### 4.6 Theme System

| ID | Requirement |
|----|-------------|
| FR-23 | User selects a theme before generation via a theme picker UI |
| FR-24 | Themes affect: block textures, lighting color/intensity, ambient particles, space shapes (organic vs geometric), path style, and NPC appearance |
| FR-25 | At minimum, 3 themes must be available for MVP (see Section 5 for full theme list) |

---

## 5. Map Themes

Each map is generated with a user-chosen theme that determines the entire environmental aesthetic:

| Theme | Description | Voxel Palette | Ambient |
|-------|-------------|---------------|---------|
| **Nature / Garden** | Minecraft-style terrain with trees, grass, rivers, stone paths | Greens, browns, sky blue | Birds, wind, water |
| **Lava Underground** | Volcanic caverns, magma rivers, obsidian walls, glowing crystals | Reds, oranges, dark stone | Rumbling, fire crackle |
| **Cityscape** | Urban rooftops, alleyways, neon signs, concrete structures | Grays, neon accents | Traffic hum, rain |
| **Ancient Library** | Grand halls, bookshelves, candlelit chambers, marble floors | Warm wood, gold, ivory | Page rustling, echo |
| **Space Station** | Metallic corridors, airlocks, starfield windows, holographic displays | Silver, blue glow, black | Hum, beeps, silence |
| **Ocean Depths** | Underwater temples, coral formations, bioluminescent paths | Deep blue, teal, purple | Bubbles, whale song |

MVP requires at least: **Nature / Garden, Cityscape, Space Station.**

---

## 6. Non-Functional Constraints

| ID | Constraint | Target |
|----|-----------|--------|
| NFC-1 | **Frame rate** | 30+ FPS on a modern laptop in Chrome/Firefox/Edge |
| NFC-2 | **Map generation time** | Under 60 seconds for ~30 concepts (notes → loadable config) |
| NFC-3 | **Map load time** | Under 10 seconds from config JSON to rendered, walkable world |
| NFC-4 | **NPC response latency** | Streaming begins within 2 seconds of user click |
| NFC-5 | **Browser support** | Modern desktop browsers — no plugins, extensions, or installs required |
| NFC-6 | **Config compactness** | Map config JSON should be 10-50KB; client generates all geometry from config |
| NFC-7 | **Infrastructure cost** | Must operate within free tiers of hosting/DB services for hackathon |
| NFC-8 | **Per-map API cost** | Under $5 per map generation (~30 concepts), with caching to reduce repeat costs |
| NFC-9 | **Plugin compatibility** | Obsidian plugin must use standard plugin API patterns — no Electron-only APIs, no hacks |
| NFC-10 | **Max concepts per map** | System should handle up to ~50 concepts gracefully; degrade gracefully beyond that |

---

## 7. Scope

### Must Have (MVP)

- Obsidian plugin: select notes → send to API → open generated map
- Theme selection (at least 3 themes: nature, cityscape, space station)
- Procedural spatial layout driven by concept graph
- Walkable voxel world with WASD + mouse controls
- AI-generated 3D artifacts per concept (text-to-3D), placed within spaces
- NPC interaction with LLM dialogue
- Map persistence and library

### Nice to Have

- All 6 themes
- Multi-level maps with staircases
- Ambient audio per theme
- Map sharing via URL
- Minimap / map overview
- Text-to-speech for NPC dialogue

### Out of Scope

- User authentication / accounts
- Payment / credits system
- Multiplayer / collaborative exploration
- Mobile support
- VR/AR mode

---

## 8. Constraints & Boundaries

| Constraint | Detail |
|-----------|--------|
| **Single-user** | No auth, no multi-tenancy — personal tool for now |
| **Deliverables** | Working prototype + pitch deck + 2-3 minute video |
| **Platform** | Web-based 3D app (desktop browsers) + Obsidian desktop plugin |
| **Budget** | Free-tier infrastructure only; API costs kept minimal per map |
| **Content domain** | Any subject — system is domain-agnostic (biology, history, CS, etc.) |

---

## 9. Known Risks

| ID | Risk | Impact | Likelihood | Mitigation |
|----|------|--------|------------|------------|
| R-2 | **Voxel engine browser compatibility** | Black screens or crashes on some GPUs/browsers | Medium | Test on multiple browsers early; have WebGL fallback messaging |
| R-3 | **Text-to-3D latency** | 30 concepts × 2s each = 60s+ sequential generation | High | Parallelize requests; cache aggressively; fall back to pre-made models for MVP |
| R-4 | **Voxelization performance** | Converting GLB meshes to voxel grids may be slow client-side | Medium | Pre-voxelize server-side; cache results; use lower resolution (16³) if needed |
| R-5 | **LLM API rate limits** | Concept extraction + NPC chat could hit rate limits during demo | Medium | Use smaller models for chat; batch concept extraction; implement retry with backoff |
| R-6 | **Voxel engine + modern bundler compatibility** | CJS/ESM conflicts with Vite | Medium | Test integration early (day 1); have esbuild fallback config ready |
| R-7 | **Scope creep** | 6 themes + artifacts + NPCs + plugin in hackathon timeframe | High | Strict MVP scope; cut themes to 3, use pre-made models, defer audio |
| R-8 | **Serverless cold starts** | Edge function cold starts adding latency to generation | Low | Keep functions warm during demo; optimize bundle size |
| R-9 | **Graph layout quality** | Force-directed layout may produce ugly or overlapping room placements | Medium | Add post-processing (overlap removal, corridor straightening); manual seed tuning |
