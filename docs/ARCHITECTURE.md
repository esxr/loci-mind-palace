# Mind Palace: Architecture & Deployment Strategy

Research completed 2026-04-08. Optimized for hackathon speed-to-demo.

---

## Recommended Stack (TL;DR)

| Layer | Technology | Why |
|-------|-----------|-----|
| **Frontend** | Vite + React + TypeScript | Fastest DX, tree-shaking, your reference projects already use React |
| **3D Engine** | react-three-fiber + drei | Declarative Three.js, instanced mesh for voxels, huge ecosystem |
| **Styling** | Tailwind CSS v4 | Fast UI for non-3D panels (sidebar, dialogs) |
| **Backend** | Supabase (DB + Auth + Edge Functions) | One platform = auth, Postgres, storage, edge functions. Zero infra setup |
| **LLM** | Claude API with structured outputs | Guaranteed JSON schema compliance for concept extraction |
| **Deployment (frontend)** | Vercel | Best Vite/React support, generous free tier, instant previews |
| **Deployment (backend)** | Supabase hosted (free tier) | Already managed, no separate deployment needed |
| **Obsidian plugin** | TypeScript + esbuild | Matches existing reference (obsidian-3d-graph), uses `requestUrl` for CORS-free HTTP |

---

## 1. Frontend Architecture

### Framework: Vite + React + TypeScript (NOT Next.js)

**Why not Next.js?** For a 3D app, SSR/SSG adds complexity with zero benefit. Three.js is client-only. Next.js ships ~85-130KB of framework runtime; a plain Vite+React app is dramatically leaner. The graphrag-workbench reference uses Next.js, but it is a dashboard app, not a 3D engine.

**Why not SvelteKit?** While SvelteKit benchmarks better (65% smaller bundles, 41% higher RPS), the React Three Fiber ecosystem (drei, rapier, postprocessing) is overwhelmingly larger. For a hackathon, ecosystem > raw perf. Your reference projects (graphrag-workbench, obsidian-react-starter) are already React.

**Vite advantages for 3D:**
- Native ESM dev server = instant HMR even with large Three.js imports
- Tree-shaking eliminates unused Three.js modules (Three.js is ~600KB but you use maybe 15% of it)
- Code-splitting via dynamic `import()` for heavy 3D chunks
- WASM support if you need it later (e.g., for physics)

### 3D Rendering: react-three-fiber + drei

**For voxel rendering specifically:**
- Use `InstancedMesh` (not individual mesh per voxel). A 32x32x32 chunk = 32,768 cubes, but with instancing = 1 draw call
- Greedy meshing reduces a 32x32x32 chunk from ~72,000 vertices to ~4,000 vertices
- Target: <100 draw calls for 60fps
- drei provides `<Instances>`, `<OrbitControls>`, `<Text>`, `<Billboard>`, `<Environment>` out of the box

**Recommended voxel approach:**
1. Server sends a JSON palace config (room dimensions, block types, artifact positions)
2. Client generates voxel geometry from config using greedy meshing
3. Each room = one merged geometry (1 draw call per room)
4. Artifacts (books, NPCs, concept nodes) = instanced meshes on top

**Key libraries:**
```
react-three-fiber ^9.x
@react-three/drei ^10.x
three ^0.179.x
@react-three/postprocessing (optional, for bloom/ambient occlusion)
```

### Bundle Size Strategy

Expected uncompressed bundle: ~2-3MB (Three.js core + your app code + textures).
After gzip: ~500KB-1MB.

Optimizations:
- **Tree-shake Three.js**: Import only what you use (`import { BoxGeometry } from 'three'` not `import * as THREE`)
- **Lazy-load the 3D view**: `React.lazy(() => import('./PalaceViewer'))` so the landing page loads instantly
- **Compress textures**: Use KTX2/Basis Universal for GPU-compressed textures (drei has `<KTX2Loader>`)
- **Generate voxel textures procedurally**: Solid colors + noise shader = zero texture downloads
- For a hackathon, procedural coloring (no texture files) is fastest and looks great with post-processing (bloom, AO)

---

## 2. Backend Architecture

### Supabase: The Hackathon Swiss Army Knife

**Why Supabase over alternatives:**
- **vs Turso**: Turso is faster at the edge but SQLite's single-writer model is limiting. Supabase gives you Postgres (relational queries for concept graphs), auth, storage, and edge functions in one place.
- **vs PlanetScale**: No free tier since April 2024. Dead for hackathons.
- **vs raw JSON files**: Works for MVP but you lose auth, querying, and multi-user support.
- **vs Firebase**: Supabase is open-source, Postgres-native, and has better DX for structured data.

**Free tier includes:** 500MB database, 1GB storage, 500K edge function invocations, 2 projects.

### Database Schema (Postgres via Supabase)

```sql
-- Users (handled by Supabase Auth)

-- Vaults: one per Obsidian vault connected
CREATE TABLE vaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Concepts: extracted from notes by LLM
CREATE TABLE concepts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id UUID REFERENCES vaults NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT, -- 'person', 'idea', 'event', 'place', 'term'
  importance FLOAT DEFAULT 0.5, -- 0-1, determines room size/prominence
  source_notes TEXT[], -- which note files this came from
  metadata JSONB DEFAULT '{}',
  embedding VECTOR(1536) -- for semantic similarity (optional, pgvector)
);

-- Relationships: links between concepts
CREATE TABLE relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id UUID REFERENCES vaults NOT NULL,
  source_id UUID REFERENCES concepts NOT NULL,
  target_id UUID REFERENCES concepts NOT NULL,
  relation_type TEXT, -- 'related_to', 'causes', 'part_of', 'contradicts'
  strength FLOAT DEFAULT 0.5,
  description TEXT
);

-- Palaces: generated 3D configurations
CREATE TABLE palaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id UUID REFERENCES vaults NOT NULL,
  name TEXT NOT NULL,
  config JSONB NOT NULL, -- full palace layout (rooms, corridors, artifacts)
  seed INTEGER, -- for reproducible procedural generation
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Edge Functions (Supabase Edge Functions / Deno)

Three endpoints:

1. **`POST /functions/v1/ingest`** — Obsidian plugin sends note data here
   - Receives: `{ vault_id, notes: [{ title, content, links, tags }] }`
   - Calls Claude API for concept extraction
   - Upserts concepts and relationships into DB
   - Returns: `{ concepts_added, relationships_added }`

2. **`POST /functions/v1/generate-palace`** — Triggers palace generation
   - Reads concepts + relationships from DB
   - Calls Claude API for spatial layout suggestions (which concepts are rooms vs. artifacts)
   - Generates palace config JSON (room grid, corridor connections, artifact placements)
   - Stores config in `palaces` table
   - Returns: palace config JSON

3. **`POST /functions/v1/npc-chat`** — In-world NPC dialogue
   - Receives: `{ palace_id, concept_id, user_message }`
   - Loads concept data + related concepts as context
   - Streams Claude response back (SSE or chunked response)
   - Returns: streamed text for the NPC speech bubble

---

## 3. LLM Integration (Claude API)

### Concept Extraction (structured output)

Use Claude's structured outputs with `output_config.format` (GA, no beta headers needed).

```typescript
// Schema for concept extraction
const conceptSchema = {
  type: "object",
  properties: {
    concepts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string", maxLength: 200 },
          category: { enum: ["person", "idea", "event", "place", "term"] },
          importance: { type: "number", minimum: 0, maximum: 1 }
        },
        required: ["name", "description", "category", "importance"]
      }
    },
    relationships: {
      type: "array",
      items: {
        type: "object",
        properties: {
          source: { type: "string" },
          target: { type: "string" },
          relation_type: { enum: ["related_to", "causes", "part_of", "contradicts", "supports"] },
          strength: { type: "number", minimum: 0, maximum: 1 },
          description: { type: "string" }
        },
        required: ["source", "target", "relation_type"]
      }
    }
  },
  required: ["concepts", "relationships"]
};
```

**Why structured outputs over prompt-and-parse:** The schema is compiled into a grammar that restricts token generation during inference. The model literally cannot produce invalid JSON. No retry logic, no validation code, no edge cases.

### Palace Layout Generation

Send extracted concepts + relationship graph to Claude, ask it to produce a spatial layout:

```
System: You are a spatial architect. Given a concept graph, produce a mind palace layout.
Rules:
- High-importance concepts become rooms
- Medium-importance concepts become artifacts (books, statues, paintings) inside related rooms
- Low-importance concepts become inscriptions/labels
- Relationships determine corridors between rooms and artifact placement
- Output a grid-based layout where each room has x,y,z coordinates

User: [concept graph JSON]
```

Output schema: rooms with positions, dimensions, block types, artifact lists, corridor connections.

### NPC Dialogue

Each "concept" in the palace can have an NPC that embodies it. When the user approaches and talks:

```
System: You are {concept.name}, a guide in a mind palace.
You represent: {concept.description}
Related concepts you know about: {related_concepts}
Source material: {source_excerpts}

Speak in character. Help the user understand this concept.
Keep responses under 3 sentences for natural conversation pacing.
```

Use streaming for natural feel. Display text word-by-word in a speech bubble above the NPC.

### Cost Estimate (Demo)

- Claude Haiku for concept extraction: ~$0.001 per note (fast, cheap)
- Claude Sonnet for palace layout generation: ~$0.01 per palace
- Claude Haiku for NPC dialogue: ~$0.001 per exchange
- **Demo budget: $1-5 covers hundreds of interactions easily**

---

## 4. Data Flow Architecture

```
┌─────────────────┐     POST /ingest      ┌──────────────────────┐
│  Obsidian Plugin │ ──────────────────────▶│  Supabase Edge Fn    │
│  (requestUrl)    │     {notes, vault_id}  │  /ingest             │
└─────────────────┘                         │                      │
                                            │  ┌────────────────┐  │
                                            │  │ Claude API     │  │
                                            │  │ (structured    │  │
                                            │  │  output)       │  │
                                            │  └────────────────┘  │
                                            │         │            │
                                            │         ▼            │
                                            │  ┌────────────────┐  │
                                            │  │ Supabase DB    │  │
                                            │  │ (concepts,     │  │
                                            │  │  relationships)│  │
                                            │  └────────────────┘  │
                                            └──────────────────────┘
                                                      │
                                    POST /generate-palace
                                                      │
                                                      ▼
                                            ┌──────────────────────┐
                                            │  Palace Config JSON  │
                                            │  (rooms, artifacts,  │
                                            │   corridors, NPCs)   │
                                            └──────────────────────┘
                                                      │
                                              GET palace config
                                                      │
                                                      ▼
┌──────────────────────────────────────────────────────────────────┐
│  3D Frontend (Vite + React + R3F)                                │
│                                                                  │
│  ┌─────────┐  ┌─────────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Palace   │  │ Voxel Room  │  │ Artifact │  │ NPC Dialog   │  │
│  │ Loader   │──│ Renderer    │──│ Renderer │──│ (streaming)  │  │
│  │          │  │ (greedy     │  │ (instanced│  │              │  │
│  │          │  │  mesh)      │  │  mesh)   │  │              │  │
│  └─────────┘  └─────────────┘  └──────────┘  └──────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### Where Procedural Generation Happens

**Client-side.** The server stores a compact palace config (~10-50KB JSON). The client does all geometry generation:

1. Parse room grid → generate voxel block arrays
2. Apply greedy meshing → merged geometries
3. Place instanced artifacts
4. Set up lighting, fog, post-processing

This means:
- Server storage is tiny (JSON, not meshes)
- Same config always produces same palace (deterministic from seed)
- Client can adjust LOD, render distance based on device capability
- Regeneration is instant (no server round-trip for visual changes)

### Multiple Palaces Per User

Each vault can have multiple palaces (different "views" of the same knowledge). The `palaces` table supports this. The frontend has a palace selector. For MVP, one palace per vault is fine.

---

## 5. Deployment Strategy

### Frontend: Vercel (Free Hobby Plan)

**Why Vercel over alternatives:**
- **vs Cloudflare Pages**: CF has a 25MB per-file limit for assets and 25MB function bundle limit. Vercel's limits are more generous (100MB static uploads on free tier, 250MB functions). For a 3D app, Vercel is safer.
- **vs Netlify**: Similar capabilities but Vercel has better Vite integration and faster builds.
- Vercel free tier: 100GB bandwidth/month, unlimited static requests, instant deploys from Git.

**Setup (< 5 minutes):**
1. `npm create vite@latest mind-palace -- --template react-ts`
2. Push to GitHub
3. Import repo on Vercel → auto-deploys on every push

**Asset strategy:**
- Procedural textures (no asset files needed for MVP)
- If you add texture files later: Vercel's CDN serves static assets from `/public` with automatic edge caching
- For models >100MB: use Supabase Storage or Cloudflare R2 with public bucket

### Backend: Supabase Hosted (Free Tier)

**Setup (< 10 minutes):**
1. Create project on supabase.com
2. Run schema SQL in SQL editor
3. Deploy edge functions via `supabase functions deploy`
4. Set `ANTHROPIC_API_KEY` as edge function secret

### Obsidian Plugin: Manual Install for Demo

For a hackathon demo, no need to publish to Obsidian's community plugin registry. Build the plugin, copy `main.js` + `manifest.json` + `styles.css` into the demo vault's `.obsidian/plugins/mind-palace/` folder.

---

## 6. Hackathon Speed Path

### Day 1: Foundation (4-6 hours)

1. **Scaffold frontend** (30 min)
   - `npm create vite@latest` + install r3f, drei, tailwind
   - Basic scene with camera controls, a floor plane, lighting
   - Deploy to Vercel

2. **Set up Supabase** (30 min)
   - Create project, run schema SQL
   - Test connection from frontend

3. **Build concept extraction edge function** (2 hours)
   - Claude API integration with structured output
   - Hardcode some sample notes for testing
   - Verify concepts land in DB

4. **Build palace generation** (2 hours)
   - Claude generates room layout from concept graph
   - Store palace config JSON
   - Frontend fetches and renders basic colored boxes for rooms

### Day 2: The Wow Factor (4-6 hours)

5. **Voxel rendering** (2 hours)
   - Replace boxes with voxel rooms (instanced mesh, greedy meshing)
   - Add textures/materials per block type (stone walls, wood floors, etc.)
   - First-person camera controls (PointerLockControls from drei)

6. **Obsidian plugin** (2 hours)
   - Fork obsidian-react-starter or start from esbuild template
   - Add a ribbon icon that sends current vault notes to `/ingest`
   - Display status toast on completion

7. **NPC dialogue** (1 hour)
   - Click on artifact → opens chat panel
   - Streams Claude response as concept NPC

8. **Polish** (1 hour)
   - Post-processing (bloom, ambient occlusion)
   - Loading states, error handling
   - Landing page / palace selector

### What Makes the Demo Impressive

- **Live demo flow**: Open Obsidian vault with notes → click "Generate Palace" → watch 3D world appear → walk through it → talk to concept NPCs
- **The spatial metaphor**: Seeing abstract notes become a physical space you can walk through is inherently impressive
- **AI interaction**: NPCs that actually know the content and can discuss it

---

## 7. Project Structure

```
mind-palace/
├── apps/
│   ├── web/                    # Vite + React + R3F frontend
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── palace/     # 3D palace rendering
│   │   │   │   │   ├── PalaceViewer.tsx
│   │   │   │   │   ├── VoxelRoom.tsx
│   │   │   │   │   ├── Artifact.tsx
│   │   │   │   │   ├── NPC.tsx
│   │   │   │   │   └── GreedyMesher.ts
│   │   │   │   ├── ui/         # 2D UI (panels, dialogs)
│   │   │   │   └── layout/
│   │   │   ├── hooks/
│   │   │   ├── lib/
│   │   │   │   ├── supabase.ts
│   │   │   │   └── palace-generator.ts  # Client-side voxel gen
│   │   │   ├── types/
│   │   │   │   └── palace.ts   # Palace config type definitions
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── public/
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── obsidian-plugin/        # Obsidian plugin
│       ├── src/
│       │   ├── main.ts         # Plugin entry point
│       │   ├── settings.ts     # Settings tab (API URL, vault ID)
│       │   └── ingest.ts       # Note extraction + API call
│       ├── manifest.json
│       ├── esbuild.config.mjs
│       ├── package.json
│       └── tsconfig.json
│
├── supabase/
│   ├── functions/
│   │   ├── ingest/index.ts
│   │   ├── generate-palace/index.ts
│   │   └── npc-chat/index.ts
│   ├── migrations/
│   │   └── 001_initial_schema.sql
│   └── config.toml
│
├── package.json                # Workspace root (if using monorepo)
└── README.md
```

---

## 8. Key Technical Decisions & Rationale

### Why NOT use the recommended Manifest Engine?

The REQUIREMENTS.md says "You are highly recommended to use Manifest Engine." Research found no established 3D web engine by this name. It may be a proprietary tool provided at the hackathon. **Recommendation:** Check at the event. If Manifest Engine exists and is accessible, evaluate it. Otherwise, react-three-fiber is the safe bet with massive community support and documentation.

### Why client-side voxel generation?

- Palace configs are 10-50KB JSON. Voxel meshes would be 1-10MB. Generating client-side saves bandwidth and storage.
- Deterministic: same config + seed = same visual output.
- Allows real-time LOD adjustment (render fewer voxels on slow devices).
- Faster iteration during development (change rendering without re-generating on server).

### Why Supabase Edge Functions instead of a separate backend?

- Zero additional infrastructure. Deploy with `supabase functions deploy`.
- Built-in auth integration (RLS policies protect data per user).
- Deno runtime supports `fetch` for Claude API calls natively.
- Free tier is more than enough for a hackathon demo.

### Why Claude over OpenAI for concept extraction?

- Structured outputs are GA on Claude (no beta).
- Claude's longer context window (200K) handles large vaults better.
- Cost-effective: Haiku for extraction, Sonnet for layout generation.
- Consistent JSON schema compliance via grammar-constrained generation.

---

## 9. Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| 3D performance on demo laptop | Test on target hardware early. Use LOD. Have a "lite mode" fallback. |
| Claude API latency for palace generation | Pre-generate a demo palace. Show cached result if live gen is slow. |
| Supabase Edge Function cold starts | Warm functions before demo with a test request. |
| Obsidian plugin complexity | MVP: just send currently open note, not entire vault. |
| Bundle too large for Vercel | Tree-shake Three.js. Procedural textures. Code-split 3D viewer. |
| Voxel rendering too slow | Greedy meshing. Reduce chunk size. Bake static rooms. |

---

## 10. Environment Variables

```env
# Frontend (.env)
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxx

# Supabase Edge Functions (secrets)
ANTHROPIC_API_KEY=sk-ant-xxx

# Obsidian Plugin (settings UI)
MIND_PALACE_API_URL=https://xxx.supabase.co/functions/v1
MIND_PALACE_VAULT_ID=xxx
```
