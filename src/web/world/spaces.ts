import {
  Scene,
  MeshBuilder,
  Vector3,
  StandardMaterial,
  DynamicTexture,
  Mesh,
  Color3,
} from "@babylonjs/core";
import type { Space, WorldPosition } from "../../shared/types";

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
 * Creates a floating text label above a room using DynamicTexture on a plane.
 */
function createRoomLabel(
  scene: Scene,
  text: string,
  position: Vector3
): void {
  const planeWidth = Math.max(3, text.length * 0.4);
  const planeHeight = 0.6;

  const plane = MeshBuilder.CreatePlane(
    `label_${text}`,
    { width: planeWidth, height: planeHeight },
    scene
  );
  plane.position = position;
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;

  // DynamicTexture for text rendering
  const texResolution = 512;
  const dt = new DynamicTexture(`dt_${text}`, texResolution, scene, false);
  dt.hasAlpha = true;

  const ctx = dt.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, texResolution, texResolution);

  // Semi-transparent background pill
  const fontSize = 48;
  ctx.font = `bold ${fontSize}px Inter, Segoe UI, system-ui, sans-serif`;
  const textWidth = ctx.measureText(text).width;
  const bgPadX = 24;
  const bgPadY = 12;
  const bgX = (texResolution - textWidth) / 2 - bgPadX;
  const bgY = (texResolution - fontSize) / 2 - bgPadY;
  const bgW = textWidth + bgPadX * 2;
  const bgH = fontSize + bgPadY * 2;

  ctx.fillStyle = "rgba(10, 10, 20, 0.65)";
  const r = 12;
  ctx.beginPath();
  ctx.moveTo(bgX + r, bgY);
  ctx.lineTo(bgX + bgW - r, bgY);
  ctx.arcTo(bgX + bgW, bgY, bgX + bgW, bgY + r, r);
  ctx.lineTo(bgX + bgW, bgY + bgH - r);
  ctx.arcTo(bgX + bgW, bgY + bgH, bgX + bgW - r, bgY + bgH, r);
  ctx.lineTo(bgX + r, bgY + bgH);
  ctx.arcTo(bgX, bgY + bgH, bgX, bgY + bgH - r, r);
  ctx.lineTo(bgX, bgY + r);
  ctx.arcTo(bgX, bgY, bgX + r, bgY, r);
  ctx.closePath();
  ctx.fill();

  // Text
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, texResolution / 2, texResolution / 2);
  dt.update();

  const mat = new StandardMaterial(`labelMat_${text}`, scene);
  mat.diffuseTexture = dt;
  mat.emissiveColor = new Color3(1, 1, 1);
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.useAlphaFromDiffuseTexture = true;

  plane.material = mat;
}

/**
 * For circular/organic rooms, compute a scale factor for width/depth
 * to create interesting shapes. This preserves the overall area but
 * applies shape masking at the mesh level.
 */
function getShapeScaleForCircular(
  width: number,
  depth: number
): { useDisc: boolean } {
  // For circular rooms, we create a disc instead of a box for the floor
  return { useDisc: width > 0 && depth > 0 };
}

/**
 * Build a single space (room) from its Space configuration.
 * Creates smooth mesh-based floor, walls, optional ceiling, and a floating label.
 *
 * @param scene     Babylon.js scene
 * @param space     Space configuration from PalaceConfig
 * @param materials Map of block type IDs to StandardMaterial
 * @param conceptName Human-readable name for the room label
 * @param pathOpenings Optional array of world positions where paths connect
 */
export function buildSpace(
  scene: Scene,
  space: Space,
  materials: Map<string, StandardMaterial>,
  conceptName: string = "",
  pathOpenings: Array<{ x: number; y: number; z: number }> = []
): void {
  const { position, size, shape, floor_block, wall_block, ceiling_block, has_ceiling } =
    space;
  const { width, height, depth } = size;

  const floorMat = materials.get(floor_block);
  const wallMat = materials.get(wall_block);
  const ceilingMat = ceiling_block ? materials.get(ceiling_block) : undefined;

  const centerX = position.x + width / 2;
  const centerZ = position.z + depth / 2;
  const baseY = position.y;

  // ── Floor ──
  if (shape === "circular") {
    const radius = Math.min(width, depth) / 2;
    const disc = MeshBuilder.CreateDisc(
      `floor_${space.id}`,
      { radius, tessellation: 48 },
      scene
    );
    disc.rotation.x = Math.PI / 2;
    disc.position = new Vector3(centerX, baseY + 0.01, centerZ);
    if (floorMat) disc.material = floorMat;
    disc.checkCollisions = true;
  } else {
    const floor = MeshBuilder.CreateBox(
      `floor_${space.id}`,
      { width, height: 0.3, depth },
      scene
    );
    floor.position = new Vector3(centerX, baseY, centerZ);
    if (floorMat) floor.material = floorMat;
    floor.checkCollisions = true;
  }

  // ── Walls ──
  if (wallMat) {
    const wallThickness = 0.3;
    const wallHeight = height;

    // Determine doorway openings from path waypoints
    const doorways = findDoorways(position, size, pathOpenings);

    if (shape === "circular") {
      // For circular rooms, create a ring of wall segments
      const radius = Math.min(width, depth) / 2;
      const segments = 32;
      const segAngle = (Math.PI * 2) / segments;

      for (let i = 0; i < segments; i++) {
        const angle = i * segAngle;
        const midAngle = angle + segAngle / 2;
        const wx = centerX + Math.cos(midAngle) * radius;
        const wz = centerZ + Math.sin(midAngle) * radius;

        // Check if this segment is near a doorway
        if (isNearDoorway(wx, baseY, wz, doorways)) continue;

        const segLength = 2 * radius * Math.sin(segAngle / 2);
        const wallSeg = MeshBuilder.CreateBox(
          `wall_circ_${space.id}_${i}`,
          { width: segLength, height: wallHeight, depth: wallThickness },
          scene
        );
        wallSeg.position = new Vector3(wx, baseY + wallHeight / 2, wz);
        wallSeg.rotation.y = -midAngle + Math.PI / 2;
        wallSeg.material = wallMat;
        wallSeg.checkCollisions = true;
      }
    } else {
      // Rectangular walls — build each wall, leaving gaps for doorways
      buildRectWall(
        scene, space.id, "back",
        centerX, baseY, position.z,
        width, wallHeight, wallThickness,
        wallMat, doorways, position, size
      );
      buildRectWall(
        scene, space.id, "front",
        centerX, baseY, position.z + depth,
        width, wallHeight, wallThickness,
        wallMat, doorways, position, size
      );
      buildRectWall(
        scene, space.id, "left",
        position.x, baseY, centerZ,
        depth, wallHeight, wallThickness,
        wallMat, doorways, position, size, true
      );
      buildRectWall(
        scene, space.id, "right",
        position.x + width, baseY, centerZ,
        depth, wallHeight, wallThickness,
        wallMat, doorways, position, size, true
      );
    }
  }

  // ── Ceiling ──
  if (has_ceiling && ceilingMat) {
    const ceiling = MeshBuilder.CreateBox(
      `ceiling_${space.id}`,
      { width, height: 0.3, depth },
      scene
    );
    ceiling.position = new Vector3(centerX, baseY + height, centerZ);
    ceiling.material = ceilingMat;
  }

  // ── Room label (floating text above the room) ──
  if (conceptName) {
    const labelY = baseY + height + 1.5;
    createRoomLabel(scene, conceptName, new Vector3(centerX, labelY, centerZ));
  }
}

// ── Wall segment helpers ──

interface DoorwayInfo {
  x: number;
  y: number;
  z: number;
}

function findDoorways(
  position: WorldPosition,
  size: { width: number; height: number; depth: number },
  pathOpenings: Array<{ x: number; y: number; z: number }>
): DoorwayInfo[] {
  return pathOpenings.filter((wp) => {
    const dx = wp.x - position.x;
    const dz = wp.z - position.z;
    const margin = 3;
    return (
      dx >= -margin &&
      dx <= size.width + margin &&
      dz >= -margin &&
      dz <= size.depth + margin
    );
  });
}

function isNearDoorway(
  wx: number,
  wy: number,
  wz: number,
  doorways: DoorwayInfo[]
): boolean {
  const threshold = 2.5;
  for (const d of doorways) {
    const dx = Math.abs(wx - d.x);
    const dz = Math.abs(wz - d.z);
    if (dx <= threshold && dz <= threshold) return true;
  }
  return false;
}

/**
 * Builds a single rectangular wall for a room, splitting it into segments
 * to leave doorway openings where paths connect.
 */
function buildRectWall(
  scene: Scene,
  spaceId: string,
  side: string,
  wallCenterAxis: number,
  baseY: number,
  wallFixedAxis: number,
  wallLength: number,
  wallHeight: number,
  wallThickness: number,
  wallMat: StandardMaterial,
  doorways: DoorwayInfo[],
  position: WorldPosition,
  size: { width: number; height: number; depth: number },
  rotated: boolean = false
): void {
  // Check if any doorway intersects this wall
  const hasDoorway = doorways.some((d) => {
    if (rotated) {
      // Left/right wall: fixed axis is X, spans Z
      return Math.abs(d.x - wallFixedAxis) < 1.5;
    } else {
      // Front/back wall: fixed axis is Z, spans X
      return Math.abs(d.z - wallFixedAxis) < 1.5;
    }
  });

  if (!hasDoorway) {
    // Build a single solid wall
    const wall = MeshBuilder.CreateBox(
      `wall_${side}_${spaceId}`,
      {
        width: rotated ? wallThickness : wallLength,
        height: wallHeight,
        depth: rotated ? wallLength : wallThickness,
      },
      scene
    );
    wall.position = new Vector3(
      wallCenterAxis,
      baseY + wallHeight / 2,
      wallFixedAxis
    );
    if (rotated) {
      wall.position.x = wallFixedAxis;
      wall.position.z = wallCenterAxis;
    }
    wall.material = wallMat;
    wall.checkCollisions = true;
  } else {
    // Split wall into segments, leaving gaps at doorways
    // For simplicity, create the wall with a doorway gap of 3 units wide, 4 units tall
    const doorwayWidth = 3;
    const doorwayHeight = 4;

    // Find doorway positions along this wall
    const doorPositions: number[] = [];
    for (const d of doorways) {
      if (rotated) {
        if (Math.abs(d.x - wallFixedAxis) < 1.5) {
          doorPositions.push(d.z);
        }
      } else {
        if (Math.abs(d.z - wallFixedAxis) < 1.5) {
          doorPositions.push(d.x);
        }
      }
    }

    // Wall spans from wallCenterAxis - wallLength/2 to wallCenterAxis + wallLength/2
    const wallStart = rotated
      ? position.z
      : position.x;
    const wallEnd = rotated
      ? position.z + size.depth
      : position.x + size.width;

    // Sort door positions
    doorPositions.sort((a, b) => a - b);

    // Build segments between doorways
    let cursor = wallStart;
    for (const doorPos of doorPositions) {
      const doorStart = doorPos - doorwayWidth / 2;
      const doorEnd = doorPos + doorwayWidth / 2;

      // Segment before the door
      if (doorStart > cursor + 0.1) {
        const segLen = doorStart - cursor;
        const segCenter = (cursor + doorStart) / 2;
        createWallSegment(
          scene, spaceId, side, segCenter, baseY, wallFixedAxis,
          segLen, wallHeight, wallThickness, wallMat, rotated
        );
      }

      // Wall above doorway
      if (doorwayHeight < wallHeight) {
        const aboveHeight = wallHeight - doorwayHeight;
        createWallSegment(
          scene, spaceId, side + "_above",
          doorPos, baseY + doorwayHeight + aboveHeight / 2, wallFixedAxis,
          doorwayWidth, aboveHeight, wallThickness, wallMat, rotated,
          true // override Y position
        );
      }

      cursor = doorEnd;
    }

    // Segment after the last door
    if (cursor < wallEnd - 0.1) {
      const segLen = wallEnd - cursor;
      const segCenter = (cursor + wallEnd) / 2;
      createWallSegment(
        scene, spaceId, side, segCenter, baseY, wallFixedAxis,
        segLen, wallHeight, wallThickness, wallMat, rotated
      );
    }
  }
}

function createWallSegment(
  scene: Scene,
  spaceId: string,
  side: string,
  segCenter: number,
  baseY: number,
  wallFixedAxis: number,
  segLen: number,
  wallHeight: number,
  wallThickness: number,
  wallMat: StandardMaterial,
  rotated: boolean,
  overrideY: boolean = false
): void {
  const seg = MeshBuilder.CreateBox(
    `wallseg_${side}_${spaceId}_${Math.random().toString(36).slice(2, 6)}`,
    {
      width: rotated ? wallThickness : segLen,
      height: wallHeight,
      depth: rotated ? segLen : wallThickness,
    },
    scene
  );

  if (overrideY) {
    // Y is already set correctly
    seg.position = rotated
      ? new Vector3(wallFixedAxis, baseY, segCenter)
      : new Vector3(segCenter, baseY, wallFixedAxis);
  } else {
    seg.position = rotated
      ? new Vector3(wallFixedAxis, baseY + wallHeight / 2, segCenter)
      : new Vector3(segCenter, baseY + wallHeight / 2, wallFixedAxis);
  }

  seg.material = wallMat;
  seg.checkCollisions = true;
}
