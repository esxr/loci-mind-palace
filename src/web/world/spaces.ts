import Engine from "noa-engine";
import type { Space } from "../../shared/types";

/**
 * Simple deterministic pseudo-random number generator (mulberry32).
 * Used for organic shape noise so results are reproducible per space.
 */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Determine whether a block at (localX, localZ) within a space's footprint
 * should be placed, based on the space's shape.
 *
 * localX/localZ are 0-based offsets from space.position.
 * width/depth are the space size dimensions.
 */
function isInsideShape(
  localX: number,
  localZ: number,
  width: number,
  depth: number,
  shape: Space["shape"],
  rng?: () => number
): boolean {
  switch (shape) {
    case "rectangular":
      return true;

    case "circular": {
      // Elliptical distance check (radius = half of width/depth)
      const cx = width / 2;
      const cz = depth / 2;
      const dx = (localX + 0.5 - cx) / cx;
      const dz = (localZ + 0.5 - cz) / cz;
      return dx * dx + dz * dz <= 1.0;
    }

    case "organic": {
      // Rectangular base with noisy edges: blocks near the border may be
      // randomly excluded for an irregular silhouette.
      const edgeDistX = Math.min(localX, width - 1 - localX);
      const edgeDistZ = Math.min(localZ, depth - 1 - localZ);
      const edgeDist = Math.min(edgeDistX, edgeDistZ);

      // Interior blocks (>2 from edge) are always placed
      if (edgeDist > 2) return true;

      // Edge blocks have a chance of being removed
      if (rng) {
        const keepChance = 0.4 + edgeDist * 0.25; // 0.4, 0.65, 0.9
        return rng() < keepChance;
      }
      return true;
    }

    default:
      return true;
  }
}

/**
 * Check whether a given edge block (at wall position) is near a path waypoint
 * and should be left open for doorway connectivity.
 * Returns true if the block should be SKIPPED (opening).
 */
function isNearPathOpening(
  worldX: number,
  worldY: number,
  worldZ: number,
  openings: Array<{ x: number; y: number; z: number }>
): boolean {
  const threshold = 2; // leave a 2-block wide gap around waypoints
  for (const wp of openings) {
    const dx = Math.abs(worldX - wp.x);
    const dy = Math.abs(worldY - wp.y);
    const dz = Math.abs(worldZ - wp.z);
    // Waypoint must be at roughly the same Y level and within threshold on XZ
    if (dy <= 3 && dx <= threshold && dz <= threshold) {
      return true;
    }
  }
  return false;
}

/**
 * Build a single space (room) from its Space configuration.
 *
 * - Places floor blocks across the footprint at y = position.y
 * - Places wall blocks around the perimeter, 1 block thick, full height
 * - Optionally places ceiling blocks at the top
 * - Respects shape (rectangular, circular, organic)
 * - Leaves openings near detected path waypoints for doorways
 *
 * @param noa      The noa-engine instance
 * @param space    Space configuration from PalaceConfig
 * @param blockMap Map of block type IDs to noa numeric block IDs
 * @param pathOpenings Optional array of world positions where paths connect
 *                     (near walls) so openings can be left
 */
export function buildSpace(
  noa: Engine,
  space: Space,
  blockMap: Map<string, number>,
  pathOpenings: Array<{ x: number; y: number; z: number }> = []
): void {
  const { position, size, shape, floor_block, wall_block, ceiling_block, has_ceiling } = space;
  const { width, height, depth } = size;

  const floorId = blockMap.get(floor_block);
  const wallId = blockMap.get(wall_block);
  const ceilingId = ceiling_block ? blockMap.get(ceiling_block) : undefined;

  // Seed RNG based on position for deterministic organic shapes
  const rng = mulberry32(position.x * 73856093 + position.z * 19349663 + position.y * 83492791);

  const baseX = position.x;
  const baseY = position.y;
  const baseZ = position.z;

  for (let lx = 0; lx < width; lx++) {
    for (let lz = 0; lz < depth; lz++) {
      const worldX = baseX + lx;
      const worldZ = baseZ + lz;

      // Check if this column is inside the shape
      if (!isInsideShape(lx, lz, width, depth, shape, rng)) {
        continue;
      }

      // --- Floor ---
      if (floorId !== undefined) {
        noa.setBlock(floorId, worldX, baseY, worldZ);
      }

      // --- Walls ---
      const isEdge =
        lx === 0 || lx === width - 1 || lz === 0 || lz === depth - 1;

      if (isEdge && wallId !== undefined) {
        for (let h = 1; h <= height; h++) {
          const worldY = baseY + h;
          // Leave openings for path connectivity
          if (isNearPathOpening(worldX, worldY, worldZ, pathOpenings)) {
            continue;
          }
          noa.setBlock(wallId, worldX, worldY, worldZ);
        }
      }

      // --- Ceiling ---
      if (has_ceiling && ceilingId !== undefined) {
        noa.setBlock(ceilingId, worldX, baseY + height, worldZ);
      }
    }
  }
}
