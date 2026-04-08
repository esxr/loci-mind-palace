# Executable Implementation Specification: Renderer Rewrite & Environmental Detail System

**Version:** 1.0
**Date:** 2026-04-08
**Scope:** Replace noa-engine remnants with pure Babylon.js, add archetype-driven room construction, environmental props system, zone transition archways, and polished artifact fallbacks.

**Status of current code:** The codebase has *already* been partially migrated to Babylon.js. `engine/setup.ts` exports a `GameEngine` interface with Babylon.js `Engine`, `Scene`, `FreeCamera`. The NPC renderer (`npcs/renderer.ts`) is already rewritten to smooth cylinder+sphere meshes. The theme applicator already returns `Map<string, StandardMaterial>`. This EIS specifies the remaining work: archetype-aware room construction, the props system, zone transitions, path enhancements, artifact polish, and wiring updates.

---

## Table of Contents

1. [Module 1: Engine Setup](#module-1-engine-setup)
2. [Module 2: Theme Applicator](#module-2-theme-applicator)
3. [Module 3: World Generator](#module-3-world-generator)
4. [Module 4: Space Builder](#module-4-space-builder)
5. [Module 5: Path Builder](#module-5-path-builder)
6. [Module 6: Props System (NEW)](#module-6-props-system)
7. [Module 7: Zone Transitions](#module-7-zone-transitions)
8. [Module 8: NPC Manager Updates](#module-8-npc-manager-updates)
9. [Module 9: Artifacts](#module-9-artifacts)
10. [Module 10: Main.ts Updates](#module-10-maints-updates)
11. [Appendix A: Shared Type Additions](#appendix-a-shared-type-additions)
12. [Appendix B: Seed Data Schema Update](#appendix-b-seed-data-schema-update)

---

## Module 1: Engine Setup

**File:** `src/web/engine/setup.ts`
**Status:** Already rewritten. No changes required.
**Owner agent:** N/A (done)

The current implementation is already pure Babylon.js. This section documents the existing contract so other module agents can depend on it.

### Interface

```typescript
import {
  Engine,
  Scene,
  FreeCamera,
  Vector3,
  HemisphericLight,
  Color3,
  Color4,
} from "@babylonjs/core";

export interface GameEngine {
  engine: Engine;
  scene: Scene;
  camera: FreeCamera;
  canvas: HTMLCanvasElement;
}

export function createEngine(container: HTMLElement): GameEngine;
```

### Existing Behavior (Do Not Change)

| Setting | Value |
|---|---|
| `Engine` constructor | `new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: true })` |
| `scene.clearColor` | `new Color4(0.05, 0.05, 0.08, 1.0)` (overridden by theme) |
| Camera type | `FreeCamera("camera", new Vector3(0, 3, 0), scene)` |
| `camera.speed` | `0.5` |
| `camera.angularSensibility` | `3000` |
| `camera.minZ` | `0.1` |
| `camera.inertia` | `0.85` |
| WASD keys | `keysUp=[87], keysDown=[83], keysLeft=[65], keysRight=[68]` |
| Gravity | `scene.gravity = new Vector3(0, -0.5, 0)` |
| `camera.applyGravity` | `true` |
| `camera.checkCollisions` | `true` |
| `camera.ellipsoid` | `new Vector3(0.3, 0.9, 0.3)` |
| `scene.collisionsEnabled` | `true` |
| Default light | `HemisphericLight("defaultLight", Vector3(0,1,0), scene)` intensity 0.4 |
| Render loop | `engine.runRenderLoop(() => scene.render())` |
| Resize | `window.addEventListener("resize", () => engine.resize())` |
| Pointer lock | `canvas.addEventListener("click", () => canvas.requestPointerLock())` |

---

## Module 2: Theme Applicator

**File:** `src/web/themes/applicator.ts`
**Status:** Already rewritten. No changes required.
**Owner agent:** N/A (done)

### Interface

```typescript
export function applyTheme(
  scene: Scene,
  theme: ThemeConfig
): Map<string, StandardMaterial>;
```

### Existing Behavior (Do Not Change)

1. **Material creation:** Iterates all `BlockType` entries across `theme.palette.ground`, `walls`, `paths`, `accent`, `pedestal`. For each unique `block.id`, creates:
   ```typescript
   const mat = new StandardMaterial(`mat_${block.id}`, scene);
   mat.diffuseColor = new Color3(r / 255, g / 255, b / 255);
   mat.specularColor = new Color3(0.1, 0.1, 0.1);
   mat.specularPower = 32;
   ```
   Stores in `Map<string, StandardMaterial>`.

2. **Default light removal:** Disposes `scene.getLightByName("defaultLight")`.

3. **Ambient light:** `HemisphericLight("ambient", Vector3(0,1,0), scene)` with `diffuse` and `intensity` from `theme.lighting.ambient`. `groundColor = ambient.color.scale(0.4)`.

4. **Directional light:** `DirectionalLight("directional", Vector3(dx, dy, dz), scene)` from `theme.lighting.directional`.

5. **Fog:** `scene.fogMode = Scene.FOGMODE_LINEAR`, `scene.fogColor = hexToColor3(theme.fog.color)`, `scene.fogStart = theme.fog.near`, `scene.fogEnd = theme.fog.far`.

6. **Skybox:** `scene.clearColor = hexToColor4(theme.skybox.top_color, 1.0)`.

7. **Glow layer:** `new GlowLayer("glow", scene)` with `intensity = 0.4`.

8. **Particles:** For each `theme.particles[i]`, creates a `ParticleSystem` with type-specific settings (fireflies, rain, snow, stars, dust, embers, bubbles). Emitter range: `(-50, 10, -50)` to `(50, 20, 50)`.

### Helper Functions Available to Other Modules

These are internal but the following conversion pattern is used throughout the codebase:
```typescript
// Hex -> Color3
function hexToColor3(hex: string): Color3;
// Hex -> Color4
function hexToColor4(hex: string, alpha?: number): Color4;
```

---

## Module 3: World Generator

**File:** `src/web/world/generator.ts`
**Status:** Requires modification. Add calls to `decorateSpace()` and `buildZoneArchways()`.
**Owner agent:** Agent-WorldGen

### Interface (Updated)

```typescript
import type { PalaceConfig } from "../../shared/types";
import type { GameEngine } from "../engine/setup";
import { StandardMaterial } from "@babylonjs/core";

export async function generateWorld(
  gameEngine: GameEngine,
  config: PalaceConfig,
  materials: Map<string, StandardMaterial>
): Promise<void>;
```

### Full Implementation Sequence

```typescript
export async function generateWorld(
  gameEngine: GameEngine,
  config: PalaceConfig,
  materials: Map<string, StandardMaterial>
): Promise<void> {
  const { scene, camera } = gameEngine;
  const conceptNames = buildConceptNameMap(config);

  // 1. Ground plane
  buildGroundPlane(scene, config, materials);

  // 2. Build each space (rooms with floors, walls, ceilings, labels)
  for (const space of config.spaces) {
    const pathOpenings = collectPathOpenings(config, space.id);
    const conceptName = conceptNames.get(space.concept_id) || "";
    buildSpace(scene, space, materials, conceptName, pathOpenings);
  }

  // 3. Build paths between spaces
  for (const path of config.paths) {
    buildPath(scene, path, materials);
  }

  // 4. NEW: Decorate each space with archetype-specific props
  for (const space of config.spaces) {
    decorateSpace(scene, space, materials);
  }

  // 5. NEW: Build zone transition archways
  buildZoneArchways(scene, config, materials);

  // 6. Build pedestals and load artifacts
  for (const artifact of config.artifacts) {
    buildPedestal(scene, artifact, materials);
    await loadArtifact(scene, artifact);
  }

  // 7. Set camera position at spawn point
  const sp = config.spawn_point;
  camera.position = new Vector3(sp.x, sp.y + 2, sp.z);
  camera.rotation.x = 0.1; // Slightly looking down
}
```

### New Imports Required

```typescript
import { decorateSpace } from "./props";
import { buildZoneArchways } from "./zones";
```

### `buildGroundPlane` (No Change)

Already computes bounding box over all spaces, adds 20-unit margin, creates `MeshBuilder.CreateGround` with minimum 300x300 dimensions, applies first `theme.palette.ground` material, enables `checkCollisions`.

### `collectPathOpenings` (No Change)

Returns first and last waypoints of all paths connected to a given space ID.

### `buildConceptNameMap` (No Change)

Maps `concept.id` -> `concept.name` from `config.concept_graph.concepts`.

---

## Module 4: Space Builder

**File:** `src/web/world/spaces.ts`
**Status:** Requires modification. Add archetype-specific room variations.
**Owner agent:** Agent-SpaceBuilder

### Interface (Updated)

```typescript
export function buildSpace(
  scene: Scene,
  space: Space,
  materials: Map<string, StandardMaterial>,
  conceptName?: string,
  pathOpenings?: Array<{ x: number; y: number; z: number }>
): void;
```

The function signature is unchanged. The changes are internal to how rooms are constructed based on `space.archetype`.

### Archetype-Specific Construction Rules

The current implementation builds floors, walls, optional ceilings, and labels for all rooms identically. The rewrite adds archetype-driven variations **after** the base construction.

#### Base Construction (Existing, Unchanged)

For all archetypes, the current code already handles:
- **Floor:** `CreateBox` (rectangular) or `CreateDisc` (circular) with `checkCollisions = true`
- **Walls:** Rectangular wall segments with doorway gaps, or circular wall ring segments
- **Ceiling:** Optional `CreateBox` if `has_ceiling && ceiling_block`
- **Label:** Floating `DynamicTexture` plane with `billboardMode = BILLBOARDMODE_ALL`

#### New Archetype Modifiers

Add the following function, called at the end of `buildSpace`, after the label is created:

```typescript
function applyArchetypeModifiers(
  scene: Scene,
  space: Space,
  materials: Map<string, StandardMaterial>
): void {
  const { position, size, archetype } = space;
  const { width, height, depth } = size;
  const centerX = position.x + width / 2;
  const centerZ = position.z + depth / 2;
  const baseY = position.y;

  switch (archetype) {
    case "laboratory":
      // No geometric changes. Bright ambient feel handled by props (beakers, tables).
      // Add a subtle emissive tint to wall material if it exists.
      applyWallTint(scene, space, new Color3(0.8, 0.85, 0.9)); // Cool metallic
      break;

    case "library":
      // Tall ceiling: add additional wall height extensions
      addWallExtensions(scene, space, materials, height * 0.5);
      // Warm tint
      applyWallTint(scene, space, new Color3(0.9, 0.8, 0.6)); // Warm parchment
      break;

    case "garden":
      // No walls needed for organic feel - walls were already built by base,
      // but we could make them partially transparent. Instead, rely on
      // circular shape (already handled by shape="circular"|"organic").
      // Add green emissive tint.
      applyWallTint(scene, space, new Color3(0.5, 0.8, 0.4)); // Green
      break;

    case "amphitheater":
      // Add tiered floor: 3 concentric rings stepping down
      addTieredFloor(scene, space, materials);
      break;

    case "observatory":
      // Add dome ceiling (hemisphere)
      addDomeCeiling(scene, space, materials);
      break;

    case "workshop":
      // Standard rectangular with warm lighting. No geometric changes.
      applyWallTint(scene, space, new Color3(0.85, 0.75, 0.6)); // Warm wood
      break;

    case "gallery":
      // Add accent spotlights along the longer axis
      addGallerySpotlights(scene, space);
      break;

    case "chamber":
      // Darker ambient. No geometric changes.
      applyWallTint(scene, space, new Color3(0.4, 0.35, 0.5)); // Dark purple
      break;
  }
}
```

#### `applyWallTint`

```typescript
import { Color3 } from "@babylonjs/core";

/**
 * Finds all wall meshes belonging to this space and applies an emissive tint.
 * Wall meshes are identified by name pattern: wall_*_{spaceId}* or wallseg_*_{spaceId}*
 */
function applyWallTint(scene: Scene, space: Space, tint: Color3): void {
  const meshes = scene.meshes.filter(
    (m) =>
      m.name.includes(space.id) &&
      (m.name.startsWith("wall_") || m.name.startsWith("wallseg_"))
  );
  for (const mesh of meshes) {
    if (mesh.material instanceof StandardMaterial) {
      // Clone material to avoid affecting other spaces sharing the same block type
      const cloned = mesh.material.clone(`${mesh.material.name}_tinted_${space.id}`);
      if (cloned instanceof StandardMaterial) {
        cloned.emissiveColor = tint.scale(0.08);
        mesh.material = cloned;
      }
    }
  }
}
```

#### `addWallExtensions` (Library)

```typescript
/**
 * For library archetype: extends wall height by adding additional wall boxes
 * on top of existing walls. Makes the room feel taller.
 *
 * @param extraHeight Additional height in world units (typically height * 0.5 = 3)
 */
function addWallExtensions(
  scene: Scene,
  space: Space,
  materials: Map<string, StandardMaterial>,
  extraHeight: number
): void {
  const wallMat = materials.get(space.wall_block);
  if (!wallMat) return;

  const { position, size } = space;
  const { width, height, depth } = size;
  const baseY = position.y + height; // Start at top of existing walls
  const centerX = position.x + width / 2;
  const centerZ = position.z + depth / 2;
  const wallThickness = 0.3;

  // Back wall extension
  const backExt = MeshBuilder.CreateBox(
    `wallExt_back_${space.id}`,
    { width, height: extraHeight, depth: wallThickness },
    scene
  );
  backExt.position = new Vector3(centerX, baseY + extraHeight / 2, position.z);
  backExt.material = wallMat;
  backExt.checkCollisions = true;

  // Front wall extension
  const frontExt = MeshBuilder.CreateBox(
    `wallExt_front_${space.id}`,
    { width, height: extraHeight, depth: wallThickness },
    scene
  );
  frontExt.position = new Vector3(centerX, baseY + extraHeight / 2, position.z + depth);
  frontExt.material = wallMat;
  frontExt.checkCollisions = true;

  // Left wall extension
  const leftExt = MeshBuilder.CreateBox(
    `wallExt_left_${space.id}`,
    { width: wallThickness, height: extraHeight, depth },
    scene
  );
  leftExt.position = new Vector3(position.x, baseY + extraHeight / 2, centerZ);
  leftExt.material = wallMat;
  leftExt.checkCollisions = true;

  // Right wall extension
  const rightExt = MeshBuilder.CreateBox(
    `wallExt_right_${space.id}`,
    { width: wallThickness, height: extraHeight, depth },
    scene
  );
  rightExt.position = new Vector3(position.x + width, baseY + extraHeight / 2, centerZ);
  rightExt.material = wallMat;
  rightExt.checkCollisions = true;
}
```

#### `addTieredFloor` (Amphitheater)

```typescript
/**
 * Creates 3 concentric rings that step upward, creating amphitheater seating tiers.
 * Each tier is 0.4 units tall, inset by 2 units from the previous.
 */
function addTieredFloor(
  scene: Scene,
  space: Space,
  materials: Map<string, StandardMaterial>
): void {
  const floorMat = materials.get(space.floor_block);
  if (!floorMat) return;

  const { position, size } = space;
  const centerX = position.x + size.width / 2;
  const centerZ = position.z + size.depth / 2;
  const baseY = position.y;

  for (let tier = 1; tier <= 3; tier++) {
    const inset = tier * 2;
    const tierWidth = Math.max(size.width - inset * 2, 2);
    const tierDepth = Math.max(size.depth - inset * 2, 2);
    const tierHeight = 0.4;
    const tierY = baseY + tier * tierHeight;

    const tierMesh = MeshBuilder.CreateBox(
      `tier_${space.id}_${tier}`,
      { width: tierWidth, height: tierHeight, depth: tierDepth },
      scene
    );
    tierMesh.position = new Vector3(centerX, tierY, centerZ);
    // Clone floor material with slightly darker shade for visual distinction
    const tierMat = floorMat.clone(`tierMat_${space.id}_${tier}`);
    if (tierMat instanceof StandardMaterial) {
      tierMat.diffuseColor = floorMat.diffuseColor.scale(1 - tier * 0.08);
    }
    tierMesh.material = tierMat;
    tierMesh.checkCollisions = true;
  }
}
```

#### `addDomeCeiling` (Observatory)

```typescript
import { MeshBuilder, Mesh } from "@babylonjs/core";

/**
 * Creates a hemisphere mesh as a dome ceiling for observatory rooms.
 * The dome is a sphere cut in half (using CreateSphere with slice parameters).
 */
function addDomeCeiling(
  scene: Scene,
  space: Space,
  materials: Map<string, StandardMaterial>
): void {
  const wallMat = materials.get(space.wall_block);
  if (!wallMat) return;

  const { position, size } = space;
  const centerX = position.x + size.width / 2;
  const centerZ = position.z + size.depth / 2;
  const radius = Math.min(size.width, size.depth) / 2;
  const domeY = position.y + size.height;

  const dome = MeshBuilder.CreateSphere(
    `dome_${space.id}`,
    {
      diameter: radius * 2,
      segments: 24,
      slice: 0.5, // Only top hemisphere
    },
    scene
  );
  dome.position = new Vector3(centerX, domeY, centerZ);

  // Semi-transparent dome material
  const domeMat = wallMat.clone(`domeMat_${space.id}`);
  if (domeMat instanceof StandardMaterial) {
    domeMat.alpha = 0.3;
    domeMat.emissiveColor = new Color3(0.05, 0.05, 0.15); // Subtle night-sky glow
    domeMat.backFaceCulling = false;
  }
  dome.material = domeMat;
}
```

#### `addGallerySpotlights` (Gallery)

```typescript
import { SpotLight } from "@babylonjs/core";

/**
 * Adds 4 downward-facing spotlights evenly spaced along the longer axis
 * of the gallery room, creating pools of light for display cases.
 */
function addGallerySpotlights(scene: Scene, space: Space): void {
  const { position, size } = space;
  const centerZ = position.z + size.depth / 2;
  const spotY = position.y + size.height - 0.5;
  const spotCount = 4;

  for (let i = 0; i < spotCount; i++) {
    const t = (i + 0.5) / spotCount;
    const spotX = position.x + size.width * t;

    const spot = new SpotLight(
      `gallerySpot_${space.id}_${i}`,
      new Vector3(spotX, spotY, centerZ),
      new Vector3(0, -1, 0), // Pointing straight down
      Math.PI / 4,           // 45-degree cone angle
      2,                     // Exponent (falloff sharpness)
      scene
    );
    spot.intensity = 0.6;
    spot.diffuse = new Color3(1.0, 0.95, 0.85); // Warm white
    spot.range = size.height + 2;
  }
}
```

### Where to Insert the Call

At the end of the existing `buildSpace` function body, after the label creation block, add:

```typescript
  // ── Archetype-specific modifiers ──
  if (space.archetype) {
    applyArchetypeModifiers(scene, space, materials);
  }
```

### New Imports Required in `spaces.ts`

```typescript
import { SpotLight, Color3 } from "@babylonjs/core";
// Color3 is already imported. SpotLight is new.
```

---

## Module 5: Path Builder

**File:** `src/web/world/paths.ts`
**Status:** Requires modification. Add bridge railings and direction arrow markers.
**Owner agent:** Agent-PathBuilder

### Interface (Unchanged)

```typescript
export function buildPath(
  scene: Scene,
  path: Path,
  materials: Map<string, StandardMaterial>
): void;
```

### Changes Required

#### 1. Bridge Style: Elevated Floor + Railings

Currently, `style === "bridge"` has no special treatment (no walls, no ceiling -- same as trail). Add bridge-specific construction after the floor strip creation.

Insert this block inside the per-segment loop, after the floor strip creation, when `style === "bridge"`:

```typescript
    // ── Bridge railings ──
    if (style === "bridge") {
      // Elevate the floor strip slightly
      floor.position.y = midY + 1.5; // Raise bridge 1.5 units above ground

      const railHeight = 1.0;
      const railDiameter = 0.08;
      const halfWidth = width / 2 + 0.1;
      const postSpacing = 2.0;
      const numPosts = Math.max(2, Math.floor(segLen / postSpacing));

      for (const side of [-1, 1]) {
        // Horizontal rail bar
        const rail = MeshBuilder.CreateCylinder(
          `bridgeRail_${path.id}_${i}_${side > 0 ? "R" : "L"}`,
          { height: segLen + 0.5, diameter: railDiameter, tessellation: 8 },
          scene
        );
        rail.rotation.x = Math.PI / 2; // Lay cylinder on its side
        rail.rotation.y = angle;
        const railOffsetX = perpX * halfWidth * side;
        const railOffsetZ = perpZ * halfWidth * side;
        rail.position = new Vector3(
          midX + railOffsetX,
          midY + 1.5 + railHeight,
          midZ + railOffsetZ
        );
        if (floorMat) rail.material = floorMat;

        // Vertical posts
        for (let p = 0; p < numPosts; p++) {
          const t = (p + 0.5) / numPosts;
          const postX = wpA.x + segDx * t + perpX * halfWidth * side;
          const postY = wpA.y + segDy * t + 1.5;
          const postZ = wpA.z + segDz * t + perpZ * halfWidth * side;

          const post = MeshBuilder.CreateCylinder(
            `bridgePost_${path.id}_${i}_${side > 0 ? "R" : "L"}_${p}`,
            { height: railHeight, diameter: railDiameter, tessellation: 8 },
            scene
          );
          post.position = new Vector3(postX, postY + railHeight / 2, postZ);
          if (floorMat) post.material = floorMat;
          post.checkCollisions = true;
        }
      }
    }
```

#### 2. Direction Arrow Markers for `direction === "forward"` Paths

After the per-segment loop completes, add arrow markers for forward-direction paths. Insert this block at the end of `buildPath`, after the segment loop:

```typescript
  // ── Direction arrows for prerequisite/forward paths ──
  if (path.direction === "forward" && waypoints.length >= 2) {
    const arrowSpacing = 6; // One arrow every 6 units
    const totalLength = computePathLength(waypoints);
    const numArrows = Math.max(1, Math.floor(totalLength / arrowSpacing));

    for (let a = 0; a < numArrows; a++) {
      const t = (a + 0.5) / numArrows;
      const { point, angle: arrowAngle } = interpolateAlongPath(waypoints, t);

      const arrowPlane = MeshBuilder.CreatePlane(
        `arrow_${path.id}_${a}`,
        { width: 1.2, height: 1.2 },
        scene
      );
      arrowPlane.position = new Vector3(point.x, point.y + 0.15, point.z);
      arrowPlane.rotation.x = Math.PI / 2; // Lay flat on ground
      arrowPlane.rotation.y = arrowAngle;

      // Create arrow texture via DynamicTexture
      const arrowMat = createArrowMaterial(scene, path.id, a);
      arrowPlane.material = arrowMat;
    }
  }
```

#### New Helper Functions

```typescript
/**
 * Computes total arc length of a waypoint sequence.
 */
function computePathLength(waypoints: WorldPosition[]): number {
  let total = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const dx = waypoints[i + 1].x - waypoints[i].x;
    const dy = waypoints[i + 1].y - waypoints[i].y;
    const dz = waypoints[i + 1].z - waypoints[i].z;
    total += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return total;
}

/**
 * Interpolates a position and forward angle at parameter t (0..1)
 * along the full multi-segment path.
 */
function interpolateAlongPath(
  waypoints: WorldPosition[],
  t: number
): { point: WorldPosition; angle: number } {
  const totalLen = computePathLength(waypoints);
  const targetDist = t * totalLen;

  let accumulated = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const segLen = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (accumulated + segLen >= targetDist) {
      const localT = (targetDist - accumulated) / segLen;
      return {
        point: {
          x: a.x + dx * localT,
          y: a.y + dy * localT,
          z: a.z + dz * localT,
        },
        angle: Math.atan2(dx, dz),
      };
    }
    accumulated += segLen;
  }

  // Fallback: return last point
  const last = waypoints[waypoints.length - 1];
  const prev = waypoints[waypoints.length - 2];
  return {
    point: last,
    angle: Math.atan2(last.x - prev.x, last.z - prev.z),
  };
}

/**
 * Creates a StandardMaterial with a DynamicTexture containing a forward arrow (chevron).
 * The arrow is drawn as a simple ">" shape pointing upward on the texture.
 */
function createArrowMaterial(
  scene: Scene,
  pathId: string,
  index: number
): StandardMaterial {
  const texSize = 128;
  const dt = new DynamicTexture(
    `arrowTex_${pathId}_${index}`,
    texSize,
    scene,
    false
  );
  dt.hasAlpha = true;

  const ctx = dt.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, texSize, texSize);

  // Draw arrow chevron
  ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  // Chevron pointing "up" in texture space (which becomes forward when rotated)
  ctx.moveTo(30, 90);
  ctx.lineTo(64, 38);
  ctx.lineTo(98, 90);
  ctx.stroke();

  dt.update();

  const mat = new StandardMaterial(`arrowMat_${pathId}_${index}`, scene);
  mat.diffuseTexture = dt;
  mat.emissiveColor = new Color3(1, 1, 1);
  mat.disableLighting = true;
  mat.useAlphaFromDiffuseTexture = true;
  mat.backFaceCulling = false;
  mat.zOffset = -1; // Render slightly above the floor to prevent z-fighting
  return mat;
}
```

### New Imports Required in `paths.ts`

```typescript
import { DynamicTexture, Color3 } from "@babylonjs/core";
// StandardMaterial, MeshBuilder, Vector3, Scene, Mesh already imported
```

---

## Module 6: Props System

**File:** `src/web/world/props.ts` -- **NEW FILE**
**Owner agent:** Agent-Props

### Purpose

Populates each space with archetype-appropriate environmental details (furniture, equipment, decorative objects) to make rooms visually distinct and memorable. All props are constructed from Babylon.js primitives -- no external assets required.

### Main Interface

```typescript
import { Scene, StandardMaterial } from "@babylonjs/core";
import type { Space } from "../../shared/types";

/**
 * Places archetype-specific prop meshes inside a space.
 * All props use Babylon.js primitives (boxes, cylinders, spheres, tori, planes).
 * Returns the array of created meshes for potential cleanup.
 */
export function decorateSpace(
  scene: Scene,
  space: Space,
  materials: Map<string, StandardMaterial>
): Mesh[];
```

### Imports

```typescript
import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  Mesh,
  PointLight,
  DynamicTexture,
} from "@babylonjs/core";
import type { Space, WorldPosition } from "../../shared/types";
```

### Position Calculation Utilities

```typescript
interface PropPosition {
  x: number;
  y: number;
  z: number;
}

/**
 * Computes key placement positions within a room.
 */
function getRoomPositions(space: Space): {
  center: PropPosition;
  corners: PropPosition[];
  wallMidpoints: PropPosition[];
} {
  const { position, size } = space;
  const inset = 1.5; // Distance inset from walls

  const center: PropPosition = {
    x: position.x + size.width / 2,
    y: position.y + 0.15, // Slightly above floor
    z: position.z + size.depth / 2,
  };

  const corners: PropPosition[] = [
    { x: position.x + inset, y: position.y + 0.15, z: position.z + inset },
    { x: position.x + size.width - inset, y: position.y + 0.15, z: position.z + inset },
    { x: position.x + inset, y: position.y + 0.15, z: position.z + size.depth - inset },
    { x: position.x + size.width - inset, y: position.y + 0.15, z: position.z + size.depth - inset },
  ];

  const wallMidpoints: PropPosition[] = [
    // Left wall midpoint
    { x: position.x + inset, y: position.y + 0.15, z: position.z + size.depth / 2 },
    // Right wall midpoint
    { x: position.x + size.width - inset, y: position.y + 0.15, z: position.z + size.depth / 2 },
    // Back wall midpoint
    { x: position.x + size.width / 2, y: position.y + 0.15, z: position.z + inset },
    // Front wall midpoint
    { x: position.x + size.width / 2, y: position.y + 0.15, z: position.z + size.depth - inset },
  ];

  return { center, corners, wallMidpoints };
}

/**
 * Generates scattered positions within the room for organic placement.
 * Uses deterministic pseudo-random based on space id hash.
 */
function getScatteredPositions(space: Space, count: number): PropPosition[] {
  const { position, size } = space;
  const inset = 2.0;
  let hash = 0;
  for (let i = 0; i < space.id.length; i++) {
    hash = ((hash << 5) - hash + space.id.charCodeAt(i)) | 0;
  }
  // Mulberry32 PRNG
  let s = Math.abs(hash);
  const rand = (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const positions: PropPosition[] = [];
  for (let i = 0; i < count; i++) {
    positions.push({
      x: position.x + inset + rand() * (size.width - inset * 2),
      y: position.y + 0.15,
      z: position.z + inset + rand() * (size.depth - inset * 2),
    });
  }
  return positions;
}
```

### Prop Generator Functions

Each function creates a mesh (or parent mesh containing child primitives), positions it, and returns the root mesh.

#### `createTable`

```typescript
/**
 * A simple table: flat box top on 4 thin cylinder legs.
 * Dimensions: 2.0 wide x 0.8 tall x 1.0 deep.
 */
function createTable(scene: Scene, pos: PropPosition, id: string): Mesh {
  const parent = new Mesh(`table_${id}`, scene);

  const topWidth = 2.0;
  const topDepth = 1.0;
  const topThickness = 0.1;
  const legHeight = 0.7;
  const legDiameter = 0.08;

  // Table top
  const top = MeshBuilder.CreateBox(
    `tableTop_${id}`,
    { width: topWidth, height: topThickness, depth: topDepth },
    scene
  );
  top.position.y = legHeight + topThickness / 2;
  top.parent = parent;

  const tableMat = new StandardMaterial(`tableMat_${id}`, scene);
  tableMat.diffuseColor = new Color3(0.45, 0.3, 0.15); // Wood brown
  tableMat.specularColor = new Color3(0.1, 0.1, 0.1);
  top.material = tableMat;

  // 4 Legs
  const legOffsets = [
    [-topWidth / 2 + 0.1, -topDepth / 2 + 0.1],
    [topWidth / 2 - 0.1, -topDepth / 2 + 0.1],
    [-topWidth / 2 + 0.1, topDepth / 2 - 0.1],
    [topWidth / 2 - 0.1, topDepth / 2 - 0.1],
  ];
  for (let i = 0; i < 4; i++) {
    const leg = MeshBuilder.CreateCylinder(
      `tableLeg_${id}_${i}`,
      { height: legHeight, diameter: legDiameter, tessellation: 8 },
      scene
    );
    leg.position = new Vector3(legOffsets[i][0], legHeight / 2, legOffsets[i][1]);
    leg.material = tableMat;
    leg.parent = parent;
  }

  parent.position = new Vector3(pos.x, pos.y, pos.z);
  return parent;
}
```

#### `createBeaker`

```typescript
/**
 * A laboratory beaker: thin cylinder body with a small sphere on top (liquid meniscus).
 * Dimensions: 0.15 diameter x 0.4 tall.
 */
function createBeaker(scene: Scene, pos: PropPosition, id: string): Mesh {
  const parent = new Mesh(`beaker_${id}`, scene);

  // Glass body
  const body = MeshBuilder.CreateCylinder(
    `beakerBody_${id}`,
    { height: 0.35, diameterTop: 0.18, diameterBottom: 0.14, tessellation: 12 },
    scene
  );
  body.position.y = 0.175;
  body.parent = parent;

  const glassMat = new StandardMaterial(`glassMat_${id}`, scene);
  glassMat.diffuseColor = new Color3(0.7, 0.85, 0.95);
  glassMat.alpha = 0.5;
  glassMat.specularColor = new Color3(0.5, 0.5, 0.5);
  glassMat.specularPower = 64;
  body.material = glassMat;

  // Liquid top
  const liquid = MeshBuilder.CreateSphere(
    `beakerLiquid_${id}`,
    { diameter: 0.14, segments: 8 },
    scene
  );
  liquid.position.y = 0.3;
  liquid.scaling.y = 0.3; // Flatten into disc
  liquid.parent = parent;

  const liquidMat = new StandardMaterial(`liquidMat_${id}`, scene);
  liquidMat.diffuseColor = new Color3(0.2, 0.8, 0.4); // Green liquid
  liquidMat.emissiveColor = new Color3(0.05, 0.2, 0.1);
  liquidMat.alpha = 0.7;
  liquid.material = liquidMat;

  parent.position = new Vector3(pos.x, pos.y, pos.z);
  return parent;
}
```

#### `createBookshelf`

```typescript
/**
 * A bookshelf: box frame with 3 shelves and colored box "books" on each shelf.
 * Dimensions: 2.0 wide x 2.5 tall x 0.5 deep.
 */
function createBookshelf(scene: Scene, pos: PropPosition, id: string): Mesh {
  const parent = new Mesh(`bookshelf_${id}`, scene);
  const shelfWidth = 2.0;
  const shelfHeight = 2.5;
  const shelfDepth = 0.5;

  const woodMat = new StandardMaterial(`shelfWood_${id}`, scene);
  woodMat.diffuseColor = new Color3(0.4, 0.25, 0.12);
  woodMat.specularColor = new Color3(0.05, 0.05, 0.05);

  // Back panel
  const back = MeshBuilder.CreateBox(
    `shelfBack_${id}`,
    { width: shelfWidth, height: shelfHeight, depth: 0.05 },
    scene
  );
  back.position = new Vector3(0, shelfHeight / 2, shelfDepth / 2 - 0.025);
  back.material = woodMat;
  back.parent = parent;

  // 4 horizontal shelves (bottom, 3 intermediate)
  for (let s = 0; s < 4; s++) {
    const shelf = MeshBuilder.CreateBox(
      `shelfPlank_${id}_${s}`,
      { width: shelfWidth, height: 0.06, depth: shelfDepth },
      scene
    );
    shelf.position = new Vector3(0, s * (shelfHeight / 3.5) + 0.03, 0);
    shelf.material = woodMat;
    shelf.parent = parent;
  }

  // Books on each of 3 shelves (skip bottom shelf as it's at floor level)
  const bookColors = [
    new Color3(0.7, 0.15, 0.1),  // Red
    new Color3(0.1, 0.3, 0.7),   // Blue
    new Color3(0.1, 0.6, 0.2),   // Green
    new Color3(0.6, 0.5, 0.1),   // Gold
    new Color3(0.5, 0.1, 0.5),   // Purple
  ];

  for (let s = 1; s < 4; s++) {
    const shelfY = s * (shelfHeight / 3.5) + 0.06;
    const numBooks = 4 + (s % 2); // 4 or 5 books per shelf
    for (let b = 0; b < numBooks; b++) {
      const bookWidth = 0.15 + Math.random() * 0.1;
      const bookHeight = 0.35 + Math.random() * 0.25;
      const book = MeshBuilder.CreateBox(
        `book_${id}_${s}_${b}`,
        { width: bookWidth, height: bookHeight, depth: shelfDepth * 0.85 },
        scene
      );
      book.position = new Vector3(
        -shelfWidth / 2 + 0.2 + b * 0.35,
        shelfY + bookHeight / 2,
        0
      );
      const bookMat = new StandardMaterial(`bookMat_${id}_${s}_${b}`, scene);
      bookMat.diffuseColor = bookColors[(s * 5 + b) % bookColors.length];
      bookMat.specularColor = new Color3(0.05, 0.05, 0.05);
      book.material = bookMat;
      book.parent = parent;
    }
  }

  parent.position = new Vector3(pos.x, pos.y, pos.z);
  parent.checkCollisions = true;
  return parent;
}
```

#### `createBench`

```typescript
/**
 * A simple bench: flat box seat on two box supports.
 * Dimensions: 1.5 wide x 0.5 tall x 0.5 deep.
 */
function createBench(scene: Scene, pos: PropPosition, id: string): Mesh {
  const parent = new Mesh(`bench_${id}`, scene);

  const benchMat = new StandardMaterial(`benchMat_${id}`, scene);
  benchMat.diffuseColor = new Color3(0.5, 0.35, 0.2);
  benchMat.specularColor = new Color3(0.05, 0.05, 0.05);

  // Seat
  const seat = MeshBuilder.CreateBox(
    `benchSeat_${id}`,
    { width: 1.5, height: 0.08, depth: 0.5 },
    scene
  );
  seat.position.y = 0.45;
  seat.material = benchMat;
  seat.parent = parent;

  // Two supports
  for (const offset of [-0.55, 0.55]) {
    const support = MeshBuilder.CreateBox(
      `benchSupport_${id}_${offset}`,
      { width: 0.12, height: 0.44, depth: 0.45 },
      scene
    );
    support.position = new Vector3(offset, 0.22, 0);
    support.material = benchMat;
    support.parent = parent;
  }

  parent.position = new Vector3(pos.x, pos.y, pos.z);
  parent.checkCollisions = true;
  return parent;
}
```

#### `createTorch`

```typescript
/**
 * A wall torch: cylinder handle + point light + simple fire particle emitter.
 * The PointLight provides actual scene illumination (range=8, intensity=0.5).
 */
function createTorch(scene: Scene, pos: PropPosition, id: string): Mesh {
  const parent = new Mesh(`torch_${id}`, scene);

  // Handle
  const handle = MeshBuilder.CreateCylinder(
    `torchHandle_${id}`,
    { height: 0.6, diameter: 0.1, tessellation: 8 },
    scene
  );
  handle.position.y = 1.8; // Mount at roughly eye level
  handle.parent = parent;

  const handleMat = new StandardMaterial(`torchHandleMat_${id}`, scene);
  handleMat.diffuseColor = new Color3(0.3, 0.2, 0.1);
  handle.material = handleMat;

  // Flame (emissive sphere)
  const flame = MeshBuilder.CreateSphere(
    `torchFlame_${id}`,
    { diameter: 0.2, segments: 8 },
    scene
  );
  flame.position.y = 2.15;
  flame.parent = parent;

  const flameMat = new StandardMaterial(`torchFlameMat_${id}`, scene);
  flameMat.diffuseColor = new Color3(1.0, 0.6, 0.1);
  flameMat.emissiveColor = new Color3(1.0, 0.5, 0.0);
  flameMat.disableLighting = true;
  flame.material = flameMat;

  // Point light
  const light = new PointLight(
    `torchLight_${id}`,
    new Vector3(pos.x, pos.y + 2.2, pos.z),
    scene
  );
  light.intensity = 0.5;
  light.range = 8;
  light.diffuse = new Color3(1.0, 0.8, 0.4);

  // Flicker animation
  const baseIntensity = 0.5;
  scene.registerBeforeRender(() => {
    if (!light.isDisposed()) {
      light.intensity = baseIntensity + Math.sin(Date.now() / 200) * 0.1
        + Math.sin(Date.now() / 130) * 0.05;
    }
  });

  parent.position = new Vector3(pos.x, pos.y, pos.z);
  return parent;
}
```

#### `createPodium`

```typescript
/**
 * A presentation podium: tapered cylinder.
 * Dimensions: 0.6 diameter bottom, 0.4 diameter top, 1.0 tall.
 */
function createPodium(scene: Scene, pos: PropPosition, id: string): Mesh {
  const podium = MeshBuilder.CreateCylinder(
    `podium_${id}`,
    { height: 1.0, diameterTop: 0.4, diameterBottom: 0.6, tessellation: 16 },
    scene
  );
  podium.position = new Vector3(pos.x, pos.y + 0.5, pos.z);

  const mat = new StandardMaterial(`podiumMat_${id}`, scene);
  mat.diffuseColor = new Color3(0.35, 0.25, 0.18);
  mat.specularColor = new Color3(0.15, 0.15, 0.15);
  mat.specularPower = 16;
  podium.material = mat;
  podium.checkCollisions = true;

  return podium;
}
```

#### `createBanner`

```typescript
/**
 * A hanging banner: vertical plane with colored material.
 * Dimensions: 0.8 wide x 2.0 tall.
 */
function createBanner(
  scene: Scene,
  pos: PropPosition,
  id: string,
  color?: Color3
): Mesh {
  const banner = MeshBuilder.CreatePlane(
    `banner_${id}`,
    { width: 0.8, height: 2.0 },
    scene
  );
  banner.position = new Vector3(pos.x, pos.y + 2.5, pos.z);

  const mat = new StandardMaterial(`bannerMat_${id}`, scene);
  mat.diffuseColor = color || new Color3(0.6, 0.15, 0.15); // Default: deep red
  mat.emissiveColor = (color || new Color3(0.6, 0.15, 0.15)).scale(0.1);
  mat.backFaceCulling = false;
  banner.material = mat;

  return banner;
}
```

#### `createDisplayCase`

```typescript
/**
 * A transparent display case: glass box with subtle emissive edge.
 * Dimensions: 0.8 x 0.8 x 0.8 cube.
 */
function createDisplayCase(scene: Scene, pos: PropPosition, id: string): Mesh {
  const caseBox = MeshBuilder.CreateBox(
    `displayCase_${id}`,
    { width: 0.8, height: 0.8, depth: 0.8 },
    scene
  );
  caseBox.position = new Vector3(pos.x, pos.y + 0.8, pos.z); // On a pedestal height

  const glassMat = new StandardMaterial(`caseMat_${id}`, scene);
  glassMat.diffuseColor = new Color3(0.85, 0.9, 0.95);
  glassMat.alpha = 0.2;
  glassMat.specularColor = new Color3(0.6, 0.6, 0.6);
  glassMat.specularPower = 128;
  glassMat.emissiveColor = new Color3(0.05, 0.05, 0.08);
  glassMat.backFaceCulling = false;
  caseBox.material = glassMat;

  // Small pedestal beneath the case
  const pedestal = MeshBuilder.CreateBox(
    `casePedestal_${id}`,
    { width: 0.9, height: 0.6, depth: 0.9 },
    scene
  );
  pedestal.position = new Vector3(pos.x, pos.y + 0.3, pos.z);
  const pedMat = new StandardMaterial(`casePedMat_${id}`, scene);
  pedMat.diffuseColor = new Color3(0.25, 0.25, 0.3);
  pedestal.material = pedMat;
  pedestal.checkCollisions = true;

  return caseBox;
}
```

#### `createTelescope`

```typescript
/**
 * A telescope: tilted cylinder body + small cylinder eyepiece.
 * Body: 1.2 long, 0.15 diameter. Eyepiece: 0.3 long, 0.1 diameter.
 */
function createTelescope(scene: Scene, pos: PropPosition, id: string): Mesh {
  const parent = new Mesh(`telescope_${id}`, scene);

  const metalMat = new StandardMaterial(`telescopeMat_${id}`, scene);
  metalMat.diffuseColor = new Color3(0.5, 0.5, 0.55);
  metalMat.specularColor = new Color3(0.4, 0.4, 0.4);
  metalMat.specularPower = 64;

  // Main tube (tilted 30 degrees upward)
  const tube = MeshBuilder.CreateCylinder(
    `telescopeTube_${id}`,
    { height: 1.2, diameter: 0.15, tessellation: 12 },
    scene
  );
  tube.rotation.x = -Math.PI / 6; // 30 degrees upward tilt
  tube.position.y = 1.2;
  tube.material = metalMat;
  tube.parent = parent;

  // Eyepiece (small cylinder at the base end)
  const eyepiece = MeshBuilder.CreateCylinder(
    `telescopeEyepiece_${id}`,
    { height: 0.3, diameter: 0.1, tessellation: 8 },
    scene
  );
  eyepiece.rotation.z = Math.PI / 2; // Perpendicular
  eyepiece.position = new Vector3(0, 0.95, 0.25);
  eyepiece.material = metalMat;
  eyepiece.parent = parent;

  // Tripod legs (3 thin cylinders)
  for (let i = 0; i < 3; i++) {
    const angle = (i * 2 * Math.PI) / 3;
    const leg = MeshBuilder.CreateCylinder(
      `telescopeLeg_${id}_${i}`,
      { height: 1.0, diameter: 0.04, tessellation: 6 },
      scene
    );
    leg.position = new Vector3(
      Math.cos(angle) * 0.25,
      0.5,
      Math.sin(angle) * 0.25
    );
    leg.rotation.x = Math.cos(angle) * 0.15;
    leg.rotation.z = Math.sin(angle) * 0.15;
    leg.material = metalMat;
    leg.parent = parent;
  }

  parent.position = new Vector3(pos.x, pos.y, pos.z);
  parent.checkCollisions = true;
  return parent;
}
```

#### `createGear`

```typescript
/**
 * A decorative gear: torus mesh lying flat.
 * Dimensions: 0.5 diameter, 0.08 tube thickness.
 */
function createGear(scene: Scene, pos: PropPosition, id: string): Mesh {
  const gear = MeshBuilder.CreateTorus(
    `gear_${id}`,
    { diameter: 0.5, thickness: 0.08, tessellation: 24 },
    scene
  );
  gear.position = new Vector3(pos.x, pos.y + 0.85, pos.z); // Resting on table height

  const mat = new StandardMaterial(`gearMat_${id}`, scene);
  mat.diffuseColor = new Color3(0.55, 0.5, 0.35); // Brass
  mat.specularColor = new Color3(0.3, 0.3, 0.2);
  mat.specularPower = 32;
  gear.material = mat;

  // Slow spin
  scene.registerBeforeRender(() => {
    if (!gear.isDisposed()) {
      gear.rotation.y += 0.003;
    }
  });

  return gear;
}
```

#### `createVinePillar`

```typescript
/**
 * A vine-covered pillar: cylinder with green tint.
 * Dimensions: 0.3 diameter x 3.0 tall.
 */
function createVinePillar(scene: Scene, pos: PropPosition, id: string): Mesh {
  const pillar = MeshBuilder.CreateCylinder(
    `vinePillar_${id}`,
    { height: 3.0, diameter: 0.3, tessellation: 12 },
    scene
  );
  pillar.position = new Vector3(pos.x, pos.y + 1.5, pos.z);

  const mat = new StandardMaterial(`vinePillarMat_${id}`, scene);
  mat.diffuseColor = new Color3(0.3, 0.55, 0.2); // Green-brown
  mat.emissiveColor = new Color3(0.02, 0.06, 0.01);
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  pillar.material = mat;
  pillar.checkCollisions = true;

  return pillar;
}
```

#### `createFlowerCluster`

```typescript
/**
 * A cluster of flower spheres in random colors, arranged in a small group.
 * 3-5 small spheres clustered together.
 */
function createFlowerCluster(scene: Scene, pos: PropPosition, id: string): Mesh {
  const parent = new Mesh(`flowers_${id}`, scene);

  const flowerColors = [
    new Color3(0.9, 0.2, 0.3),   // Pink
    new Color3(0.95, 0.8, 0.1),  // Yellow
    new Color3(0.6, 0.2, 0.8),   // Purple
    new Color3(1.0, 0.5, 0.2),   // Orange
    new Color3(0.9, 0.9, 0.95),  // White
  ];

  const count = 3 + Math.floor(Math.abs(id.charCodeAt(0) % 3)); // 3-5 flowers
  for (let i = 0; i < count; i++) {
    const flower = MeshBuilder.CreateSphere(
      `flower_${id}_${i}`,
      { diameter: 0.2 + (i % 2) * 0.08, segments: 8 },
      scene
    );
    const angle = (i / count) * Math.PI * 2;
    const radius = 0.15 + (i % 2) * 0.1;
    flower.position = new Vector3(
      Math.cos(angle) * radius,
      0.15 + i * 0.02,
      Math.sin(angle) * radius
    );
    flower.parent = parent;

    const mat = new StandardMaterial(`flowerMat_${id}_${i}`, scene);
    mat.diffuseColor = flowerColors[i % flowerColors.length];
    mat.emissiveColor = flowerColors[i % flowerColors.length].scale(0.15);
    flower.material = mat;

    // Stem
    const stem = MeshBuilder.CreateCylinder(
      `stem_${id}_${i}`,
      { height: 0.15, diameter: 0.03, tessellation: 6 },
      scene
    );
    stem.position = new Vector3(
      Math.cos(angle) * radius,
      0.075,
      Math.sin(angle) * radius
    );
    stem.parent = parent;

    const stemMat = new StandardMaterial(`stemMat_${id}_${i}`, scene);
    stemMat.diffuseColor = new Color3(0.2, 0.5, 0.15);
    stem.material = stemMat;
  }

  parent.position = new Vector3(pos.x, pos.y, pos.z);
  return parent;
}
```

#### `createLantern`

```typescript
/**
 * A hanging lantern: small box frame with a point light inside.
 * Dimensions: 0.25 x 0.35 x 0.25.
 */
function createLantern(scene: Scene, pos: PropPosition, id: string): Mesh {
  const parent = new Mesh(`lantern_${id}`, scene);

  const frame = MeshBuilder.CreateBox(
    `lanternFrame_${id}`,
    { width: 0.25, height: 0.35, depth: 0.25 },
    scene
  );
  frame.position.y = 2.8; // Hanging height
  frame.parent = parent;

  const frameMat = new StandardMaterial(`lanternFrameMat_${id}`, scene);
  frameMat.diffuseColor = new Color3(0.2, 0.2, 0.22);
  frameMat.alpha = 0.6;
  frameMat.emissiveColor = new Color3(0.4, 0.3, 0.1);
  frameMat.backFaceCulling = false;
  frame.material = frameMat;

  // Inner glow sphere
  const glow = MeshBuilder.CreateSphere(
    `lanternGlow_${id}`,
    { diameter: 0.15, segments: 8 },
    scene
  );
  glow.position.y = 2.8;
  glow.parent = parent;

  const glowMat = new StandardMaterial(`lanternGlowMat_${id}`, scene);
  glowMat.diffuseColor = new Color3(1.0, 0.85, 0.4);
  glowMat.emissiveColor = new Color3(1.0, 0.7, 0.3);
  glowMat.disableLighting = true;
  glow.material = glowMat;

  // Point light
  const light = new PointLight(
    `lanternLight_${id}`,
    new Vector3(pos.x, pos.y + 2.8, pos.z),
    scene
  );
  light.intensity = 0.4;
  light.range = 6;
  light.diffuse = new Color3(1.0, 0.85, 0.5);

  parent.position = new Vector3(pos.x, pos.y, pos.z);
  return parent;
}
```

#### `createCushion`

```typescript
/**
 * A floor cushion: flattened sphere.
 * Dimensions: 0.5 diameter, 0.15 height.
 */
function createCushion(scene: Scene, pos: PropPosition, id: string): Mesh {
  const cushion = MeshBuilder.CreateSphere(
    `cushion_${id}`,
    { diameter: 0.5, segments: 12 },
    scene
  );
  cushion.scaling.y = 0.3; // Flatten
  cushion.position = new Vector3(pos.x, pos.y + 0.08, pos.z);

  const mat = new StandardMaterial(`cushionMat_${id}`, scene);
  mat.diffuseColor = new Color3(0.6, 0.25, 0.3); // Muted red/burgundy
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  cushion.material = mat;

  return cushion;
}
```

#### `createStarChart`

```typescript
/**
 * A star chart: plane with dot-pattern texture created via DynamicTexture.
 * Dimensions: 1.5 x 1.5 plane, mounted on a wall or lying on a table.
 */
function createStarChart(scene: Scene, pos: PropPosition, id: string): Mesh {
  const chart = MeshBuilder.CreatePlane(
    `starChart_${id}`,
    { width: 1.5, height: 1.5 },
    scene
  );
  chart.position = new Vector3(pos.x, pos.y + 1.5, pos.z);
  chart.billboardMode = Mesh.BILLBOARDMODE_Y; // Always face horizontally

  const texSize = 256;
  const dt = new DynamicTexture(`starChartTex_${id}`, texSize, scene, false);
  dt.hasAlpha = true;

  const ctx = dt.getContext() as unknown as CanvasRenderingContext2D;

  // Dark background
  ctx.fillStyle = "rgba(5, 5, 20, 0.85)";
  ctx.fillRect(0, 0, texSize, texSize);

  // Draw constellation dots
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  // Deterministic star positions from id hash
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  let seed = Math.abs(hash);
  for (let i = 0; i < 30; i++) {
    seed = ((seed * 1103515245 + 12345) & 0x7fffffff);
    const sx = (seed % texSize);
    seed = ((seed * 1103515245 + 12345) & 0x7fffffff);
    const sy = (seed % texSize);
    const radius = 1 + (i % 3);
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw connecting lines between some stars
  ctx.strokeStyle = "rgba(100, 150, 255, 0.3)";
  ctx.lineWidth = 1;
  seed = Math.abs(hash);
  for (let i = 0; i < 8; i++) {
    seed = ((seed * 1103515245 + 12345) & 0x7fffffff);
    const x1 = seed % texSize;
    seed = ((seed * 1103515245 + 12345) & 0x7fffffff);
    const y1 = seed % texSize;
    seed = ((seed * 1103515245 + 12345) & 0x7fffffff);
    const x2 = seed % texSize;
    seed = ((seed * 1103515245 + 12345) & 0x7fffffff);
    const y2 = seed % texSize;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  dt.update();

  const mat = new StandardMaterial(`starChartMat_${id}`, scene);
  mat.diffuseTexture = dt;
  mat.emissiveColor = new Color3(0.15, 0.15, 0.25);
  mat.useAlphaFromDiffuseTexture = true;
  mat.backFaceCulling = false;
  mat.disableLighting = true;
  chart.material = mat;

  return chart;
}
```

### Archetype -> Prop Placement Rules

```typescript
interface PropPlacement {
  factory: (scene: Scene, pos: PropPosition, id: string, color?: Color3) => Mesh;
  count: number;
  placement: "wall" | "corner" | "center" | "scatter" | "onTable";
}

/**
 * Returns the list of props to place for a given archetype.
 */
function getArchetypeProps(archetype: string): PropPlacement[] {
  switch (archetype) {
    case "laboratory":
      return [
        { factory: createTable, count: 2, placement: "wall" },
        { factory: createBeaker, count: 3, placement: "onTable" },
        { factory: createTorch, count: 2, placement: "corner" },
      ];

    case "library":
      return [
        { factory: createBookshelf, count: 3, placement: "wall" },
        { factory: createBench, count: 1, placement: "center" },
        { factory: createTorch, count: 2, placement: "corner" },
        { factory: createBanner, count: 1, placement: "wall" },
      ];

    case "garden":
      return [
        { factory: createVinePillar, count: 2, placement: "corner" },
        { factory: createFlowerCluster, count: 4, placement: "scatter" },
        { factory: createBench, count: 1, placement: "center" },
      ];

    case "amphitheater":
      return [
        { factory: createPodium, count: 1, placement: "center" },
        { factory: createBanner, count: 2, placement: "wall" },
        { factory: createTorch, count: 4, placement: "corner" },
      ];

    case "observatory":
      return [
        { factory: createTelescope, count: 1, placement: "center" },
        { factory: createStarChart, count: 2, placement: "wall" },
        { factory: createCushion, count: 2, placement: "scatter" },
        { factory: createTorch, count: 2, placement: "corner" },
      ];

    case "workshop":
      return [
        { factory: createTable, count: 1, placement: "wall" },
        { factory: createGear, count: 3, placement: "onTable" },
        { factory: createTorch, count: 2, placement: "corner" },
        { factory: createBeaker, count: 1, placement: "onTable" },
      ];

    case "gallery":
      return [
        { factory: createDisplayCase, count: 4, placement: "wall" },
        { factory: createTorch, count: 2, placement: "corner" },
        { factory: createBanner, count: 1, placement: "wall" },
      ];

    case "chamber":
      return [
        { factory: createCushion, count: 2, placement: "corner" },
        { factory: createTorch, count: 2, placement: "corner" },
        { factory: createBanner, count: 1, placement: "wall" },
        { factory: createBookshelf, count: 1, placement: "wall" },
      ];

    default:
      return [
        { factory: createTorch, count: 2, placement: "corner" },
      ];
  }
}
```

### Main `decorateSpace` Implementation

```typescript
export function decorateSpace(
  scene: Scene,
  space: Space,
  materials: Map<string, StandardMaterial>
): Mesh[] {
  const archetype = space.archetype || "chamber"; // Fallback
  const props = getArchetypeProps(archetype);
  const { center, corners, wallMidpoints } = getRoomPositions(space);
  const allMeshes: Mesh[] = [];

  let cornerIdx = 0;
  let wallIdx = 0;
  let tablePositions: PropPosition[] = []; // Track where tables were placed

  for (const propDef of props) {
    for (let i = 0; i < propDef.count; i++) {
      let pos: PropPosition;
      const uniqueId = `${space.id}_${archetype}_${i}_${propDef.factory.name}`;

      switch (propDef.placement) {
        case "center":
          pos = { ...center, x: center.x + i * 1.5, z: center.z + i * 0.5 };
          break;

        case "corner":
          pos = corners[cornerIdx % corners.length];
          cornerIdx++;
          break;

        case "wall":
          pos = wallMidpoints[wallIdx % wallMidpoints.length];
          wallIdx++;
          break;

        case "scatter":
          const scattered = getScatteredPositions(space, propDef.count);
          pos = scattered[i % scattered.length];
          break;

        case "onTable":
          // Place on top of a previously placed table, with x offset
          if (tablePositions.length > 0) {
            const tablePos = tablePositions[i % tablePositions.length];
            pos = {
              x: tablePos.x + (i - 1) * 0.4,
              y: tablePos.y + 0.78, // Table top height
              z: tablePos.z,
            };
          } else {
            pos = wallMidpoints[wallIdx % wallMidpoints.length];
            wallIdx++;
          }
          break;

        default:
          pos = center;
      }

      const mesh = propDef.factory(scene, pos, uniqueId);
      allMeshes.push(mesh);

      // Track table positions for "onTable" placement
      if (propDef.factory === createTable) {
        tablePositions.push(pos);
      }
    }
  }

  return allMeshes;
}
```

### Summary Table: Archetype Props

| Archetype | Props | Total Count | Placement Strategy |
|---|---|---|---|
| laboratory | table(2), beaker(3), torch(2) | 7 | tables on walls, beakers on tables, torches in corners |
| library | bookshelf(3), bench(1), torch(2), banner(1) | 7 | shelves on walls, bench at center, torches in corners |
| garden | vinePillar(2), flowerCluster(4), bench(1) | 7 | pillars in corners, flowers scattered, bench at center |
| amphitheater | podium(1), banner(2), torch(4) | 7 | podium at center, banners on walls, torches in all 4 corners |
| observatory | telescope(1), starChart(2), cushion(2), torch(2) | 7 | telescope at center, charts on walls, cushions scattered |
| workshop | table(1), gear(3), torch(2), beaker(1) | 7 | table on wall, gears on table, torches in corners |
| gallery | displayCase(4), torch(2), banner(1) | 7 | cases evenly on walls, torches in corners |
| chamber | cushion(2), torch(2), banner(1), bookshelf(1) | 6 | cushions and torches in corners, shelf on wall |

---

## Module 7: Zone Transitions

**File:** `src/web/world/zones.ts` -- **NEW FILE**
**Owner agent:** Agent-Zones

### Purpose

At zone boundaries (where a path connects spaces in different zones), create a decorative archway mesh at the midpoint of the connecting path, colored with the destination zone's accent color, with a floating zone name label above.

### Interface

```typescript
import { Scene, StandardMaterial } from "@babylonjs/core";
import type { PalaceConfig } from "../../shared/types";

/**
 * Scans all paths for cross-zone connections and builds archway meshes
 * at the midpoint of each such path.
 */
export function buildZoneArchways(
  scene: Scene,
  config: PalaceConfig,
  materials: Map<string, StandardMaterial>
): void;
```

### Imports

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
import type { PalaceConfig, Space, Path } from "../../shared/types";
```

### Implementation

```typescript
/**
 * Parses a hex color string to Color3.
 */
function hexToColor3(hex: string): Color3 {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return new Color3(r, g, b);
}

export function buildZoneArchways(
  scene: Scene,
  config: PalaceConfig,
  materials: Map<string, StandardMaterial>
): void {
  // Build space lookup
  const spaceMap = new Map<string, Space>();
  for (const space of config.spaces) {
    spaceMap.set(space.id, space);
  }

  for (const path of config.paths) {
    const sourceSpace = spaceMap.get(path.source_space_id);
    const targetSpace = spaceMap.get(path.target_space_id);
    if (!sourceSpace || !targetSpace) continue;

    // Only build archway if spaces are in different zones
    if (sourceSpace.zone_id === targetSpace.zone_id) continue;

    // Find midpoint of the path
    const midIdx = Math.floor(path.waypoints.length / 2);
    const midWP = path.waypoints[midIdx];

    // Compute direction at midpoint for archway orientation
    const prevWP = path.waypoints[Math.max(0, midIdx - 1)];
    const nextWP = path.waypoints[Math.min(path.waypoints.length - 1, midIdx + 1)];
    const dx = nextWP.x - prevWP.x;
    const dz = nextWP.z - prevWP.z;
    const angle = Math.atan2(dx, dz);

    // Use destination zone color
    const zoneColor = targetSpace.zone_color
      ? hexToColor3(targetSpace.zone_color)
      : new Color3(0.5, 0.5, 0.6);
    const zoneName = targetSpace.zone_name || `Zone ${targetSpace.zone_id}`;

    buildArchway(scene, midWP, angle, zoneColor, zoneName, path.id);
  }
}

/**
 * Builds a decorative archway: two vertical pillars + curved top beam.
 */
function buildArchway(
  scene: Scene,
  position: { x: number; y: number; z: number },
  rotation: number,
  color: Color3,
  zoneName: string,
  pathId: string
): void {
  const parent = new Mesh(`archway_${pathId}`, scene);
  const pillarHeight = 4.0;
  const pillarDiameter = 0.25;
  const archWidth = 3.5;
  const halfWidth = archWidth / 2;

  const archMat = new StandardMaterial(`archwayMat_${pathId}`, scene);
  archMat.diffuseColor = color;
  archMat.emissiveColor = color.scale(0.15);
  archMat.specularColor = new Color3(0.2, 0.2, 0.2);

  // Left pillar
  const leftPillar = MeshBuilder.CreateCylinder(
    `archwayPillarL_${pathId}`,
    { height: pillarHeight, diameter: pillarDiameter, tessellation: 12 },
    scene
  );
  leftPillar.position = new Vector3(-halfWidth, pillarHeight / 2, 0);
  leftPillar.material = archMat;
  leftPillar.parent = parent;
  leftPillar.checkCollisions = true;

  // Right pillar
  const rightPillar = MeshBuilder.CreateCylinder(
    `archwayPillarR_${pathId}`,
    { height: pillarHeight, diameter: pillarDiameter, tessellation: 12 },
    scene
  );
  rightPillar.position = new Vector3(halfWidth, pillarHeight / 2, 0);
  rightPillar.material = archMat;
  rightPillar.parent = parent;
  rightPillar.checkCollisions = true;

  // Top arch beam (horizontal cylinder connecting the pillars)
  const beam = MeshBuilder.CreateCylinder(
    `archwayBeam_${pathId}`,
    { height: archWidth + pillarDiameter, diameter: pillarDiameter, tessellation: 12 },
    scene
  );
  beam.rotation.z = Math.PI / 2; // Lay horizontal
  beam.position = new Vector3(0, pillarHeight, 0);
  beam.material = archMat;
  beam.parent = parent;

  // Curved top decoration (torus arc)
  const arch = MeshBuilder.CreateTorus(
    `archwayArc_${pathId}`,
    {
      diameter: archWidth,
      thickness: pillarDiameter * 0.8,
      tessellation: 32,
    },
    scene
  );
  arch.position = new Vector3(0, pillarHeight, 0);
  arch.rotation.x = Math.PI / 2;
  arch.scaling.y = 0.5; // Flatten into semi-circle
  arch.material = archMat;
  arch.parent = parent;

  // Zone name label
  createZoneLabel(scene, zoneName, new Vector3(0, pillarHeight + 1.2, 0), parent, pathId);

  // Position and rotate the whole archway
  parent.position = new Vector3(position.x, position.y, position.z);
  parent.rotation.y = rotation;
}

/**
 * Creates a floating zone name text above the archway.
 */
function createZoneLabel(
  scene: Scene,
  text: string,
  localPos: Vector3,
  parent: Mesh,
  pathId: string
): void {
  const planeWidth = Math.max(2.5, text.length * 0.35);
  const planeHeight = 0.5;

  const plane = MeshBuilder.CreatePlane(
    `zoneLabel_${pathId}`,
    { width: planeWidth, height: planeHeight },
    scene
  );
  plane.position = localPos;
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  plane.parent = parent;

  const texRes = 512;
  const dt = new DynamicTexture(`zoneLabelTex_${pathId}`, texRes, scene, false);
  dt.hasAlpha = true;

  const ctx = dt.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, texRes, texRes);

  // Background
  const fontSize = 44;
  ctx.font = `bold ${fontSize}px Inter, Segoe UI, system-ui, sans-serif`;
  ctx.fillStyle = "rgba(10, 10, 30, 0.6)";
  const textWidth = ctx.measureText(text).width;
  const bgPadX = 20;
  const bgPadY = 10;
  const bgX = (texRes - textWidth) / 2 - bgPadX;
  const bgY = (texRes - fontSize) / 2 - bgPadY;
  ctx.fillRect(bgX, bgY, textWidth + bgPadX * 2, fontSize + bgPadY * 2);

  // Text
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, texRes / 2, texRes / 2);
  dt.update();

  const mat = new StandardMaterial(`zoneLabelMat_${pathId}`, scene);
  mat.diffuseTexture = dt;
  mat.emissiveColor = new Color3(1, 1, 1);
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.useAlphaFromDiffuseTexture = true;
  plane.material = mat;
}
```

---

## Module 8: NPC Manager Updates

**File:** `src/web/npcs/manager.ts`
**Status:** Already rewritten to pure Babylon.js. No changes required.
**Owner agent:** N/A (done)

### Current Behavior (Do Not Change)

The `NPCManager` class already uses pure Babylon.js APIs:

| Feature | Implementation |
|---|---|
| Proximity detection | `Vector3.Distance(camera.position, npcEntity.mesh.position) < 4` |
| Input binding | `document.addEventListener("keydown", handler)` checking for "e" / "E" key |
| Camera lock during dialogue | `camera.detachControl()` on open, `camera.attachControl(canvas, true)` on close |
| Per-frame update | `scene.registerBeforeRender(() => this.update())` |
| Pointer lock release | `document.exitPointerLock()` when dialogue opens |
| Pointer lock reacquire | `canvas.requestPointerLock()` when dialogue closes |
| NPC spawning | Delegates to `buildNPCMesh(scene, model, position, facing)` which returns `{ mesh: Mesh }` |
| Cleanup | Disposes all NPC meshes, unregisters `beforeRender` callback, removes keydown listener |

### NPC Renderer (Already Rewritten, Reference Only)

**File:** `src/web/npcs/renderer.ts`

The `buildNPCMesh` function creates:
- **Body:** `CreateCylinder` (height 1.2, diameter 0.6, tessellation 16) at y=0.6
- **Accent ring:** `CreateTorus` (diameter 0.62, thickness 0.08) at y=0.7
- **Head:** `CreateSphere` (diameter 0.5, segments 12) at y=1.45
- **Eyes:** 2x `CreateSphere` (diameter 0.08) at y=1.5, z=-0.22, x=+/-0.1
- **Idle animation:** `scene.registerBeforeRender` with `Math.sin(Date.now() / 600) * 0.06` y-bobbing
- All parts parented to a `Mesh` parent, positioned at `position + (0.5, 0, 0.5)` with `rotation.y = facing`

---

## Module 9: Artifacts

**File:** `src/web/artifacts/loader.ts`
**Status:** Requires modification. Change fallback from cube to sphere.
**Owner agent:** Agent-Artifacts

### Interface (Unchanged)

```typescript
export function buildPedestal(
  scene: Scene,
  artifact: Artifact,
  materials: Map<string, StandardMaterial>
): void;

export async function loadArtifact(
  scene: Scene,
  artifact: Artifact
): Promise<void>;
```

### Change: Replace Placeholder Cube with Sphere

The `createPlaceholderArtifact` function currently creates a `CreateBox`. Change it to `CreateSphere` for a more polished appearance.

#### Current Code (Replace)

```typescript
function createPlaceholderArtifact(scene: Scene, artifact: Artifact): void {
  // ... hash calculation ...
  const box = MeshBuilder.CreateBox(
    `placeholder_${artifact.id}`,
    { size: 0.8 * artifact.scale },
    scene
  );
  // ...
}
```

#### New Code

```typescript
function createPlaceholderArtifact(scene: Scene, artifact: Artifact): void {
  let hash = 0;
  for (let i = 0; i < artifact.id.length; i++) {
    hash = ((hash << 5) - hash + artifact.id.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash % 360) / 360;

  const sphere = MeshBuilder.CreateSphere(
    `placeholder_${artifact.id}`,
    { diameter: 0.8 * artifact.scale, segments: 16 },
    scene
  );

  const mat = new StandardMaterial(`placeholder_mat_${artifact.id}`, scene);
  mat.diffuseColor = Color3.FromHSV(hue * 360, 0.7, 0.9);
  mat.specularColor = new Color3(0.3, 0.3, 0.3);
  mat.specularPower = 64;
  mat.emissiveColor = Color3.FromHSV(hue * 360, 0.5, 0.3); // Subtle glow
  sphere.material = mat;

  sphere.position = new Vector3(
    artifact.position.x,
    artifact.position.y + artifact.pedestal.height + 0.5,
    artifact.position.z
  );
  sphere.rotation.y = artifact.rotation_y;

  // Slow spin + gentle bob animation
  const baseY = sphere.position.y;
  scene.registerBeforeRender(() => {
    if (!sphere.isDisposed()) {
      sphere.rotation.y += 0.005;
      sphere.position.y = baseY + Math.sin(Date.now() / 800) * 0.08;
    }
  });
}
```

### Pedestal (`buildPedestal`) -- No Change

Already creates `CreateBox` with pedestal dimensions, applies material from `materials.get(pedestal.block)`, sets `checkCollisions = true`.

### GLB Loading (`loadArtifact`) -- No Change

Already uses `SceneLoader.ImportMeshAsync`, positions root mesh at `artifact.position + pedestal.height`, handles error by calling `createPlaceholderArtifact`.

---

## Module 10: Main.ts Updates

**File:** `src/web/main.ts`
**Status:** No changes required.
**Owner agent:** N/A (done)

### Current State (Already Correct)

The `main.ts` orchestration already:

1. Calls `createEngine(app)` returning a `GameEngine` (Babylon.js, not noa)
2. Calls `applyTheme(gameEngine.scene, theme)` returning `Map<string, StandardMaterial>`
3. Calls `await generateWorld(gameEngine, config, materials)` for all mesh construction
4. Creates `NPCManager(gameEngine, palaceId, apiEndpoint)` and calls `npcManager.spawnAll(config.npcs)`
5. Creates `HUD` and `Minimap`
6. Hooks minimap update into `scene.registerBeforeRender`

No noa-specific tick loop exists. The Babylon.js `engine.runRenderLoop(() => scene.render())` (set up in `createEngine`) handles everything.

The only change needed in `main.ts` is **none** -- the `generateWorld` function internally calls the new `decorateSpace` and `buildZoneArchways` functions, so the orchestration layer does not need to know about them.

---

## Appendix A: Shared Type Additions

**File:** `src/shared/types.ts`
**Status:** No structural changes required.

The `Space` interface already includes the `archetype: RoomArchetype` and `ambient_mood: AmbientMood` fields. The `Path` interface already includes `direction: PathDirection`. The `Space` interface already includes `zone_id: number`, `zone_name: string`, and `zone_color: string`.

All types needed by this EIS are already defined:

- `RoomArchetype`: `"laboratory" | "library" | "garden" | "amphitheater" | "observatory" | "workshop" | "gallery" | "chamber"`
- `AmbientMood`: `"serene" | "energetic" | "mysterious" | "clinical" | "warm"`
- `PathDirection`: `"forward" | "lateral" | "none"`
- `Space.zone_name`: `string`
- `Space.zone_color`: `string`

No new types are needed. The prop system is entirely internal to `props.ts`.

---

## Appendix B: Seed Data Schema Update

**File:** `public/seed-palace.json`
**Status:** Requires update to include missing fields.

The current seed data is missing several fields that were defined in the types but not populated in the JSON. Each space entry must be updated to include:

```json
{
  "archetype": "<RoomArchetype>",
  "ambient_mood": "<AmbientMood>",
  "zone_name": "<string>",
  "zone_color": "<hex string>"
}
```

Each path entry must be updated to include:

```json
{
  "direction": "<PathDirection>"
}
```

The top-level config must include:

```json
{
  "learning_path": ["<concept_id>", ...]
}
```

### Recommended Seed Data Assignments

| Space ID | archetype | ambient_mood | zone_name | zone_color |
|---|---|---|---|---|
| dna | laboratory | clinical | Genetics | #4a90d9 |
| cell_structure | observatory | mysterious | Cell Biology | #56b870 |
| mitochondria | workshop | energetic | Cell Biology | #56b870 |
| proteins | gallery | clinical | Molecular Biology | #d4a843 |
| evolution | amphitheater | energetic | Evolution | #c75a3a |
| photosynthesis | garden | serene | Physiology | #7ec850 |
| mutations | chamber | mysterious | Genetics | #4a90d9 |
| enzymes | library | warm | Molecular Biology | #d4a843 |
| cell_membrane | workshop | warm | Cell Biology | #56b870 |
| natural_selection | amphitheater | energetic | Evolution | #c75a3a |

| Path ID | direction |
|---|---|
| dna_to_mutations | forward |
| dna_to_proteins | forward |
| dna_to_cell_structure | forward |
| cell_structure_to_mitochondria | forward |
| cell_structure_to_cell_membrane | forward |
| proteins_to_enzymes | forward |
| evolution_to_natural_selection | forward |
| evolution_to_mutations | forward |
| mutations_to_natural_selection | forward |
| photosynthesis_to_enzymes | lateral |
| mitochondria_to_photosynthesis | lateral |
| cell_membrane_to_proteins | lateral |

```json
"learning_path": [
  "cell_structure", "cell_membrane", "mitochondria",
  "dna", "mutations", "proteins", "enzymes",
  "evolution", "natural_selection", "photosynthesis"
]
```

---

## Implementation Order & Dependencies

```
Phase 1 (Parallel -- no inter-dependencies):
  Agent-Artifacts:    Module 9 (placeholder sphere change)
  Agent-Props:        Module 6 (new file, self-contained)
  Agent-Zones:        Module 7 (new file, self-contained)
  Agent-PathBuilder:  Module 5 (bridge railings + arrows)
  Agent-SeedData:     Appendix B (update seed-palace.json)

Phase 2 (Depends on Phase 1):
  Agent-SpaceBuilder: Module 4 (archetype modifiers -- depends on types being populated)

Phase 3 (Depends on Phase 1+2):
  Agent-WorldGen:     Module 3 (add decorateSpace + buildZoneArchways calls)
```

No changes needed for Modules 1, 2, 8, or 10 -- they are already complete.

---

## File Manifest

| File | Action | Module |
|---|---|---|
| `src/web/engine/setup.ts` | No change | 1 |
| `src/web/themes/applicator.ts` | No change | 2 |
| `src/web/world/generator.ts` | Modify (add 2 imports + 2 loop calls) | 3 |
| `src/web/world/spaces.ts` | Modify (add archetype modifiers) | 4 |
| `src/web/world/paths.ts` | Modify (add bridge railings + direction arrows) | 5 |
| `src/web/world/props.ts` | **Create** (15 prop generators + placement engine) | 6 |
| `src/web/world/zones.ts` | **Create** (archway builder) | 7 |
| `src/web/npcs/manager.ts` | No change | 8 |
| `src/web/npcs/renderer.ts` | No change | 8 |
| `src/web/artifacts/loader.ts` | Modify (cube -> sphere fallback) | 9 |
| `src/web/main.ts` | No change | 10 |
| `src/shared/types.ts` | No change | A |
| `public/seed-palace.json` | Modify (add missing fields) | B |
