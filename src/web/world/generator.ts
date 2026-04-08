import { Engine } from "noa-engine";
import type { PalaceConfig, Space } from "../../shared/types";
import { BlockStore } from "./blockStore";
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
  store: BlockStore,
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
      store.set(numericId, x, groundY, z);
    }
  }
}

/**
 * Top-level world generation orchestrator.
 * Builds all voxel geometry from a PalaceConfig:
 *  1. Install worldDataNeeded handler (critical for noa chunk rendering)
 *  2. Ground plane
 *  3. Spaces (rooms with floors, walls, optional ceilings)
 *  4. Paths (corridors, trails, bridges, tunnels)
 *  5. Pedestals + artifact meshes
 *  6. Player spawn + camera orientation
 */
export async function generateWorld(
  noa: Engine,
  config: PalaceConfig,
  blockMap: Map<string, number>
): Promise<void> {
  // Create a block store that buffers all voxel placements.
  // noa-engine only creates chunks via the worldDataNeeded event; calling
  // noa.setBlock() directly is a no-op when the chunk does not yet exist.
  // The store collects placements and the handler feeds them to noa on demand.
  const store = new BlockStore();
  store.install(noa);

  // Setter function bound to the store for sub-builders
  const setBlock = (id: number, x: number, y: number, z: number) =>
    store.set(id, x, y, z);

  // 1. Build ground plane (thin base layer under all spaces)
  buildGroundPlane(store, config, blockMap);

  // 2. Build each space
  for (const space of config.spaces) {
    buildSpace(setBlock, space, blockMap);
  }

  // 3. Build paths between spaces
  for (const path of config.paths) {
    buildPath(setBlock, path, blockMap);
  }

  // 4. Build pedestals and load artifacts
  for (const artifact of config.artifacts) {
    buildPedestal(setBlock, artifact, blockMap);
    await loadArtifact(noa, artifact);
  }

  // 5. Set spawn point above the ground level so the player doesn't clip
  const sp = config.spawn_point;
  const spawnY = sp.y + 2; // stand on floor (floor at sp.y, feet at sp.y+1 would clip)
  noa.ents.setPosition(noa.playerEntity, [sp.x, spawnY, sp.z]);

  // 6. Orient camera to look slightly downward so the world is visible on load
  noa.camera.heading = 0;
  noa.camera.pitch = -0.3;
}
