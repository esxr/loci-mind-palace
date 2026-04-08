import { Engine } from "noa-engine";
import type { Path, WorldPosition } from "../../shared/types";

/**
 * Linearly interpolate between two world positions, yielding every integer
 * coordinate along the line (stepping by 1 block at a time).
 */
function interpolateWaypoints(
  a: WorldPosition,
  b: WorldPosition
): WorldPosition[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const dist = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz), 1);
  const steps = Math.ceil(dist);

  const points: WorldPosition[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: Math.round(a.x + dx * t),
      y: Math.round(a.y + dy * t),
      z: Math.round(a.z + dz * t),
    });
  }
  return points;
}

/**
 * Compute a normalized 2D perpendicular direction (in the XZ plane) to the
 * segment from point a to point b. Used to give paths their width.
 * Returns [perpX, perpZ]. If the segment is vertical (no XZ movement),
 * defaults to [1, 0].
 */
function perpendicularXZ(
  a: WorldPosition,
  b: WorldPosition
): [number, number] {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.sqrt(dx * dx + dz * dz);

  if (len < 0.001) {
    // Degenerate segment (vertical only) -- pick an arbitrary perpendicular
    return [1, 0];
  }

  // Perpendicular in XZ: rotate direction 90 degrees
  return [-dz / len, dx / len];
}

/**
 * Build a path (corridor, trail, bridge, or tunnel) between two spaces.
 *
 * Iterates through path.waypoints, interpolating between consecutive points.
 * For each interpolated position, places floor blocks in a strip of the
 * configured width, and optionally walls/ceiling depending on the path style.
 *
 * Styles:
 *  - corridor: floor + walls on both sides (1 thick, 3 high) + no ceiling
 *  - trail:    floor only, open air
 *  - bridge:   floor only, elevated (same as trail but implies height change)
 *  - tunnel:   floor + walls + ceiling (fully enclosed)
 *
 * @param noa      The noa-engine instance
 * @param path     Path configuration from PalaceConfig
 * @param blockMap Map of block type IDs to noa numeric block IDs
 */
export function buildPath(
  noa: Engine,
  path: Path,
  blockMap: Map<string, number>
): void {
  const { waypoints, width, style, floor_block, wall_block } = path;

  const floorId = blockMap.get(floor_block);
  if (floorId === undefined) return;

  const wallId = wall_block ? blockMap.get(wall_block) : undefined;

  const needsWalls = style === "corridor" || style === "tunnel";
  const needsCeiling = style === "tunnel";
  const wallHeight = 3;
  const halfWidth = (width - 1) / 2;

  // Track placed positions to avoid redundant setBlock calls
  const placed = new Set<string>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const wpA = waypoints[i];
    const wpB = waypoints[i + 1];
    const points = interpolateWaypoints(wpA, wpB);
    const [perpX, perpZ] = perpendicularXZ(wpA, wpB);

    for (const pt of points) {
      // Place floor strip of given width perpendicular to the path direction
      for (let w = -Math.floor(halfWidth); w <= Math.ceil(halfWidth); w++) {
        const fx = Math.round(pt.x + perpX * w);
        const fz = Math.round(pt.z + perpZ * w);
        const floorKey = key(fx, pt.y, fz);

        if (!placed.has(floorKey)) {
          noa.setBlock(floorId, fx, pt.y, fz);
          placed.add(floorKey);
        }
      }

      // Place walls on both sides of the path strip
      if (needsWalls && wallId !== undefined) {
        for (const side of [-1, 1]) {
          const wallOffset = side * (Math.ceil(halfWidth) + 1);
          const wx = Math.round(pt.x + perpX * wallOffset);
          const wz = Math.round(pt.z + perpZ * wallOffset);

          for (let h = 1; h <= wallHeight; h++) {
            const wKey = key(wx, pt.y + h, wz);
            if (!placed.has(wKey)) {
              noa.setBlock(wallId, wx, pt.y + h, wz);
              placed.add(wKey);
            }
          }
        }
      }

      // Place ceiling for tunnel style
      if (needsCeiling && wallId !== undefined) {
        for (let w = -Math.floor(halfWidth) - 1; w <= Math.ceil(halfWidth) + 1; w++) {
          const cx = Math.round(pt.x + perpX * w);
          const cz = Math.round(pt.z + perpZ * w);
          const cKey = key(cx, pt.y + wallHeight + 1, cz);
          if (!placed.has(cKey)) {
            noa.setBlock(wallId, cx, pt.y + wallHeight + 1, cz);
            placed.add(cKey);
          }
        }
      }
    }
  }
}
