# EIS: Spatial Grammar -- Palace Layout & Visual Identity Overhaul

**Status**: Draft
**Date**: 2026-04-08
**Scope**: Replace ForceAtlas2 organic scatter with a structured grid-district layout; add category-based artifact shapes, landmark beacons, road hierarchy visuals, golden-path breadcrumbs, and a spawn vista platform.

---

## Table of Contents

1. [Module 1: Grid-Based District Layout](#module-1-grid-based-district-layout)
2. [Module 2: Shape Language for Artifacts](#module-2-shape-language-for-artifacts)
3. [Module 3: Landmark Beacons](#module-3-landmark-beacons)
4. [Module 4: Road Hierarchy Visuals](#module-4-road-hierarchy-visuals)
5. [Module 5: Golden Path Breadcrumbs](#module-5-golden-path-breadcrumbs)
6. [Module 6: Spawn Vista](#module-6-spawn-vista)
7. [Implementation Phases](#implementation-phases)
8. [Seed Data Reference](#seed-data-reference)

---

## Module 1: Grid-Based District Layout

### Goal

Replace ForceAtlas2's organic force-directed scatter with a deterministic grid-based district system. Concepts grouped by Louvain `cluster_label` occupy rectangular city blocks arranged on a master grid. A central plaza serves as the wayfinding anchor.

### Files Changed

| File | Action |
|------|--------|
| `src/functions/generate-palace/layout.ts` | **Heavy edit** -- replace ForceAtlas2 position computation with grid placement. Keep Louvain clustering, A*, and all downstream logic. Remove `graphology-layout-forceatlas2` import. |
| `public/seed-palace.json` | **Regenerate** -- all `spaces[].position`, `paths[].waypoints`, and `spawn_point` recomputed. |

### Algorithm: District Grid Assignment

```
Input:  concepts[] with cluster_label, Louvain communities{} mapping concept_id -> zone_id
Output: SpacePosition[] with deterministic (cx, cz) in world coordinates

Constants:
  GRID_CELL_SIZE   = 80   // each district block is 80x80 world units
  PLAZA_MIN        = 30   // central plaza from (30,0,30) to (70,0,70)
  PLAZA_MAX        = 70
  ROOM_SPACING     = 5    // gap between rooms within a district
```

**Step 1 -- Group concepts into districts:**

```typescript
// After Louvain produces communities: Record<string, number>
const districts = new Map<number, Concept[]>();
for (const concept of graph.concepts) {
  const zoneId = communities[concept.id] ?? 0;
  if (!districts.has(zoneId)) districts.set(zoneId, []);
  districts.get(zoneId)!.push(concept);
}
```

**Step 2 -- Assign grid cells to districts:**

Districts are laid out on a 2D grid. Grid dimensions adapt to district count:

| Districts | Grid |
|-----------|------|
| 1         | 1x1  |
| 2         | 2x1  |
| 3-4       | 2x2  |
| 5-6       | 3x2  |
| 7-9       | 3x3  |

```typescript
const districtCount = districts.size;
const gridCols = Math.ceil(Math.sqrt(districtCount));
const gridRows = Math.ceil(districtCount / gridCols);

const sortedZoneIds = [...districts.keys()].sort();
const districtOrigins = new Map<number, { ox: number; oz: number }>();

for (let i = 0; i < sortedZoneIds.length; i++) {
  const col = i % gridCols;
  const row = Math.floor(i / gridCols);
  districtOrigins.set(sortedZoneIds[i], {
    ox: col * GRID_CELL_SIZE,   // world X origin of district
    oz: row * GRID_CELL_SIZE,   // world Z origin of district
  });
}
```

**Step 3 -- Place rooms within each district:**

Within each 80x80 district block, the highest-importance concept is the **hub** and is placed at the district center. Remaining concepts arrange around it in a courtyard pattern.

```typescript
function placeDistrictRooms(
  concepts: Concept[],
  origin: { ox: number; oz: number },
): SpacePosition[] {
  // Sort by importance descending; first = hub
  const sorted = [...concepts].sort((a, b) => b.importance - a.importance);
  const hub = sorted[0];
  const rest = sorted.slice(1);

  const positions: SpacePosition[] = [];

  // Hub at district center
  const hubSize = sizeForDisplay(hub.display_size);
  const hubCx = origin.ox + GRID_CELL_SIZE / 2;  // e.g. ox + 40
  const hubCz = origin.oz + GRID_CELL_SIZE / 2;
  positions.push({
    conceptId: hub.id,
    cx: hubCx,
    cz: hubCz,
    halfW: hubSize.width / 2,
    halfD: hubSize.depth / 2,
    zoneId: communities[hub.id] ?? 0,
    concept: hub,
  });

  // Arrange remaining concepts in courtyard slots around the hub.
  // Slots are at fixed offsets from the hub center:
  const SLOT_OFFSETS = [
    { dx: -20, dz: -15 },  // top-left
    { dx: -20, dz: +15 },  // bottom-left
    { dx: +20, dz: -10 },  // top-right
    { dx: +20, dz: +15 },  // bottom-right
    { dx: 0,   dz: -25 },  // far top
    { dx: 0,   dz: +25 },  // far bottom
    { dx: -25, dz: 0   },  // far left
    { dx: +25, dz: 0   },  // far right
  ];

  for (let i = 0; i < rest.length; i++) {
    const concept = rest[i];
    const slot = SLOT_OFFSETS[i % SLOT_OFFSETS.length];
    const roomSize = sizeForDisplay(concept.display_size);
    positions.push({
      conceptId: concept.id,
      cx: hubCx + slot.dx,
      cz: hubCz + slot.dz,
      halfW: roomSize.width / 2,
      halfD: roomSize.depth / 2,
      zoneId: communities[concept.id] ?? 0,
      concept,
    });
  }

  return positions;
}
```

**Step 4 -- Central plaza reservation:**

The central plaza occupies world coordinates `(30, 0, 30)` to `(70, 0, 70)`. No rooms may be placed here. After all districts are placed, run a collision check and push any rooms out of the plaza bounds:

```typescript
function enforcePlaza(positions: SpacePosition[]): void {
  for (const sp of positions) {
    const left   = sp.cx - sp.halfW;
    const right  = sp.cx + sp.halfW;
    const top    = sp.cz - sp.halfD;
    const bottom = sp.cz + sp.halfD;

    // If room overlaps the plaza rectangle [30..70, 30..70]
    if (right > PLAZA_MIN && left < PLAZA_MAX &&
        bottom > PLAZA_MIN && top < PLAZA_MAX) {
      // Push room to the nearest edge outside the plaza
      const pushLeft  = PLAZA_MIN - right;   // negative = push left
      const pushRight = PLAZA_MAX - left;    // positive = push right
      const pushUp    = PLAZA_MIN - bottom;
      const pushDown  = PLAZA_MAX - top;

      // Pick smallest absolute push
      const pushes = [
        { axis: 'x', val: pushLeft },
        { axis: 'x', val: pushRight },
        { axis: 'z', val: pushUp },
        { axis: 'z', val: pushDown },
      ];
      pushes.sort((a, b) => Math.abs(a.val) - Math.abs(b.val));
      const best = pushes[0];
      if (best.axis === 'x') sp.cx += best.val;
      else sp.cz += best.val;
    }
  }
}
```

### Exact Changes to `layout.ts`

**Remove:**
```typescript
import forceAtlas2 from "npm:graphology-layout-forceatlas2";
```

**Remove the entire "Step 3: ForceAtlas2 layout" block (lines ~601-623 in current file):**
```typescript
// DELETE: forceAtlas2.assign(g, { ... })
// DELETE: all random initial position assignment
```

**Remove the entire "Step 4: Scale to world coordinates" block** that reads FA2 node attributes `x`/`y`.

**Remove the entire "Step 5: Overlap removal" block** (the iterative pair-push loop).

**Replace with** the grid-based placement algorithm above, inserted after Louvain (Step 2b). The new code:

1. Groups concepts into districts (by `zoneId` from Louvain).
2. Computes grid cell assignments for each district.
3. Calls `placeDistrictRooms()` per district.
4. Calls `enforcePanel()` to clear the plaza area.
5. Snaps all positions to integer coordinates.
6. The resulting `spacePositions: SpacePosition[]` array feeds into the rest of the pipeline (Step 7 onward) **unchanged**.

**Keep all existing downstream code**: elevation assignment, space construction, A* path routing, artifact placement, NPC placement, spawn point computation.

### Path Routing Changes

The existing A* router in `routePath()` / `astar()` remains unchanged in its algorithm. The grid-based layout naturally produces grid-aligned rooms, so A* will produce L-shaped grid-aligned paths.

**Path width assignment** is governed by a new classification function:

```typescript
function classifyPathWidth(
  sourceSpace: SpacePosition,
  targetSpace: SpacePosition,
  rel: Relationship,
  hubConceptIds: Set<string>,
): number {
  const sourceIsHub = hubConceptIds.has(sourceSpace.conceptId);
  const targetIsHub = hubConceptIds.has(targetSpace.conceptId);
  const sameZone = sourceSpace.zoneId === targetSpace.zoneId;

  // Boulevard: hub-to-hub or hub-to-plaza connection
  if (sourceIsHub && targetIsHub) return 6;

  // Street: within same district, involving the hub
  if (sameZone && (sourceIsHub || targetIsHub)) return 3;

  // Street: within same district, non-hub
  if (sameZone) return 3;

  // Alley: cross-district connections
  return 2;
}
```

This replaces the existing `pathWidthForStyle()` call in the path construction loop. The `corridor_style` from the relationship is no longer used for width; instead width is derived from the topological role of the connection.

### Spawn Point

After grid placement, spawn point is placed at the **center of the central plaza** instead of at the first learning-path concept:

```typescript
spawnPoint = { x: 50, y: 2, z: 50 };
// Center of plaza [30..70, 30..70] = (50, 2, 50)
// Module 6 will elevate this to y=6 on the vista platform
```

### Seed Data: Exact New Positions

The current seed data has 4 Louvain zones. Grid assignment: 2x2 grid.

| Zone (zone_id) | Grid Cell | World Origin (ox, oz) |
|----------------|-----------|----------------------|
| Cell Biology (0) | (0, 0) | (0, 0) |
| Genetics (1) | (1, 0) | (80, 0) |
| Biochemistry (2) | (0, 1) | (0, 80) |
| Evolution (3) | (1, 1) | (80, 80) |

Central plaza: `(30, 0, 30)` to `(70, 0, 70)` -- straddles the intersection of all 4 districts.

**Cell Biology district** (origin 0,0 -- hub is `cell_structure`, importance 9):

| Concept | Role | Position (x,y,z) | Size (w,h,d) |
|---------|------|-------------------|--------------|
| `cell_structure` | Hub | (20, 0, 20) | 16 x 6 x 16 |
| `mitochondria` | Satellite | (5, 0, 5) | 12 x 6 x 12 |
| `cell_membrane` | Satellite | (5, 0, 35) | 12 x 6 x 12 |
| `photosynthesis` | Satellite | (40, 0, 10) | 12 x 6 x 12 |

Note: `cell_structure` position field is bottom-left corner, so `position.x = cx - halfW = 20 - 8 = 12`, `position.z = 20 - 8 = 12`. But for clarity in the seed JSON, positions are stored as bottom-left corners:
- `cell_structure`: `{ x: 12, y: 0, z: 12 }`, size `{ width: 16, height: 6, depth: 16 }`
- `mitochondria`: `{ x: -1, y: 0, z: -1 }`, size `{ width: 12, height: 6, depth: 12 }`
- `cell_membrane`: `{ x: -1, y: 0, z: 29 }`, size `{ width: 12, height: 6, depth: 12 }`
- `photosynthesis`: `{ x: 34, y: 0, z: 4 }`, size `{ width: 12, height: 6, depth: 12 }`

**Genetics district** (origin 80,0 -- hub is `dna`, importance 10):

| Concept | Role | Center (cx,cz) | Bottom-Left Position | Size |
|---------|------|----------------|---------------------|------|
| `dna` | Hub | (120, 20) | `{ x: 112, y: 0, z: 12 }` | 16 x 6 x 16 |
| `mutations` | Satellite | (100, 40) | `{ x: 96, y: 0, z: 36 }` | 8 x 6 x 8 |

**Biochemistry district** (origin 0,80 -- hub is `proteins`, importance 8):

| Concept | Role | Center (cx,cz) | Bottom-Left Position | Size |
|---------|------|----------------|---------------------|------|
| `proteins` | Hub | (20, 120) | `{ x: 14, y: 0, z: 114 }` | 12 x 6 x 12 |
| `enzymes` | Satellite | (5, 105) | `{ x: -1, y: 0, z: 99 }` | 12 x 6 x 12 |

**Evolution district** (origin 80,80 -- hub is `evolution`, importance 9):

| Concept | Role | Center (cx,cz) | Bottom-Left Position | Size |
|---------|------|----------------|---------------------|------|
| `evolution` | Hub | (120, 120) | `{ x: 112, y: 0, z: 112 }` | 16 x 6 x 16 |
| `natural_selection` | Satellite | (100, 105) | `{ x: 94, y: 0, z: 99 }` | 12 x 6 x 12 |

**Spawn point**: `{ x: 50, y: 4, z: 50 }` -- center of central plaza, elevated (Module 6 adds the platform at y=4).

### Seed Data: Exact New Paths

All paths use grid-aligned L-shaped waypoints (one turn per path). Width is derived from `classifyPathWidth()`.

**Boulevards (width 6)** -- hub to central plaza center (50, 0, 50):

```json
{
  "id": "cell_structure_to_plaza",
  "source_space_id": "cell_structure",
  "target_space_id": "dna",
  "waypoints": [
    { "x": 20, "y": 0, "z": 20 },
    { "x": 50, "y": 0, "z": 20 },
    { "x": 50, "y": 0, "z": 50 }
  ],
  "width": 6,
  "floor_block": "stone_path",
  "wall_block": null,
  "style": "trail",
  "direction": "forward"
}
```

Note: In practice, boulevards are created as paths between hubs that pass through the plaza. The 4 boulevard paths in the seed data:

1. **`cell_structure` (20,20) -> `dna` (120,20)**: waypoints `[(20,0,20), (50,0,20), (50,0,50), (120,0,50), (120,0,20)]`, width 6
2. **`cell_structure` (20,20) -> `proteins` (20,120)**: waypoints `[(20,0,20), (20,0,50), (50,0,50), (50,0,120), (20,0,120)]`, width 6
3. **`dna` (120,20) -> `evolution` (120,120)**: waypoints `[(120,0,20), (120,0,50), (120,0,120)]`, width 6
4. **`proteins` (20,120) -> `evolution` (120,120)**: waypoints `[(20,0,120), (50,0,120), (120,0,120)]`, width 6

**Streets (width 3)** -- hub to satellites within the same district:

5. **`cell_structure` -> `mitochondria`**: waypoints `[(20,0,20), (20,0,5), (5,0,5)]`, width 3
6. **`cell_structure` -> `cell_membrane`**: waypoints `[(20,0,20), (20,0,35), (5,0,35)]`, width 3
7. **`cell_structure` -> `photosynthesis`**: waypoints `[(20,0,20), (40,0,20), (40,0,10)]`, width 3
8. **`dna` -> `mutations`**: waypoints `[(120,0,20), (100,0,20), (100,0,40)]`, width 3
9. **`proteins` -> `enzymes`**: waypoints `[(20,0,120), (5,0,120), (5,0,105)]`, width 3
10. **`evolution` -> `natural_selection`**: waypoints `[(120,0,120), (100,0,120), (100,0,105)]`, width 3

**Alleys (width 2)** -- cross-district connections:

11. **`mutations` -> `natural_selection`**: waypoints `[(100,0,40), (100,0,70), (100,0,105)]`, width 2
12. **`photosynthesis` -> `enzymes`**: waypoints `[(40,0,10), (40,0,50), (5,0,50), (5,0,105)]`, width 2
13. **`cell_membrane` -> `proteins`**: waypoints `[(5,0,35), (5,0,70), (20,0,70), (20,0,120)]`, width 2

### Dependency Removal

Remove `graphology-layout-forceatlas2` from the Deno import map or `package.json`. The `graphology` and `graphology-communities-louvain` packages are kept for graph construction and Louvain clustering.

---

## Module 2: Shape Language for Artifacts

### Goal

Replace the uniform placeholder cube (`createPlaceholderArtifact` in `loader.ts`) with category-specific procedural shapes that communicate concept type at a glance.

### New File: `src/web/artifacts/shapes.ts`

```typescript
import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Color4,
  Vector3,
  Mesh,
  ParticleSystem,
  Texture,
  SpotLight,
  GlowLayer,
} from "@babylonjs/core";

// ─── Category Classification ───

export type ConceptCategory =
  | "structure"
  | "process"
  | "molecule"
  | "theory"
  | "system";

/**
 * Classify a concept into a visual category using keyword matching
 * on concept name and cluster_label.
 */
export function categorize(
  name: string,
  clusterLabel: string,
): ConceptCategory {
  const combined = `${name} ${clusterLabel}`.toLowerCase();

  // Order matters: more specific categories first
  if (/protein|enzyme|dna|rna|amino|lipid|atp|molecule/.test(combined))
    return "molecule";
  if (/photosynth|respir|division|selection|mitosis|meiosis|transport/.test(combined))
    return "process";
  if (/cell|membrane|structur|wall|organelle|ribosome|nucleus/.test(combined))
    return "structure";
  if (/evolution|genetic|inherit|ecology|theory|taxonomy/.test(combined))
    return "theory";
  if (/nervous|circulat|immune|system|digest|endocrine/.test(combined))
    return "system";

  // Default fallback
  return "structure";
}

// ─── Importance Tiers ───

interface ImportanceTier {
  scale: number;
  emissiveIntensity: number;  // 0.0 = none, up to 0.8
  addParticles: boolean;
  addBeaconLight: boolean;
  addGlowLayer: boolean;
}

function getTier(importance: number): ImportanceTier {
  if (importance >= 9)
    return { scale: 1.3, emissiveIntensity: 0.6, addParticles: true,
             addBeaconLight: true, addGlowLayer: true };
  if (importance >= 7)
    return { scale: 1.0, emissiveIntensity: 0.4, addParticles: true,
             addBeaconLight: false, addGlowLayer: true };
  if (importance >= 4)
    return { scale: 0.8, emissiveIntensity: 0.2, addParticles: false,
             addBeaconLight: false, addGlowLayer: false };
  return   { scale: 0.5, emissiveIntensity: 0.0, addParticles: false,
             addBeaconLight: false, addGlowLayer: false };
}

// ─── Hex Utility ───

function hexToColor3(hex: string): Color3 {
  const c = hex.replace("#", "");
  return new Color3(
    parseInt(c.substring(0, 2), 16) / 255,
    parseInt(c.substring(2, 4), 16) / 255,
    parseInt(c.substring(4, 6), 16) / 255,
  );
}

// ─── Shape Generators ───

/**
 * STRUCTURE: Icosahedron (polyhedron type 3) with wireframe overlay.
 * Semi-transparent lattice/crystalline aesthetic.
 */
function createStructureShape(
  scene: Scene,
  id: string,
  color: Color3,
  tier: ImportanceTier,
): Mesh {
  const parent = new Mesh(`artifact_structure_${id}`, scene);
  const radius = 0.8 * tier.scale;

  // Solid semi-transparent core
  const core = MeshBuilder.CreatePolyhedron(
    `struct_core_${id}`,
    { type: 3, size: radius },
    scene,
  );
  const coreMat = new StandardMaterial(`struct_coreMat_${id}`, scene);
  coreMat.diffuseColor = color;
  coreMat.alpha = 0.7;
  coreMat.emissiveColor = color.scale(tier.emissiveIntensity);
  coreMat.specularColor = new Color3(0.3, 0.3, 0.3);
  core.material = coreMat;
  core.parent = parent;

  // Wireframe overlay (slightly larger)
  const wireframe = MeshBuilder.CreatePolyhedron(
    `struct_wire_${id}`,
    { type: 3, size: radius * 1.05 },
    scene,
  );
  const wireMat = new StandardMaterial(`struct_wireMat_${id}`, scene);
  wireMat.diffuseColor = color.scale(0.6);
  wireMat.wireframe = true;
  wireMat.emissiveColor = color.scale(0.3);
  wireframe.material = wireMat;
  wireframe.parent = parent;

  return parent;
}

/**
 * PROCESS: Interlocking torus rings (2-3 at different angles).
 * Gears/flow feel with slow rotation animation.
 */
function createProcessShape(
  scene: Scene,
  id: string,
  color: Color3,
  tier: ImportanceTier,
): Mesh {
  const parent = new Mesh(`artifact_process_${id}`, scene);
  const baseRadius = 0.7 * tier.scale;

  // Warm color shift for processes
  const warmColor = new Color3(
    Math.min(1, color.r + 0.15),
    color.g,
    Math.max(0, color.b - 0.1),
  );

  const torusCount = tier.scale >= 1.0 ? 3 : 2;
  const rotations = [
    { x: 0, y: 0, z: 0 },
    { x: Math.PI / 3, y: 0, z: Math.PI / 4 },
    { x: 0, y: Math.PI / 3, z: Math.PI / 6 },
  ];

  for (let i = 0; i < torusCount; i++) {
    const torus = MeshBuilder.CreateTorus(
      `process_ring_${id}_${i}`,
      {
        diameter: baseRadius * 2,
        thickness: 0.12 * tier.scale,
        tessellation: 32,
      },
      scene,
    );
    const mat = new StandardMaterial(`process_mat_${id}_${i}`, scene);
    mat.diffuseColor = warmColor.scale(1.0 - i * 0.15);
    mat.emissiveColor = warmColor.scale(tier.emissiveIntensity);
    mat.specularColor = new Color3(0.4, 0.4, 0.4);
    torus.material = mat;
    torus.rotation.x = rotations[i].x;
    torus.rotation.y = rotations[i].y;
    torus.rotation.z = rotations[i].z;
    torus.parent = parent;
  }

  // Slow rotation animation
  let angle = 0;
  scene.registerBeforeRender(() => {
    if (parent.isDisposed()) return;
    angle += 0.003;
    parent.rotation.y = angle;
  });

  return parent;
}

/**
 * MOLECULE: Cluster of 4-6 spheres connected by thin cylinders.
 * Ball-and-stick model aesthetic.
 */
function createMoleculeShape(
  scene: Scene,
  id: string,
  color: Color3,
  tier: ImportanceTier,
): Mesh {
  const parent = new Mesh(`artifact_molecule_${id}`, scene);
  const atomRadius = 0.15 * tier.scale;
  const bondRadius = 0.03 * tier.scale;

  // Organic color palette
  const organicColor = new Color3(
    Math.max(0, color.r - 0.05),
    Math.min(1, color.g + 0.1),
    Math.max(0, color.b - 0.05),
  );

  const atomMat = new StandardMaterial(`mol_atomMat_${id}`, scene);
  atomMat.diffuseColor = organicColor;
  atomMat.emissiveColor = organicColor.scale(tier.emissiveIntensity);
  atomMat.specularColor = new Color3(0.5, 0.5, 0.5);

  const bondMat = new StandardMaterial(`mol_bondMat_${id}`, scene);
  bondMat.diffuseColor = new Color3(0.6, 0.6, 0.6);

  // Atom positions (predefined molecule shape)
  const atomCount = tier.scale >= 1.0 ? 6 : 4;
  const atomPositions: Vector3[] = [
    new Vector3(0, 0, 0),                              // center
    new Vector3(0.4, 0.2, 0),                           // right-up
    new Vector3(-0.3, 0.3, 0.2),                        // left-up-forward
    new Vector3(0, -0.3, -0.3),                         // down-back
    new Vector3(0.3, -0.1, 0.4),                        // right-down-forward
    new Vector3(-0.4, -0.2, -0.1),                      // left-down-back
  ];

  // Scale positions
  for (const p of atomPositions) {
    p.scaleInPlace(tier.scale);
  }

  // Create atoms
  for (let i = 0; i < atomCount; i++) {
    const atom = MeshBuilder.CreateSphere(
      `mol_atom_${id}_${i}`,
      { diameter: atomRadius * 2, segments: 12 },
      scene,
    );
    atom.position = atomPositions[i];
    atom.material = atomMat;
    atom.parent = parent;
  }

  // Create bonds (connect each non-center atom to center)
  for (let i = 1; i < atomCount; i++) {
    const start = atomPositions[0];
    const end = atomPositions[i];
    const dist = Vector3.Distance(start, end);
    const mid = Vector3.Center(start, end);

    const bond = MeshBuilder.CreateCylinder(
      `mol_bond_${id}_${i}`,
      { height: dist, diameter: bondRadius * 2, tessellation: 8 },
      scene,
    );
    bond.position = mid;
    bond.material = bondMat;
    bond.parent = parent;

    // Orient cylinder between two points
    const direction = end.subtract(start).normalize();
    const up = new Vector3(0, 1, 0);
    const axis = Vector3.Cross(up, direction).normalize();
    const angle = Math.acos(Vector3.Dot(up, direction));
    if (axis.length() > 0.001) {
      bond.rotationQuaternion = null;
      bond.rotate(axis, angle, BABYLON.Space.WORLD);
    }
  }

  // Slow tumble
  let t = 0;
  scene.registerBeforeRender(() => {
    if (parent.isDisposed()) return;
    t += 0.002;
    parent.rotation.y = t;
    parent.rotation.x = Math.sin(t * 0.5) * 0.1;
  });

  return parent;
}

/**
 * THEORY: Book shape (flat wide box) with floating orbiting page planes.
 * Gold/brown scholarly tones.
 */
function createTheoryShape(
  scene: Scene,
  id: string,
  color: Color3,
  tier: ImportanceTier,
): Mesh {
  const parent = new Mesh(`artifact_theory_${id}`, scene);
  const s = tier.scale;

  // Book body: flat wide box
  const book = MeshBuilder.CreateBox(
    `theory_book_${id}`,
    { width: 0.6 * s, height: 0.15 * s, depth: 0.8 * s },
    scene,
  );
  const bookMat = new StandardMaterial(`theory_bookMat_${id}`, scene);
  // Warm gold/brown
  bookMat.diffuseColor = new Color3(0.6, 0.45, 0.2);
  bookMat.emissiveColor = new Color3(0.6, 0.45, 0.2).scale(tier.emissiveIntensity);
  bookMat.specularColor = new Color3(0.3, 0.25, 0.1);
  book.material = bookMat;
  book.parent = parent;

  // Floating page planes orbiting slowly
  const pageCount = tier.scale >= 1.0 ? 3 : 2;
  const pageMat = new StandardMaterial(`theory_pageMat_${id}`, scene);
  pageMat.diffuseColor = new Color3(0.95, 0.92, 0.85);
  pageMat.emissiveColor = new Color3(0.95, 0.92, 0.85).scale(0.2);
  pageMat.backFaceCulling = false;
  pageMat.alpha = 0.85;

  const pages: Mesh[] = [];
  for (let i = 0; i < pageCount; i++) {
    const page = MeshBuilder.CreatePlane(
      `theory_page_${id}_${i}`,
      { width: 0.3 * s, height: 0.4 * s },
      scene,
    );
    page.material = pageMat;
    page.parent = parent;
    pages.push(page);
  }

  // Orbiting animation
  let angle = 0;
  scene.registerBeforeRender(() => {
    if (parent.isDisposed()) return;
    angle += 0.004;
    for (let i = 0; i < pages.length; i++) {
      const offset = (i / pages.length) * Math.PI * 2;
      const orbitRadius = 0.5 * s;
      pages[i].position.x = Math.cos(angle + offset) * orbitRadius;
      pages[i].position.y = 0.3 * s + Math.sin(angle * 2 + offset) * 0.05;
      pages[i].position.z = Math.sin(angle + offset) * orbitRadius;
      pages[i].rotation.y = -(angle + offset);
    }
  });

  return parent;
}

/**
 * SYSTEM: Node-and-edge network graph.
 * 5-8 small spheres connected by thin cylinders in a 3D layout.
 */
function createSystemShape(
  scene: Scene,
  id: string,
  color: Color3,
  tier: ImportanceTier,
): Mesh {
  const parent = new Mesh(`artifact_system_${id}`, scene);
  const s = tier.scale;

  const nodeCount = tier.scale >= 1.0 ? 8 : 5;
  const nodeRadius = 0.08 * s;
  const edgeRadius = 0.02 * s;

  const nodeMat = new StandardMaterial(`sys_nodeMat_${id}`, scene);
  nodeMat.diffuseColor = color;
  nodeMat.emissiveColor = color.scale(Math.max(0.3, tier.emissiveIntensity));
  nodeMat.specularColor = new Color3(0.4, 0.4, 0.4);

  const edgeMat = new StandardMaterial(`sys_edgeMat_${id}`, scene);
  edgeMat.diffuseColor = color.scale(0.5);
  edgeMat.alpha = 0.6;

  // Generate node positions (pseudo-random but deterministic from id)
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  let seed = Math.abs(hash);
  const rand = (): number => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  const nodePositions: Vector3[] = [];
  for (let i = 0; i < nodeCount; i++) {
    nodePositions.push(new Vector3(
      (rand() - 0.5) * 0.8 * s,
      (rand() - 0.5) * 0.8 * s,
      (rand() - 0.5) * 0.8 * s,
    ));
  }

  // Create nodes
  for (let i = 0; i < nodeCount; i++) {
    const node = MeshBuilder.CreateSphere(
      `sys_node_${id}_${i}`,
      { diameter: nodeRadius * 2, segments: 8 },
      scene,
    );
    node.position = nodePositions[i];
    node.material = nodeMat;
    node.parent = parent;
  }

  // Create edges (connect neighbors -- each node to 2-3 nearest)
  const connected = new Set<string>();
  for (let i = 0; i < nodeCount; i++) {
    // Sort by distance from node i
    const distances = nodePositions
      .map((p, j) => ({ j, dist: Vector3.Distance(nodePositions[i], p) }))
      .filter((d) => d.j !== i)
      .sort((a, b) => a.dist - b.dist);

    const connectCount = Math.min(2, distances.length);
    for (let c = 0; c < connectCount; c++) {
      const j = distances[c].j;
      const edgeKey = [Math.min(i, j), Math.max(i, j)].join("_");
      if (connected.has(edgeKey)) continue;
      connected.add(edgeKey);

      const start = nodePositions[i];
      const end = nodePositions[j];
      const dist = Vector3.Distance(start, end);
      const mid = Vector3.Center(start, end);

      const edge = MeshBuilder.CreateCylinder(
        `sys_edge_${id}_${i}_${j}`,
        { height: dist, diameter: edgeRadius * 2, tessellation: 6 },
        scene,
      );
      edge.position = mid;
      edge.material = edgeMat;
      edge.parent = parent;

      // Orient
      const dir = end.subtract(start).normalize();
      const up = new Vector3(0, 1, 0);
      const axis = Vector3.Cross(up, dir).normalize();
      const ang = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(up, dir))));
      if (axis.length() > 0.001) {
        edge.rotationQuaternion = null;
        edge.rotate(axis, ang, BABYLON.Space.WORLD);
      }
    }
  }

  // Slow rotation
  let t = 0;
  scene.registerBeforeRender(() => {
    if (parent.isDisposed()) return;
    t += 0.002;
    parent.rotation.y = t;
  });

  return parent;
}

// ─── Main Entry Point ───

/**
 * Create a category-specific artifact mesh with importance-tier visual effects.
 *
 * @param scene       Babylon.js scene
 * @param id          Unique artifact ID (used for mesh naming)
 * @param category    Concept category from categorize()
 * @param importance  Concept importance (1-10)
 * @param zoneColor   Hex color string for the concept's zone
 * @param worldPos    World position to place the artifact
 * @param pedestalHeight  Height of pedestal (artifact placed on top)
 */
export function createArtifactByCategory(
  scene: Scene,
  id: string,
  category: ConceptCategory,
  importance: number,
  zoneColor: string,
  worldPos: { x: number; y: number; z: number },
  pedestalHeight: number,
): Mesh {
  const color = hexToColor3(zoneColor);
  const tier = getTier(importance);

  let mesh: Mesh;
  switch (category) {
    case "structure":
      mesh = createStructureShape(scene, id, color, tier);
      break;
    case "process":
      mesh = createProcessShape(scene, id, color, tier);
      break;
    case "molecule":
      mesh = createMoleculeShape(scene, id, color, tier);
      break;
    case "theory":
      mesh = createTheoryShape(scene, id, color, tier);
      break;
    case "system":
      mesh = createSystemShape(scene, id, color, tier);
      break;
  }

  // Position on top of pedestal
  mesh.position = new Vector3(
    worldPos.x,
    worldPos.y + pedestalHeight + 0.5,
    worldPos.z,
  );

  // ── Importance Effects ──

  // Glow layer (importance 7+)
  if (tier.addGlowLayer) {
    const gl = scene.getGlowLayerByName("defaultGlow")
      ?? new GlowLayer("defaultGlow", scene, {
        mainTextureFixedSize: 512,
        blurKernelSize: 32,
      });
    gl.intensity = 0.5;
    gl.addIncludedOnlyMesh(mesh);
  }

  // Particle sparkles (importance 7+)
  if (tier.addParticles) {
    const ps = new ParticleSystem(`sparkle_${id}`, 30, scene);
    ps.emitter = mesh;
    ps.minSize = 0.02;
    ps.maxSize = 0.06;
    ps.minLifeTime = 0.8;
    ps.maxLifeTime = 2.0;
    ps.emitRate = 15;
    ps.direction1 = new Vector3(-0.3, 0.5, -0.3);
    ps.direction2 = new Vector3(0.3, 1.0, 0.3);
    ps.gravity = new Vector3(0, -0.05, 0);
    ps.color1 = new Color4(1, 0.95, 0.7, 1);
    ps.color2 = new Color4(1, 0.85, 0.4, 0.8);
    ps.colorDead = new Color4(1, 0.8, 0.3, 0);
    ps.createPointEmitter(
      new Vector3(-0.2, 0, -0.2),
      new Vector3(0.2, 0.3, 0.2),
    );
    ps.start();
  }

  // Beacon SpotLight (importance 9+)
  if (tier.addBeaconLight) {
    const beacon = new SpotLight(
      `beacon_${id}`,
      new Vector3(worldPos.x, worldPos.y + pedestalHeight + 1.5, worldPos.z),
      new Vector3(0, 1, 0),   // pointing UP
      Math.PI / 6,             // cone angle 30 degrees
      2,                       // exponent
      scene,
    );
    beacon.intensity = 0.8;
    beacon.range = 40;
    beacon.diffuse = color;
  }

  // Slow spin for all artifacts
  scene.registerBeforeRender(() => {
    if (!mesh.isDisposed()) {
      mesh.rotation.y += 0.005;
    }
  });

  return mesh;
}
```

### Changes to `src/web/artifacts/loader.ts`

**Import the new module:**

```typescript
import { createArtifactByCategory, categorize } from "./shapes";
```

**Replace `createPlaceholderArtifact` function body.** The new version looks up the concept from the config to get `cluster_label` and `importance`, then delegates to the shape system:

```typescript
/**
 * Create a category-specific placeholder artifact.
 * Called when GLB loading fails or glb_url is "/placeholder.glb".
 *
 * @param scene    Babylon.js scene
 * @param artifact Artifact configuration
 * @param config   Full PalaceConfig (needed to look up concept data)
 */
function createPlaceholderArtifact(
  scene: Scene,
  artifact: Artifact,
  config: PalaceConfig,
): void {
  // Look up concept data
  const concept = config.concept_graph.concepts.find(
    (c) => c.id === artifact.concept_id,
  );
  if (!concept) {
    // Fallback to old colored cube if concept not found
    const box = MeshBuilder.CreateBox(
      `placeholder_${artifact.id}`,
      { size: 0.8 * artifact.scale },
      scene,
    );
    box.position = new Vector3(
      artifact.position.x,
      artifact.position.y + artifact.pedestal.height + 0.5,
      artifact.position.z,
    );
    return;
  }

  // Find zone color from the space
  const space = config.spaces.find((s) => s.concept_id === artifact.concept_id);
  const zoneColor = space?.zone_color ?? "#888888";

  const category = categorize(concept.name, concept.cluster_label);
  createArtifactByCategory(
    scene,
    artifact.id,
    category,
    concept.importance,
    zoneColor,
    artifact.position,
    artifact.pedestal.height,
  );
}
```

**Update `loadArtifact` signature** to accept the full config:

```typescript
export async function loadArtifact(
  scene: Scene,
  artifact: Artifact,
  config: PalaceConfig,   // NEW parameter
): Promise<void> {
  // ... existing try block unchanged ...
  } catch (err) {
    console.warn(/*...*/);
    createPlaceholderArtifact(scene, artifact, config);  // pass config
  }
}
```

**Update call site in `src/web/world/generator.ts`:**

```typescript
// Line ~159 in generateWorld():
await loadArtifact(scene, artifact, config);  // add config argument
```

### Category Classification for Seed Data

| Concept | Name keywords | Cluster | Category |
|---------|--------------|---------|----------|
| `cell_structure` | "cell", "structure" | cell_biology | **structure** |
| `dna` | "dna" | genetics | **molecule** |
| `mitochondria` | "mitochondria" | cell_biology | **structure** |
| `proteins` | "protein" | molecular_biology | **molecule** |
| `evolution` | "evolution" | evolution | **theory** |
| `photosynthesis` | "photosynthesis" | physiology | **process** |
| `mutations` | "mutations" | genetics | **theory** |
| `enzymes` | "enzyme" | molecular_biology | **molecule** |
| `cell_membrane` | "cell", "membrane" | cell_biology | **structure** |
| `natural_selection` | "selection" | evolution | **process** |

---

## Module 3: Landmark Beacons

### Goal

Each zone hub gets a tall vertical landmark visible from anywhere in the palace. These serve as long-range wayfinding markers.

### Changes to `src/web/world/zones.ts`

Add the following exported function:

```typescript
import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Color4,
  Vector3,
  Mesh,
  SpotLight,
  ParticleSystem,
} from "@babylonjs/core";
import type { PalaceConfig, Space, Concept } from "../../shared/types";
```

**New function: `buildLandmarkBeacons`**

```typescript
/**
 * Identify the hub concept for each zone (highest importance) and build
 * a tall glowing beacon at its location.
 */
export function buildLandmarkBeacons(
  scene: Scene,
  config: PalaceConfig,
): void {
  // Group spaces by zone_id, find hub (highest importance) per zone
  const zoneSpaces = new Map<number, Space[]>();
  for (const space of config.spaces) {
    if (!zoneSpaces.has(space.zone_id)) zoneSpaces.set(space.zone_id, []);
    zoneSpaces.get(space.zone_id)!.push(space);
  }

  // Concept importance lookup
  const importanceMap = new Map<string, number>();
  for (const c of config.concept_graph.concepts) {
    importanceMap.set(c.id, c.importance);
  }

  for (const [zoneId, spaces] of zoneSpaces) {
    // Find hub: space with highest importance concept
    let hubSpace: Space | null = null;
    let maxImportance = -1;
    for (const space of spaces) {
      const imp = importanceMap.get(space.concept_id) ?? 0;
      if (imp > maxImportance) {
        maxImportance = imp;
        hubSpace = space;
      }
    }
    if (!hubSpace) continue;

    buildSingleBeacon(scene, hubSpace);
  }
}
```

**`buildSingleBeacon` implementation:**

```typescript
function hexToColor3(hex: string): Color3 {
  const c = hex.replace("#", "");
  return new Color3(
    parseInt(c.substring(0, 2), 16) / 255,
    parseInt(c.substring(2, 4), 16) / 255,
    parseInt(c.substring(4, 6), 16) / 255,
  );
}

function buildSingleBeacon(scene: Scene, hubSpace: Space): void {
  const zoneColor = hexToColor3(hubSpace.zone_color);
  const { position, size } = hubSpace;

  // Beacon base position: center of the hub space, at floor level
  const cx = position.x + size.width / 2;
  const cz = position.z + size.depth / 2;
  const baseY = position.y;

  const pillarHeight = 20;
  const pillarDiameter = 1.5;
  const sphereDiameter = 3;
  const beaconId = `beacon_${hubSpace.id}`;

  // ── Tall cylindrical pillar ──
  const pillar = MeshBuilder.CreateCylinder(
    `${beaconId}_pillar`,
    {
      height: pillarHeight,
      diameter: pillarDiameter,
      tessellation: 16,
    },
    scene,
  );
  const pillarMat = new StandardMaterial(`${beaconId}_pillarMat`, scene);
  pillarMat.diffuseColor = zoneColor;
  pillarMat.emissiveColor = zoneColor.scale(0.5);
  pillarMat.specularColor = new Color3(0.2, 0.2, 0.2);
  pillar.material = pillarMat;
  pillar.position = new Vector3(cx, baseY + pillarHeight / 2, cz);
  pillar.checkCollisions = true;

  // ── Glowing sphere on top ──
  const sphere = MeshBuilder.CreateSphere(
    `${beaconId}_sphere`,
    { diameter: sphereDiameter, segments: 24 },
    scene,
  );
  const sphereMat = new StandardMaterial(`${beaconId}_sphereMat`, scene);
  sphereMat.diffuseColor = zoneColor;
  sphereMat.emissiveColor = zoneColor.scale(0.8);
  sphereMat.alpha = 0.6;
  sphereMat.specularColor = new Color3(0.1, 0.1, 0.1);
  sphere.material = sphereMat;
  sphere.position = new Vector3(cx, baseY + pillarHeight + sphereDiameter / 2, cz);

  // ── SpotLight pointing upward from sphere ──
  const spotLight = new SpotLight(
    `${beaconId}_light`,
    new Vector3(cx, baseY + pillarHeight + sphereDiameter, cz),
    new Vector3(0, 1, 0),     // direction: straight up
    Math.PI / 6,               // angle: 30-degree cone
    2,                         // exponent
    scene,
  );
  spotLight.intensity = 1.0;
  spotLight.range = 50;
  spotLight.diffuse = zoneColor;

  // ── Particle system: upward emission from sphere ──
  const ps = new ParticleSystem(`${beaconId}_particles`, 20, scene);
  ps.emitter = new Vector3(cx, baseY + pillarHeight + sphereDiameter / 2, cz);
  ps.minSize = 0.08;
  ps.maxSize = 0.2;
  ps.minLifeTime = 1.5;
  ps.maxLifeTime = 2.5;
  ps.emitRate = 12;
  ps.direction1 = new Vector3(-0.1, 1.0, -0.1);
  ps.direction2 = new Vector3(0.1, 2.0, 0.1);
  ps.gravity = new Vector3(0, 0.1, 0);  // slight upward drift
  ps.color1 = new Color4(zoneColor.r, zoneColor.g, zoneColor.b, 1.0);
  ps.color2 = new Color4(zoneColor.r, zoneColor.g, zoneColor.b, 0.6);
  ps.colorDead = new Color4(zoneColor.r, zoneColor.g, zoneColor.b, 0.0);
  ps.createPointEmitter(
    new Vector3(-0.3, 0, -0.3),
    new Vector3(0.3, 0.5, 0.3),
  );
  ps.start();
}
```

### Hub Identification for Seed Data

| Zone | Hub Concept | Importance | Beacon Center (cx, y, cz) |
|------|-------------|------------|--------------------------|
| Cell Biology (0) | `cell_structure` | 9 | (20, 0, 20) |
| Genetics (1) | `dna` | 10 | (120, 0, 20) |
| Biochemistry (2) | `proteins` | 8 | (20, 0, 120) |
| Evolution (3) | `evolution` | 9 | (120, 0, 120) |

Each beacon pillar extends from y=0 to y=20 at the hub center. The glowing sphere sits at y=21.5 (pillarHeight + sphereDiameter/2). The spot light origin is at y=23.

### Integration in `generator.ts`

Add to `generateWorld()` after the zone archways step (step 4):

```typescript
import { buildZoneArchways, buildLandmarkBeacons } from "./zones";

// ... inside generateWorld():

// 4. Build zone transition archways
buildZoneArchways(scene, config, materials);

// 4b. Build landmark beacons at zone hubs
buildLandmarkBeacons(scene, config);
```

The function is self-contained: it does not need `materials` because it creates its own `StandardMaterial` instances from zone colors.

---

## Module 4: Road Hierarchy Visuals

### Goal

Make boulevards, streets, and alleys visually distinct through floor treatment, walls, and decorative elements (lantern posts on boulevards).

### Changes to `src/web/world/paths.ts`

**Add path classification enum and function:**

```typescript
type RoadClass = "boulevard" | "street" | "alley";

function classifyRoad(width: number): RoadClass {
  if (width >= 5) return "boulevard";
  if (width >= 3) return "street";
  return "alley";
}
```

**Modify `buildPath()` to branch on road class.**

The existing `buildPath` function stays as the entry point but dispatches to road-class-specific logic:

```typescript
export function buildPath(
  scene: Scene,
  path: Path,
  materials: Map<string, StandardMaterial>,
): void {
  const roadClass = classifyRoad(path.width);

  switch (roadClass) {
    case "boulevard":
      buildBoulevard(scene, path, materials);
      break;
    case "street":
      buildStreet(scene, path, materials);
      break;
    case "alley":
      buildAlley(scene, path, materials);
      break;
  }
}
```

**`buildBoulevard` -- wide road with emissive floor, low border walls, lantern posts:**

```typescript
function buildBoulevard(
  scene: Scene,
  path: Path,
  materials: Map<string, StandardMaterial>,
): void {
  const { waypoints, width, floor_block } = path;
  const floorMat = materials.get(floor_block);
  if (!floorMat) return;

  // Boulevard floor material: clone with slight emissive for "lit road" feel
  const boulevardFloorMat = floorMat.clone(`boulevardFloor_${path.id}`);
  boulevardFloorMat.emissiveColor = new Color3(0.08, 0.07, 0.05);

  const borderHeight = 0.5;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const wpA = waypoints[i];
    const wpB = waypoints[i + 1];
    const [perpX, perpZ] = perpendicularXZ(wpA, wpB);

    const segDx = wpB.x - wpA.x;
    const segDy = wpB.y - wpA.y;
    const segDz = wpB.z - wpA.z;
    const segLen = Math.sqrt(segDx * segDx + segDy * segDy + segDz * segDz);
    if (segLen < 0.1) continue;

    const midX = (wpA.x + wpB.x) / 2;
    const midY = (wpA.y + wpB.y) / 2;
    const midZ = (wpA.z + wpB.z) / 2;
    const angle = Math.atan2(segDx, segDz);

    // ── Floor strip (thick for boulevard) ──
    const floor = MeshBuilder.CreateBox(
      `bvdFloor_${path.id}_${i}`,
      { width: width, height: 0.35, depth: segLen + 0.5 },
      scene,
    );
    floor.position = new Vector3(midX, midY + 0.01, midZ);
    floor.rotation.y = angle;
    floor.material = boulevardFloorMat;
    floor.checkCollisions = true;

    // ── Low border walls on both sides ──
    const halfWidth = width / 2 + 0.2;
    const borderMat = new StandardMaterial(`bvdBorder_${path.id}_${i}`, scene);
    borderMat.diffuseColor = new Color3(0.45, 0.42, 0.38);
    borderMat.specularColor = new Color3(0.1, 0.1, 0.1);

    for (const side of [-1, 1]) {
      const wallOffX = perpX * halfWidth * side;
      const wallOffZ = perpZ * halfWidth * side;

      const border = MeshBuilder.CreateBox(
        `bvdBorder_${path.id}_${i}_${side > 0 ? "R" : "L"}`,
        { width: 0.3, height: borderHeight, depth: segLen + 0.5 },
        scene,
      );
      border.position = new Vector3(
        midX + wallOffX,
        midY + borderHeight / 2,
        midZ + wallOffZ,
      );
      border.rotation.y = angle;
      border.material = borderMat;
      border.checkCollisions = true;
    }

    // ── Lantern posts every 10 blocks along both sides ──
    const numLanterns = Math.floor(segLen / 10);
    for (let li = 0; li <= numLanterns; li++) {
      const t = numLanterns > 0 ? li / numLanterns : 0.5;
      const lx = wpA.x + segDx * t;
      const ly = wpA.y + segDy * t;
      const lz = wpA.z + segDz * t;

      for (const side of [-1, 1]) {
        const lanternX = lx + perpX * (halfWidth + 0.5) * side;
        const lanternZ = lz + perpZ * (halfWidth + 0.5) * side;

        // Reuse createLantern from props.ts
        // Since createLantern is not currently exported, we inline a
        // simplified lantern here. See integration note below.
        buildBoulevardLantern(scene, {
          x: lanternX,
          y: ly,
          z: lanternZ,
        }, `${path.id}_${i}_${li}_${side}`);
      }
    }
  }
}
```

**`buildBoulevardLantern` -- simplified lantern for path decoration:**

```typescript
function buildBoulevardLantern(
  scene: Scene,
  pos: { x: number; y: number; z: number },
  id: string,
): void {
  // Post
  const post = MeshBuilder.CreateCylinder(
    `lanternPost_${id}`,
    { height: 3.0, diameter: 0.15, tessellation: 8 },
    scene,
  );
  const postMat = new StandardMaterial(`lanternPostMat_${id}`, scene);
  postMat.diffuseColor = new Color3(0.25, 0.22, 0.18);
  post.material = postMat;
  post.position = new Vector3(pos.x, pos.y + 1.5, pos.z);
  post.checkCollisions = true;

  // Lamp housing
  const lamp = MeshBuilder.CreateBox(
    `lanternLamp_${id}`,
    { width: 0.3, height: 0.35, depth: 0.3 },
    scene,
  );
  const lampMat = new StandardMaterial(`lanternLampMat_${id}`, scene);
  lampMat.diffuseColor = new Color3(1.0, 0.85, 0.4);
  lampMat.emissiveColor = new Color3(0.8, 0.6, 0.2);
  lampMat.alpha = 0.7;
  lamp.material = lampMat;
  lamp.position = new Vector3(pos.x, pos.y + 3.1, pos.z);

  // Point light
  const light = new PointLight(
    `lanternLight_${id}`,
    new Vector3(pos.x, pos.y + 3.0, pos.z),
    scene,
  );
  light.intensity = 0.3;
  light.range = 8;
  light.diffuse = new Color3(1.0, 0.85, 0.5);
}
```

**Required import additions to `paths.ts`:**

```typescript
import {
  Scene,
  MeshBuilder,
  Vector3,
  StandardMaterial,
  Mesh,
  Color3,         // NEW
  PointLight,      // NEW
} from "@babylonjs/core";
```

**`buildStreet` -- standard treatment (the current implementation moved here):**

```typescript
function buildStreet(
  scene: Scene,
  path: Path,
  materials: Map<string, StandardMaterial>,
): void {
  // This is the existing buildPath body verbatim:
  // Floor strips + optional walls for corridor/tunnel styles.
  // (lines 71-148 of current paths.ts)
  const { waypoints, width, style, floor_block, wall_block } = path;
  const floorMat = materials.get(floor_block);
  if (!floorMat) return;
  const wallMat = wall_block ? materials.get(wall_block) : undefined;
  const needsWalls = style === "corridor" || style === "tunnel";
  const needsCeiling = style === "tunnel";
  const wallHeight = 3;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const wpA = waypoints[i];
    const wpB = waypoints[i + 1];
    const [perpX, perpZ] = perpendicularXZ(wpA, wpB);
    const segDx = wpB.x - wpA.x;
    const segDy = wpB.y - wpA.y;
    const segDz = wpB.z - wpA.z;
    const segLen = Math.sqrt(segDx * segDx + segDy * segDy + segDz * segDz);
    if (segLen < 0.1) continue;
    const midX = (wpA.x + wpB.x) / 2;
    const midY = (wpA.y + wpB.y) / 2;
    const midZ = (wpA.z + wpB.z) / 2;
    const angle = Math.atan2(segDx, segDz);

    const floor = MeshBuilder.CreateBox(
      `streetFloor_${path.id}_${i}`,
      { width, height: 0.25, depth: segLen + 0.5 },
      scene,
    );
    floor.position = new Vector3(midX, midY + 0.01, midZ);
    floor.rotation.y = angle;
    floor.material = floorMat;
    floor.checkCollisions = true;

    if (needsWalls && wallMat) {
      const halfWidth = width / 2 + 0.15;
      for (const side of [-1, 1]) {
        const wallOffX = perpX * halfWidth * side;
        const wallOffZ = perpZ * halfWidth * side;
        const wall = MeshBuilder.CreateBox(
          `streetWall_${path.id}_${i}_${side > 0 ? "R" : "L"}`,
          { width: 0.3, height: wallHeight, depth: segLen + 0.5 },
          scene,
        );
        wall.position = new Vector3(
          midX + wallOffX, midY + wallHeight / 2, midZ + wallOffZ,
        );
        wall.rotation.y = angle;
        wall.material = wallMat;
        wall.checkCollisions = true;
      }
    }
    if (needsCeiling && wallMat) {
      const ceiling = MeshBuilder.CreateBox(
        `streetCeil_${path.id}_${i}`,
        { width: width + 0.6, height: 0.3, depth: segLen + 0.5 },
        scene,
      );
      ceiling.position = new Vector3(midX, midY + wallHeight + 0.15, midZ);
      ceiling.rotation.y = angle;
      ceiling.material = wallMat;
    }
  }
}
```

**`buildAlley` -- narrow, darker, no walls:**

```typescript
function buildAlley(
  scene: Scene,
  path: Path,
  materials: Map<string, StandardMaterial>,
): void {
  const { waypoints, width, floor_block } = path;
  const floorMat = materials.get(floor_block);
  if (!floorMat) return;

  // Darker variant: clone material and reduce diffuse by 30%
  const alleyFloorMat = floorMat.clone(`alleyFloor_${path.id}`);
  alleyFloorMat.diffuseColor = alleyFloorMat.diffuseColor.scale(0.7);

  for (let i = 0; i < waypoints.length - 1; i++) {
    const wpA = waypoints[i];
    const wpB = waypoints[i + 1];
    const segDx = wpB.x - wpA.x;
    const segDy = wpB.y - wpA.y;
    const segDz = wpB.z - wpA.z;
    const segLen = Math.sqrt(segDx * segDx + segDy * segDy + segDz * segDz);
    if (segLen < 0.1) continue;

    const midX = (wpA.x + wpB.x) / 2;
    const midY = (wpA.y + wpB.y) / 2;
    const midZ = (wpA.z + wpB.z) / 2;
    const angle = Math.atan2(segDx, segDz);

    // Narrow floor, no walls
    const floor = MeshBuilder.CreateBox(
      `alleyFloor_${path.id}_${i}`,
      { width, height: 0.15, depth: segLen + 0.5 },
      scene,
    );
    floor.position = new Vector3(midX, midY + 0.01, midZ);
    floor.rotation.y = angle;
    floor.material = alleyFloorMat;
    floor.checkCollisions = true;
  }
}
```

### Integration Note: `createLantern` from `props.ts`

The existing `createLantern` in `props.ts` (line 608) is a private function. Two options:

1. **Recommended**: Inline a simplified `buildBoulevardLantern` in `paths.ts` (as shown above). This avoids coupling between the two files.
2. **Alternative**: Export `createLantern` from `props.ts` and import it in `paths.ts`. This requires adding `export` to the function signature in `props.ts` line 608.

### Path Width Values in Seed Data

After Module 1 recomputes paths with `classifyPathWidth`:

| Path | Current Width | New Width | Road Class |
|------|---------------|-----------|------------|
| Hub-to-hub (boulevards) | 4 | 6 | boulevard |
| Hub-to-satellite (within district) | 4 | 3 | street |
| Cross-district (non-hub) | 2 | 2 | alley |

---

## Module 5: Golden Path Breadcrumbs

### Goal

Render a visual trail of glowing golden markers along the `learning_path` sequence, guiding the player through concepts in pedagogical order.

### New File: `src/web/world/breadcrumbs.ts`

```typescript
import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  Mesh,
  DynamicTexture,
} from "@babylonjs/core";
import type {
  PalaceConfig,
  Space,
  Path as PalacePath,
  WorldPosition,
} from "../../shared/types";

/**
 * Build the golden breadcrumb trail along the learning path.
 *
 * For each consecutive pair of concepts in config.learning_path:
 *   1. Find the path connecting them.
 *   2. Along that path's waypoints, place glowing floor discs every 3 blocks.
 *   3. At each concept stop, place a numbered step marker.
 *
 * @param scene     Babylon.js scene
 * @param config    Full PalaceConfig
 * @param materials Block material map (not used for breadcrumbs but kept for consistency)
 * @returns Array of all created meshes
 */
export function buildGoldenPath(
  scene: Scene,
  config: PalaceConfig,
): Mesh[] {
  const meshes: Mesh[] = [];
  const lp = config.learning_path;
  if (!lp || lp.length < 2) return meshes;

  // Build lookup maps
  const spaceMap = new Map<string, Space>();
  for (const s of config.spaces) spaceMap.set(s.concept_id, s);

  const pathMap = new Map<string, PalacePath>();
  for (const p of config.paths) {
    // Index by both directions
    const key1 = `${p.source_space_id}__${p.target_space_id}`;
    const key2 = `${p.target_space_id}__${p.source_space_id}`;
    pathMap.set(key1, p);
    pathMap.set(key2, p);
  }

  // ── Golden material (shared across all breadcrumb discs) ──
  const goldMat = new StandardMaterial("goldenBreadcrumb", scene);
  goldMat.diffuseColor = new Color3(1.0, 0.84, 0.0);       // #FFD700
  goldMat.emissiveColor = new Color3(0.6, 0.5, 0.0);       // 60% emissive
  goldMat.specularColor = new Color3(0.8, 0.7, 0.3);
  goldMat.backFaceCulling = false;

  let globalDiscIndex = 0;

  // ── Place floor discs along each path segment ──
  for (let step = 0; step < lp.length - 1; step++) {
    const fromId = lp[step];
    const toId = lp[step + 1];
    const pathKey = `${fromId}__${toId}`;
    const palacePath = pathMap.get(pathKey);

    if (!palacePath) continue;

    // Determine if waypoints need to be reversed
    const waypoints =
      palacePath.source_space_id === fromId
        ? [...palacePath.waypoints]
        : [...palacePath.waypoints].reverse();

    // Walk along waypoints, placing discs every 3 blocks
    let accumulated = 0;
    for (let w = 0; w < waypoints.length - 1; w++) {
      const wpA = waypoints[w];
      const wpB = waypoints[w + 1];
      const dx = wpB.x - wpA.x;
      const dy = wpB.y - wpA.y;
      const dz = wpB.z - wpA.z;
      const segLen = Math.sqrt(dx * dx + dy * dy + dz * dz);

      let cursor = 0;
      // If there's leftover from previous segment, start from the remainder
      if (accumulated > 0) {
        cursor = 3 - accumulated;
      }

      while (cursor <= segLen) {
        const t = cursor / segLen;
        const discX = wpA.x + dx * t;
        const discY = wpA.y + dy * t;
        const discZ = wpA.z + dz * t;

        const disc = MeshBuilder.CreateDisc(
          `goldDisc_${globalDiscIndex}`,
          { radius: 0.4, tessellation: 16 },
          scene,
        );
        disc.rotation.x = Math.PI / 2;  // Lay flat on ground
        disc.position = new Vector3(discX, discY + 0.05, discZ);
        disc.material = goldMat;
        meshes.push(disc);

        // Bob animation (subtle y oscillation +/- 0.02)
        const baseY = discY + 0.05;
        const phase = globalDiscIndex * 0.7;  // stagger phase per disc
        scene.registerBeforeRender(() => {
          if (!disc.isDisposed()) {
            disc.position.y = baseY + Math.sin(Date.now() * 0.002 + phase) * 0.02;
          }
        });

        globalDiscIndex++;
        cursor += 3;
      }

      accumulated = (accumulated + segLen) % 3;
    }
  }

  // ── Numbered step markers at each concept along the learning path ──
  for (let step = 0; step < lp.length; step++) {
    const conceptId = lp[step];
    const space = spaceMap.get(conceptId);
    if (!space) continue;

    const markerMesh = createStepMarker(
      scene,
      step + 1,
      space,
      `goldenStep_${step}`,
    );
    meshes.push(markerMesh);
  }

  return meshes;
}

/**
 * Create a numbered step marker (billboard plane with DynamicTexture)
 * positioned above a room entrance.
 */
function createStepMarker(
  scene: Scene,
  stepNumber: number,
  space: Space,
  id: string,
): Mesh {
  const planeSize = 1.2;
  const plane = MeshBuilder.CreatePlane(
    id,
    { width: planeSize, height: planeSize },
    scene,
  );

  // Position above the front-center of the room (z + depth = entrance side)
  const cx = space.position.x + space.size.width / 2;
  const entranceZ = space.position.z;  // front face
  plane.position = new Vector3(
    cx,
    space.position.y + space.size.height + 1.5,
    entranceZ,
  );
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;

  // DynamicTexture with step number
  const texSize = 128;
  const dt = new DynamicTexture(`${id}_tex`, texSize, scene, false);
  dt.hasAlpha = true;

  const ctx = dt.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, texSize, texSize);

  // Golden circle background
  ctx.beginPath();
  ctx.arc(texSize / 2, texSize / 2, texSize / 2 - 4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 215, 0, 0.85)";
  ctx.fill();
  ctx.strokeStyle = "rgba(180, 140, 0, 1)";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Number text
  ctx.fillStyle = "rgba(40, 30, 0, 1)";
  ctx.font = `bold 72px Inter, Segoe UI, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${stepNumber}`, texSize / 2, texSize / 2);
  dt.update();

  const mat = new StandardMaterial(`${id}_mat`, scene);
  mat.diffuseTexture = dt;
  mat.emissiveColor = new Color3(1, 0.9, 0.4);
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.useAlphaFromDiffuseTexture = true;
  plane.material = mat;

  return plane;
}
```

### Integration in `generator.ts`

Add after artifact loading (step 5):

```typescript
import { buildGoldenPath } from "./breadcrumbs";

// ... inside generateWorld():

// 6b. Build golden breadcrumb trail
buildGoldenPath(scene, config);
```

### Seed Data Learning Path

The learning path in seed data is:
```
["cell_structure", "cell_membrane", "mitochondria", "dna", "proteins",
 "enzymes", "mutations", "photosynthesis", "evolution", "natural_selection"]
```

Golden discs will be placed along these path segments (referencing Module 1 paths):
1. `cell_structure` -> `cell_membrane` (street, width 3)
2. `cell_membrane` -> ... (needs a path to `mitochondria`; if no direct path exists, skip)
3. `mitochondria` -> ... (path to `dna` via streets/alleys)
4. etc.

If a direct path does not exist between consecutive learning-path concepts, the golden trail skips that segment. The numbered markers still appear at each concept room.

---

## Module 6: Spawn Vista

### Goal

The player starts on an elevated platform in the central plaza, overlooking the entire palace. This gives an immediate sense of spatial orientation.

### Changes to `src/web/world/generator.ts`

**New function `buildSpawnVista`:**

```typescript
/**
 * Build an elevated spawn platform in the central plaza.
 * The player starts here, overlooking the palace districts.
 *
 * Platform specs:
 *   - Position: center of central plaza at (50, 4, 50)
 *   - Platform body: 8 x 0.3 x 8 CreateBox
 *   - 4 low railing walls (height 1.0, thickness 0.2)
 *   - 4 steps descending from one side to ground level
 *   - Camera spawns at (50, 6, 50) looking toward first learning path concept
 */
function buildSpawnVista(
  scene: Scene,
  config: PalaceConfig,
  materials: Map<string, StandardMaterial>,
): void {
  const platformX = 50;
  const platformY = 4;
  const platformZ = 50;
  const platformW = 8;
  const platformD = 8;
  const platformH = 0.3;
  const railHeight = 1.0;
  const railThickness = 0.2;

  // ── Material ──
  // Use the first accent block or fall back to ground block
  const stoneBlockId =
    config.theme.palette.accent[0]?.id ??
    config.theme.palette.ground[0]?.id;
  const baseMat = stoneBlockId ? materials.get(stoneBlockId) : undefined;

  const platformMat =
    baseMat?.clone("spawnPlatformMat") ??
    (() => {
      const m = new StandardMaterial("spawnPlatformMat", scene);
      m.diffuseColor = new Color3(0.55, 0.52, 0.48);
      return m;
    })();

  // ── Platform body ──
  const platform = MeshBuilder.CreateBox(
    "spawnPlatform",
    { width: platformW, height: platformH, depth: platformD },
    scene,
  );
  platform.position = new Vector3(platformX, platformY, platformZ);
  platform.material = platformMat;
  platform.checkCollisions = true;

  // ── Support pillar beneath platform ──
  const pillar = MeshBuilder.CreateBox(
    "spawnPillar",
    { width: platformW - 1, height: platformY, depth: platformD - 1 },
    scene,
  );
  pillar.position = new Vector3(platformX, platformY / 2, platformZ);
  pillar.material = platformMat;
  pillar.checkCollisions = true;

  // ── Railings (4 sides) ──
  const railMat = platformMat.clone("spawnRailMat");
  railMat.alpha = 0.8;

  // Front railing (negative Z side)
  const railFront = MeshBuilder.CreateBox(
    "spawnRailFront",
    { width: platformW, height: railHeight, depth: railThickness },
    scene,
  );
  railFront.position = new Vector3(
    platformX,
    platformY + railHeight / 2 + platformH / 2,
    platformZ - platformD / 2,
  );
  railFront.material = railMat;
  railFront.checkCollisions = true;

  // Back railing (positive Z side) -- gap for stairs
  // Skip: stairs go here

  // Left railing
  const railLeft = MeshBuilder.CreateBox(
    "spawnRailLeft",
    { width: railThickness, height: railHeight, depth: platformD },
    scene,
  );
  railLeft.position = new Vector3(
    platformX - platformW / 2,
    platformY + railHeight / 2 + platformH / 2,
    platformZ,
  );
  railLeft.material = railMat;
  railLeft.checkCollisions = true;

  // Right railing
  const railRight = MeshBuilder.CreateBox(
    "spawnRailRight",
    { width: railThickness, height: railHeight, depth: platformD },
    scene,
  );
  railRight.position = new Vector3(
    platformX + platformW / 2,
    platformY + railHeight / 2 + platformH / 2,
    platformZ,
  );
  railRight.material = railMat;
  railRight.checkCollisions = true;

  // ── Steps (4 steps descending to ground on the +Z side) ──
  // Step dimensions: 2 wide, 0.3 tall, 1 deep
  // Steps go from y=4 down to y=0 on the +Z face
  const stepCount = 4;
  const stepHeight = platformY / stepCount;  // 1.0 per step
  const stepWidth = 3;
  const stepDepth = 1.2;

  for (let i = 0; i < stepCount; i++) {
    const stepY = platformY - (i + 1) * stepHeight + stepHeight / 2;
    const stepZ = platformZ + platformD / 2 + stepDepth * (i + 0.5);

    const step = MeshBuilder.CreateBox(
      `spawnStep_${i}`,
      { width: stepWidth, height: stepHeight, depth: stepDepth },
      scene,
    );
    step.position = new Vector3(platformX, stepY, stepZ);
    step.material = platformMat;
    step.checkCollisions = true;
  }
}
```

### Camera Spawn Setup

**Modify the camera positioning block at the end of `generateWorld()`:**

```typescript
// Current code (line ~163-165):
// camera.position = new Vector3(sp.x, sp.y + 2, sp.z);
// camera.rotation.x = 0.1;

// Replace with:
camera.position = new Vector3(50, 6, 50);  // On the spawn platform

// Look toward the first learning path concept (Cell Biology district)
const firstConceptId = config.learning_path[0];
const firstSpace = config.spaces.find(
  (s) => s.concept_id === firstConceptId,
);
if (firstSpace) {
  const targetX = firstSpace.position.x + firstSpace.size.width / 2;
  const targetZ = firstSpace.position.z + firstSpace.size.depth / 2;
  camera.rotation.y = Math.atan2(
    targetX - camera.position.x,
    targetZ - camera.position.z,
  );
}
camera.rotation.x = 0.15;  // Slight downward tilt to see the palace below

// Update ground level for gravity system
gameEngine.setGroundLevel(4.15);
// Note: once player descends stairs to ground, ground level will need
// to be adjusted. A future enhancement could use raycasting for ground detection.
```

### Updated `generateWorld()` Step Sequence

```typescript
export async function generateWorld(
  gameEngine: GameEngine,
  config: PalaceConfig,
  materials: Map<string, StandardMaterial>,
): Promise<void> {
  const { scene, camera } = gameEngine;
  const conceptNames = buildConceptNameMap(config);

  // 1. Build ground plane
  buildGroundPlane(scene, config, materials);

  // 2. Build each space (rooms)
  for (const space of config.spaces) {
    const pathOpenings = collectPathOpenings(config, space.id);
    const conceptName = conceptNames.get(space.concept_id) || "";
    buildSpace(scene, space, materials, conceptName, pathOpenings);
  }

  // 3. Build paths between spaces (with road hierarchy)
  for (const path of config.paths) {
    buildPath(scene, path, materials);
  }

  // 4. Build zone transition archways
  buildZoneArchways(scene, config, materials);

  // 4b. Build landmark beacons at zone hubs     [MODULE 3]
  buildLandmarkBeacons(scene, config);

  // 5. Build pedestals and load artifacts        [MODULE 2]
  for (const artifact of config.artifacts) {
    buildPedestal(scene, artifact, materials);
    await loadArtifact(scene, artifact, config);  // config param added
  }

  // 6. Build golden breadcrumb trail             [MODULE 5]
  buildGoldenPath(scene, config);

  // 7. Build spawn vista platform                [MODULE 6]
  buildSpawnVista(scene, config, materials);

  // 8. Set camera position on spawn platform
  camera.position = new Vector3(50, 6, 50);
  const firstConceptId = config.learning_path[0];
  const firstSpace = config.spaces.find(
    (s) => s.concept_id === firstConceptId,
  );
  if (firstSpace) {
    const targetX = firstSpace.position.x + firstSpace.size.width / 2;
    const targetZ = firstSpace.position.z + firstSpace.size.depth / 2;
    camera.rotation.y = Math.atan2(
      targetX - camera.position.x,
      targetZ - camera.position.z,
    );
  }
  camera.rotation.x = 0.15;
  gameEngine.setGroundLevel(4.15);
}
```

---

## Implementation Phases

### Phase 1 (parallel -- no inter-dependencies)

These 4 modules can be implemented simultaneously by separate agents:

| Module | Work Item | Files | New/Edit |
|--------|-----------|-------|----------|
| Module 2 | Artifact shape system | `src/web/artifacts/shapes.ts` | New file |
| Module 2 | Wire into loader | `src/web/artifacts/loader.ts` | Edit |
| Module 3 | Landmark beacons | `src/web/world/zones.ts` | Edit (add function) |
| Module 5 | Golden path breadcrumbs | `src/web/world/breadcrumbs.ts` | New file |
| Module 6 | Spawn vista platform | `src/web/world/generator.ts` | Edit (add function) |

Each module is self-contained: shapes.ts creates its own materials; beacons create their own materials; breadcrumbs create their own materials; the vista platform uses existing theme materials.

### Phase 2 (depends on Phase 1 completion + seed data)

| Module | Work Item | Files | Dependency |
|--------|-----------|-------|------------|
| Module 1 | Grid layout algorithm | `src/functions/generate-palace/layout.ts` | None, but seed data regeneration depends on this |
| Module 1 | Regenerate seed data | `public/seed-palace.json` | Depends on layout.ts changes |
| Module 4 | Road hierarchy visuals | `src/web/world/paths.ts` | Depends on Module 1 for new path widths in seed data |
| All | Update generator.ts imports | `src/web/world/generator.ts` | Depends on all new files existing |

### Phase 3 (integration and test)

1. Run `deno task check` / `tsc --noEmit` to verify type correctness.
2. Load seed palace in browser, verify:
   - Districts are in 2x2 grid arrangement
   - Central plaza is empty at (30-70, 0, 30-70)
   - Beacons are visible from spawn platform
   - Boulevard lanterns are lit
   - Golden discs trail along the learning path
   - Artifact shapes match categories
   - Spawn platform has stairs and railings
3. Screenshot from spawn vista for visual review.

---

## Seed Data Reference

### Complete Position Table (Post-Module-1)

| concept_id | zone | center (cx, cz) | position (x, y, z) | size (w, h, d) |
|-----------|------|-----------------|--------------------|----|
| cell_structure | Cell Biology | (20, 20) | (12, 0, 12) | 16x6x16 |
| mitochondria | Cell Biology | (5, 5) | (-1, 0, -1) | 12x6x12 |
| cell_membrane | Cell Biology | (5, 35) | (-1, 0, 29) | 12x6x12 |
| photosynthesis | Cell Biology | (40, 10) | (34, 0, 4) | 12x6x12 |
| dna | Genetics | (120, 20) | (112, 0, 12) | 16x6x16 |
| mutations | Genetics | (100, 40) | (96, 0, 36) | 8x6x8 |
| proteins | Biochemistry | (20, 120) | (14, 0, 114) | 12x6x12 |
| enzymes | Biochemistry | (5, 105) | (-1, 0, 99) | 12x6x12 |
| evolution | Evolution | (120, 120) | (112, 0, 112) | 16x6x16 |
| natural_selection | Evolution | (100, 105) | (94, 0, 99) | 12x6x12 |

### Spawn Point

```json
{ "x": 50, "y": 4, "z": 50 }
```

Camera position: `(50, 6, 50)`, looking toward Cell Biology district (first in learning path).

### Zone Colors (unchanged)

| Zone | Color |
|------|-------|
| Cell Biology | #4CAF50 |
| Genetics | #2196F3 |
| Biochemistry | #FF9800 |
| Evolution | #9C27B0 |
