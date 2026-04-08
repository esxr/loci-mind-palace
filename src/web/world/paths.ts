import {
  Scene,
  MeshBuilder,
  Vector3,
  StandardMaterial,
  Mesh,
} from "@babylonjs/core";
import type { Path, WorldPosition } from "../../shared/types";

/**
 * Linearly interpolate between two world positions, yielding positions
 * at approximately 1-unit spacing along the line.
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
      x: a.x + dx * t,
      y: a.y + dy * t,
      z: a.z + dz * t,
    });
  }
  return points;
}

/**
 * Compute a normalized 2D perpendicular direction (in the XZ plane) to the
 * segment from point a to point b. Used to give paths their width.
 */
function perpendicularXZ(
  a: WorldPosition,
  b: WorldPosition
): [number, number] {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.sqrt(dx * dx + dz * dz);

  if (len < 0.001) {
    return [1, 0];
  }

  return [-dz / len, dx / len];
}

/**
 * Build a path (corridor, trail, bridge, or tunnel) between two spaces
 * using smooth mesh strips.
 *
 * For each segment between consecutive waypoints, creates a floor ribbon
 * and optionally wall meshes for corridor/tunnel styles.
 *
 * @param scene     Babylon.js scene
 * @param path      Path configuration from PalaceConfig
 * @param materials Map of block type IDs to StandardMaterial
 */
export function buildPath(
  scene: Scene,
  path: Path,
  materials: Map<string, StandardMaterial>
): void {
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

    // Compute segment direction and length
    const segDx = wpB.x - wpA.x;
    const segDy = wpB.y - wpA.y;
    const segDz = wpB.z - wpA.z;
    const segLen = Math.sqrt(segDx * segDx + segDy * segDy + segDz * segDz);

    if (segLen < 0.1) continue;

    // Mid-point and angle
    const midX = (wpA.x + wpB.x) / 2;
    const midY = (wpA.y + wpB.y) / 2;
    const midZ = (wpA.z + wpB.z) / 2;
    const angle = Math.atan2(segDx, segDz);

    // ── Floor strip ──
    const floor = MeshBuilder.CreateBox(
      `pathFloor_${path.id}_${i}`,
      { width: width, height: 0.25, depth: segLen + 0.5 },
      scene
    );
    floor.position = new Vector3(midX, midY + 0.01, midZ);
    floor.rotation.y = angle;
    floor.material = floorMat;
    floor.checkCollisions = true;

    // ── Walls (corridor / tunnel) ──
    if (needsWalls && wallMat) {
      const halfWidth = width / 2 + 0.15;

      for (const side of [-1, 1]) {
        const wallOffsetX = perpX * halfWidth * side;
        const wallOffsetZ = perpZ * halfWidth * side;

        const wall = MeshBuilder.CreateBox(
          `pathWall_${path.id}_${i}_${side > 0 ? "R" : "L"}`,
          { width: 0.3, height: wallHeight, depth: segLen + 0.5 },
          scene
        );
        wall.position = new Vector3(
          midX + wallOffsetX,
          midY + wallHeight / 2,
          midZ + wallOffsetZ
        );
        wall.rotation.y = angle;
        wall.material = wallMat;
        wall.checkCollisions = true;
      }
    }

    // ── Ceiling (tunnel) ──
    if (needsCeiling && wallMat) {
      const ceiling = MeshBuilder.CreateBox(
        `pathCeil_${path.id}_${i}`,
        { width: width + 0.6, height: 0.3, depth: segLen + 0.5 },
        scene
      );
      ceiling.position = new Vector3(midX, midY + wallHeight + 0.15, midZ);
      ceiling.rotation.y = angle;
      ceiling.material = wallMat;
    }
  }
}
