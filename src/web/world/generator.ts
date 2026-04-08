import type { PalaceConfig, Space } from "../../shared/types";
import type { GameEngine } from "../engine/setup";
import { buildSpace } from "./spaces";
import { buildPath } from "./paths";
import { buildZoneArchways } from "./zones";
import { buildPedestal, loadArtifact } from "../artifacts/loader";
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
 * Top-level world generation orchestrator.
 * Builds all mesh geometry from a PalaceConfig:
 *  1. Ground plane
 *  2. Spaces (rooms with smooth floors, walls, optional ceilings, labels)
 *  3. Paths (corridors, trails, bridges, tunnels)
 *  4. Pedestals + artifact meshes
 *  5. Camera spawn position + orientation
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

  // 5. Build pedestals and load artifacts
  for (const artifact of config.artifacts) {
    buildPedestal(scene, artifact, materials);
    await loadArtifact(scene, artifact);
  }

  // 6. Set camera position at spawn point
  const sp = config.spawn_point;
  camera.position = new Vector3(sp.x, sp.y + 2, sp.z);
  camera.rotation.x = 0.1; // Slightly looking down
}
