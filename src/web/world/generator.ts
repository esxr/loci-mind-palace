import { Engine } from "noa-engine";
import type { PalaceConfig, Space } from "../../shared/types";
import { buildSpace } from "./spaces";
import { buildPath } from "./paths";
import { buildPedestal, loadArtifact } from "../artifacts/loader";

/**
 * Compute axis-aligned bounding box encompassing all spaces.
 * Returns { minX, minZ, maxX, maxZ, minY } so the ground plane covers everything.
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
 * Build a thin (1-block-thick) ground plane beneath all spaces.
 * Uses the first ground block type from the theme palette.
 * Extends a small margin (4 blocks) around the bounding box of all spaces.
 */
function buildGroundPlane(
  noa: Engine,
  config: PalaceConfig,
  blockMap: Map<string, number>
): void {
  if (config.spaces.length === 0) return;

  const groundBlockId = config.theme.palette.ground[0]?.id;
  if (!groundBlockId) return;

  const numericId = blockMap.get(groundBlockId);
  if (numericId === undefined) return;

  const margin = 4;
  const bounds = computeBounds(config.spaces);
  const groundY = bounds.minY - 1; // one block below the lowest space floor

  for (let x = bounds.minX - margin; x <= bounds.maxX + margin; x++) {
    for (let z = bounds.minZ - margin; z <= bounds.maxZ + margin; z++) {
      noa.setBlock(numericId, x, groundY, z);
    }
  }
}

/**
 * Top-level world generation orchestrator.
 * Builds all voxel geometry from a PalaceConfig:
 *  1. Ground plane
 *  2. Spaces (rooms with floors, walls, optional ceilings)
 *  3. Paths (corridors, trails, bridges, tunnels)
 *  4. Pedestals + artifact meshes
 *  5. Player spawn
 */
export async function generateWorld(
  noa: Engine,
  config: PalaceConfig,
  blockMap: Map<string, number>
): Promise<void> {
  // 1. Build ground plane (thin base layer under all spaces)
  buildGroundPlane(noa, config, blockMap);

  // 2. Build each space
  for (const space of config.spaces) {
    buildSpace(noa, space, blockMap);
  }

  // 3. Build paths between spaces
  for (const path of config.paths) {
    buildPath(noa, path, blockMap);
  }

  // 4. Build pedestals and load artifacts
  for (const artifact of config.artifacts) {
    buildPedestal(noa, artifact, blockMap);
    await loadArtifact(noa, artifact);
  }

  // 5. Set spawn point (offset Y by 1 so player doesn't clip into floor)
  const sp = config.spawn_point;
  noa.ents.setPosition(noa.playerEntity, [sp.x, sp.y + 1, sp.z]);
}
