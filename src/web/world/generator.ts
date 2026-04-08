import type { PalaceConfig, Space } from "../../shared/types";
import type { GameEngine } from "../engine/setup";
import { buildSpace } from "./spaces";
import { buildPath } from "./paths";
import { buildZoneArchways, buildLandmarkBeacons } from "./zones";
import { buildPedestal, loadArtifact } from "../artifacts/loader";
import { buildGoldenPath } from "./breadcrumbs";
import {
  MeshBuilder,
  Vector3,
  StandardMaterial,
  Scene,
} from "@babylonjs/core";

/**
 * Compute axis-aligned bounding box encompassing all spaces.
 */
function computeBounds(spaces: Space[]): {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  minY: number;
} {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;

  for (const space of spaces) {
    const x0 = space.position.x;
    const z0 = space.position.z;
    const x1 = x0 + space.size.width;
    const z1 = z0 + space.size.depth;
    const y = space.position.y;

    if (x0 < minX) minX = x0;
    if (z0 < minZ) minZ = z0;
    if (x1 > maxX) maxX = x1;
    if (z1 > maxZ) maxZ = z1;
    if (y < minY) minY = y;
  }

  return { minX, minZ, maxX, maxZ, minY };
}

/**
 * Build a ground plane beneath all spaces as a large flat mesh.
 */
function buildGroundPlane(
  scene: Scene,
  config: PalaceConfig,
  materials: Map<string, StandardMaterial>
): void {
  if (config.spaces.length === 0) return;

  const groundBlockId = config.theme.palette.ground[0]?.id;
  if (!groundBlockId) return;

  const groundMat = materials.get(groundBlockId);
  if (!groundMat) return;

  const margin = 20;
  const bounds = computeBounds(config.spaces);
  const groundY = bounds.minY - 0.15;

  const rangeX = bounds.maxX - bounds.minX + margin * 2;
  const rangeZ = bounds.maxZ - bounds.minZ + margin * 2;
  const groundWidth = Math.max(rangeX, 300);
  const groundDepth = Math.max(rangeZ, 300);

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;

  const ground = MeshBuilder.CreateGround(
    "ground",
    { width: groundWidth, height: groundDepth, subdivisions: 1 },
    scene
  );
  ground.position = new Vector3(centerX, groundY, centerZ);
  ground.material = groundMat;
  ground.checkCollisions = true;
}

/**
 * Collect all path waypoints that are near a given space so we know where
 * to leave doorway openings in the walls.
 */
function collectPathOpenings(
  config: PalaceConfig,
  spaceId: string
): Array<{ x: number; y: number; z: number }> {
  const openings: Array<{ x: number; y: number; z: number }> = [];

  for (const path of config.paths) {
    if (path.source_space_id === spaceId || path.target_space_id === spaceId) {
      // Use first and last waypoints as doorway markers
      if (path.waypoints.length > 0) {
        openings.push(path.waypoints[0]);
        if (path.waypoints.length > 1) {
          openings.push(path.waypoints[path.waypoints.length - 1]);
        }
      }
    }
  }

  return openings;
}

/**
 * Build a concept name lookup from the palace config's concept graph.
 */
function buildConceptNameMap(config: PalaceConfig): Map<string, string> {
  const nameMap = new Map<string, string>();
  for (const concept of config.concept_graph.concepts) {
    nameMap.set(concept.id, concept.name);
  }
  return nameMap;
}

/**
 * Build an elevated spawn platform with railings and descending stairs.
 * The player starts on this platform overlooking the palace.
 */
function buildSpawnVista(
  scene: Scene,
  config: PalaceConfig,
  materials: Map<string, StandardMaterial>
): void {
  const spawnPos = config.spawn_point;

  // ── Material ──
  const pathBlockId = config.theme.palette.paths[0]?.id;
  const resolved = (pathBlockId ? materials.get(pathBlockId) : undefined) ??
    materials.values().next().value;
  if (!resolved) return;
  const platformMat: StandardMaterial = resolved;

  // ── Elevated platform ──
  const platform = MeshBuilder.CreateBox(
    "spawnPlatform",
    { width: 8, height: 0.3, depth: 8 },
    scene
  );
  platform.position = new Vector3(spawnPos.x, spawnPos.y + 4, spawnPos.z);
  platform.material = platformMat;
  platform.checkCollisions = true;

  // ── Support pillar underneath ──
  const pillar = MeshBuilder.CreateCylinder(
    "spawnPillar",
    { height: 4, diameter: 2 },
    scene
  );
  pillar.position = new Vector3(spawnPos.x, spawnPos.y + 2, spawnPos.z);
  pillar.material = platformMat;
  pillar.checkCollisions = true;

  // ── Railings (3 sides, front open for stairs) ──
  const railHeight = 1;
  const railThickness = 0.15;
  const railY = spawnPos.y + 4.5;

  // Back railing (negative Z side)
  const railBack = MeshBuilder.CreateBox(
    "railBack",
    { width: 8, height: railHeight, depth: railThickness },
    scene
  );
  railBack.position = new Vector3(spawnPos.x, railY, spawnPos.z - 4);
  railBack.material = platformMat;
  railBack.checkCollisions = true;

  // Left railing
  const railLeft = MeshBuilder.CreateBox(
    "railLeft",
    { width: railThickness, height: railHeight, depth: 8 },
    scene
  );
  railLeft.position = new Vector3(spawnPos.x - 4, railY, spawnPos.z);
  railLeft.material = platformMat;
  railLeft.checkCollisions = true;

  // Right railing
  const railRight = MeshBuilder.CreateBox(
    "railRight",
    { width: railThickness, height: railHeight, depth: 8 },
    scene
  );
  railRight.position = new Vector3(spawnPos.x + 4, railY, spawnPos.z);
  railRight.material = platformMat;
  railRight.checkCollisions = true;

  // Front side: NO railing (stairs descend here)

  // ── 4 descending steps ──
  for (let i = 0; i < 4; i++) {
    const step = MeshBuilder.CreateBox(
      `step_${i}`,
      { width: 3, height: 0.3, depth: 1.5 },
      scene
    );
    step.position = new Vector3(
      spawnPos.x,
      spawnPos.y + 4 - (i + 1),
      spawnPos.z + 4 + i * 1.5
    );
    step.material = platformMat;
    step.checkCollisions = true;
  }
}

/**
 * Top-level world generation orchestrator.
 * Builds all mesh geometry from a PalaceConfig:
 *  1. Ground plane
 *  2. Spaces (rooms with smooth floors, walls, optional ceilings, labels)
 *  3. Paths (corridors, trails, bridges, tunnels)
 *  4. Pedestals + artifact meshes
 *  5. Spawn vista platform
 *  6. Camera spawn position + orientation
 */
export async function generateWorld(
  gameEngine: GameEngine,
  config: PalaceConfig,
  materials: Map<string, StandardMaterial>
): Promise<void> {
  const { scene, camera } = gameEngine;
  const conceptNames = buildConceptNameMap(config);

  // 1. Build ground plane
  buildGroundPlane(scene, config, materials);

  // 2. Build each space
  for (const space of config.spaces) {
    const pathOpenings = collectPathOpenings(config, space.id);
    const conceptName = conceptNames.get(space.concept_id) || "";
    buildSpace(scene, space, materials, conceptName, pathOpenings);
  }

  // 3. Build paths between spaces
  for (const path of config.paths) {
    buildPath(scene, path, materials);
  }

  // 4. Build zone transition archways
  buildZoneArchways(scene, config, materials);

  // 4b. Build landmark beacons at zone hubs
  buildLandmarkBeacons(scene, config);

  // 5. Build pedestals and load artifacts
  for (const artifact of config.artifacts) {
    buildPedestal(scene, artifact, materials);
    await loadArtifact(scene, artifact, config);
  }

  // 6. Build golden breadcrumb trail
  buildGoldenPath(scene, config);

  // 7. Build spawn vista platform
  buildSpawnVista(scene, config, materials);

  // 8. Set camera position on spawn platform
  const sp = config.spawn_point;
  camera.position = new Vector3(sp.x, sp.y + 6, sp.z);

  // Look toward the first concept in the learning path
  const firstConceptId = config.learning_path[0];
  const firstSpace = config.spaces.find(
    (s) => s.concept_id === firstConceptId
  );
  if (firstSpace) {
    const targetX = firstSpace.position.x + firstSpace.size.width / 2;
    const targetZ = firstSpace.position.z + firstSpace.size.depth / 2;
    camera.rotation.y = Math.atan2(
      targetX - camera.position.x,
      targetZ - camera.position.z
    );
  }
  camera.rotation.x = 0.15; // Slight downward tilt for vista view

  // Update ground level: platform top + player height
  gameEngine.setGroundLevel(sp.y + 4 + 0.3 + 1.8);
}
