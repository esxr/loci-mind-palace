import {
  Scene,
  MeshBuilder,
  Vector3,
  StandardMaterial,
  DynamicTexture,
  Mesh,
  Color3,
  PointLight,
  SpotLight,
} from "@babylonjs/core";
import type { Space, WorldPosition, AmbientMood } from "../../shared/types";

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

  // ── Zone color wall tinting ──
  if (space.zone_color) {
    applyZoneColorTint(scene, space);
  }

  // ── Archetype-specific modifiers ──
  if (space.archetype) {
    applyArchetypeModifiers(scene, space, materials);
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

// ── Archetype Modifiers ──

/**
 * Parses a hex color string (e.g. "#ff8800") into a Color3 (0-1 range).
 */
function hexToColor3(hex: string): Color3 {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return new Color3(r, g, b);
}

/**
 * Mixes two Color3 values at a given ratio (0 = all base, 1 = all tint).
 */
function mixColor3(base: Color3, tint: Color3, ratio: number): Color3 {
  return new Color3(
    base.r * (1 - ratio) + tint.r * ratio,
    base.g * (1 - ratio) + tint.g * ratio,
    base.b * (1 - ratio) + tint.b * ratio
  );
}

/**
 * Applies zone_color tinting to wall materials at 20% blend.
 * Clones materials so other spaces sharing the same block type are unaffected.
 */
function applyZoneColorTint(scene: Scene, space: Space): void {
  const zoneColor = hexToColor3(space.zone_color);
  const meshes = scene.meshes.filter(
    (m) =>
      m.name.includes(space.id) &&
      (m.name.startsWith("wall_") || m.name.startsWith("wallseg_"))
  );
  for (const mesh of meshes) {
    if (mesh.material instanceof StandardMaterial) {
      const cloned = mesh.material.clone(
        `${mesh.material.name}_zone_${space.id}`
      );
      if (cloned instanceof StandardMaterial) {
        cloned.diffuseColor = mixColor3(cloned.diffuseColor, zoneColor, 0.2);
        mesh.material = cloned;
      }
    }
  }
}

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
      const cloned = mesh.material.clone(
        `${mesh.material.name}_tinted_${space.id}`
      );
      if (cloned instanceof StandardMaterial) {
        cloned.emissiveColor = tint.scale(0.08);
        mesh.material = cloned;
      }
    }
  }
}

/**
 * Applies diffuse color tint to wall meshes by mixing the base color with
 * the given RGB tint array at 30% blend.
 */
function applyWallDiffuseTint(
  scene: Scene,
  space: Space,
  tintRgb: [number, number, number]
): void {
  const tint = new Color3(tintRgb[0] / 255, tintRgb[1] / 255, tintRgb[2] / 255);
  const meshes = scene.meshes.filter(
    (m) =>
      m.name.includes(space.id) &&
      (m.name.startsWith("wall_") || m.name.startsWith("wallseg_"))
  );
  for (const mesh of meshes) {
    if (mesh.material instanceof StandardMaterial) {
      const cloned = mesh.material.clone(
        `${mesh.material.name}_dtint_${space.id}`
      );
      if (cloned instanceof StandardMaterial) {
        cloned.diffuseColor = mixColor3(cloned.diffuseColor, tint, 0.3);
        mesh.material = cloned;
      }
    }
  }
}

/**
 * For library archetype: extends wall height by adding additional wall boxes
 * on top of existing walls. Makes the room feel taller.
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
  frontExt.position = new Vector3(
    centerX,
    baseY + extraHeight / 2,
    position.z + depth
  );
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
  rightExt.position = new Vector3(
    position.x + width,
    baseY + extraHeight / 2,
    centerZ
  );
  rightExt.material = wallMat;
  rightExt.checkCollisions = true;
}

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

/**
 * Darkens wall diffuseColor by the given factor (0.5 = 50% brightness).
 */
function darkenWalls(scene: Scene, space: Space, factor: number): void {
  const meshes = scene.meshes.filter(
    (m) =>
      m.name.includes(space.id) &&
      (m.name.startsWith("wall_") || m.name.startsWith("wallseg_"))
  );
  for (const mesh of meshes) {
    if (mesh.material instanceof StandardMaterial) {
      const cloned = mesh.material.clone(
        `${mesh.material.name}_dark_${space.id}`
      );
      if (cloned instanceof StandardMaterial) {
        cloned.diffuseColor = cloned.diffuseColor.scale(factor);
        mesh.material = cloned;
      }
    }
  }
}

/**
 * Adds 4 downward-facing spotlights evenly spaced along the longer axis
 * of the gallery room, creating pools of light for display cases.
 */
function addGallerySpotlights(scene: Scene, space: Space): void {
  const { position, size } = space;
  const centerZ = position.z + size.depth / 2;
  const centerX = position.x + size.width / 2;
  const spotY = position.y + size.height - 0.5;
  const spotCount = Math.min(6, Math.max(4, Math.floor(Math.max(size.width, size.depth) / 3)));

  // Determine whether to distribute along X or Z based on which axis is longer
  const alongX = size.width >= size.depth;

  for (let i = 0; i < spotCount; i++) {
    const t = (i + 0.5) / spotCount;
    const spotX = alongX ? position.x + size.width * t : centerX;
    const spotZ = alongX ? centerZ : position.z + size.depth * t;

    const spot = new SpotLight(
      `gallerySpot_${space.id}_${i}`,
      new Vector3(spotX, spotY, spotZ),
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

/**
 * Adds accent PointLights at cardinal positions around the space perimeter.
 */
function addAccentLights(
  scene: Scene,
  space: Space,
  count: number,
  intensity: number,
  range: number,
  color: Color3
): void {
  const { position, size } = space;
  const centerX = position.x + size.width / 2;
  const centerZ = position.z + size.depth / 2;
  const lightY = position.y + size.height * 0.7;
  const rx = size.width / 2 - 1;
  const rz = size.depth / 2 - 1;

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const lx = centerX + Math.cos(angle) * rx;
    const lz = centerZ + Math.sin(angle) * rz;

    const light = new PointLight(
      `accent_${space.id}_${i}`,
      new Vector3(lx, lightY, lz),
      scene
    );
    light.intensity = intensity;
    light.diffuse = color;
    light.range = range;
  }
}

/**
 * Applies a green tint to the floor material for garden spaces.
 */
function applyFloorGreenTint(scene: Scene, space: Space): void {
  const floorMesh = scene.meshes.find(
    (m) => m.name === `floor_${space.id}`
  );
  if (floorMesh && floorMesh.material instanceof StandardMaterial) {
    const cloned = floorMesh.material.clone(
      `${floorMesh.material.name}_green_${space.id}`
    );
    if (cloned instanceof StandardMaterial) {
      const greenTint = new Color3(0.2, 0.8, 0.2);
      cloned.diffuseColor = mixColor3(cloned.diffuseColor, greenTint, 0.35);
      floorMesh.material = cloned;
    }
  }
}

/**
 * Adds a semi-transparent green-tinted ground plane for garden ambiance.
 */
function addGardenGroundFog(scene: Scene, space: Space): void {
  const { position, size } = space;
  const centerX = position.x + size.width / 2;
  const centerZ = position.z + size.depth / 2;

  const fogPlane = MeshBuilder.CreatePlane(
    `gardenFog_${space.id}`,
    { width: size.width, height: size.depth },
    scene
  );
  fogPlane.rotation.x = Math.PI / 2;
  fogPlane.position = new Vector3(centerX, position.y + 0.1, centerZ);

  const fogMat = new StandardMaterial(`gardenFogMat_${space.id}`, scene);
  fogMat.diffuseColor = new Color3(0.3, 0.7, 0.3);
  fogMat.emissiveColor = new Color3(0.1, 0.25, 0.1);
  fogMat.alpha = 0.15;
  fogMat.backFaceCulling = false;
  fogMat.disableLighting = true;
  fogPlane.material = fogMat;
}

/**
 * Returns a lighting intensity multiplier based on the ambient mood.
 * serene=soft, energetic=bright, mysterious=dim, clinical=bright, warm=medium
 */
function getMoodLightingFactor(mood: AmbientMood): {
  intensityMul: number;
  color: Color3;
} {
  switch (mood) {
    case "serene":
      return { intensityMul: 0.7, color: new Color3(0.9, 0.92, 1.0) };
    case "energetic":
      return { intensityMul: 1.3, color: new Color3(1.0, 1.0, 0.95) };
    case "mysterious":
      return { intensityMul: 0.5, color: new Color3(0.7, 0.7, 0.9) };
    case "clinical":
      return { intensityMul: 1.2, color: new Color3(0.95, 0.97, 1.0) };
    case "warm":
      return { intensityMul: 0.9, color: new Color3(1.0, 0.9, 0.75) };
    default:
      return { intensityMul: 1.0, color: new Color3(1.0, 1.0, 1.0) };
  }
}

/**
 * Applies mood-based ambient lighting to a space by adding a central PointLight
 * whose intensity and color are modulated by the space's ambient_mood.
 */
function applyMoodLighting(scene: Scene, space: Space): void {
  const { position, size, ambient_mood } = space;
  const centerX = position.x + size.width / 2;
  const centerZ = position.z + size.depth / 2;
  const lightY = position.y + size.height * 0.8;
  const mood = getMoodLightingFactor(ambient_mood);

  const light = new PointLight(
    `moodLight_${space.id}`,
    new Vector3(centerX, lightY, centerZ),
    scene
  );
  light.intensity = 0.3 * mood.intensityMul;
  light.diffuse = mood.color;
  light.range = Math.max(size.width, size.depth) * 0.8;
}

/**
 * Main archetype modifier dispatcher.
 * Called at the end of buildSpace after base construction completes.
 */
function applyArchetypeModifiers(
  scene: Scene,
  space: Space,
  materials: Map<string, StandardMaterial>
): void {
  const { archetype } = space;

  switch (archetype) {
    case "laboratory":
      // Cool metallic emissive tint
      applyWallTint(scene, space, new Color3(0.8, 0.85, 0.9));
      // Diffuse tint slightly blue-white
      applyWallDiffuseTint(scene, space, [200, 210, 220]);
      // 2 extra PointLights for bright, clinical feel
      addAccentLights(
        scene,
        space,
        2,
        0.4,
        6,
        new Color3(0.9, 0.93, 1.0)
      );
      break;

    case "library":
      // Tall ceiling: add additional wall height extensions (50%)
      addWallExtensions(scene, space, materials, space.size.height * 0.5);
      // Warm parchment emissive tint
      applyWallTint(scene, space, new Color3(0.9, 0.8, 0.6));
      // Warm brown diffuse tint
      applyWallDiffuseTint(scene, space, [140, 100, 60]);
      // Reduce ambient light for cozy feel (dimmer mood light)
      {
        const { position, size } = space;
        const light = new PointLight(
          `libraryAmbient_${space.id}`,
          new Vector3(
            position.x + size.width / 2,
            position.y + size.height * 0.7,
            position.z + size.depth / 2
          ),
          scene
        );
        light.intensity = 0.2;
        light.diffuse = new Color3(1.0, 0.85, 0.6);
        light.range = Math.max(size.width, size.depth) * 0.6;
      }
      break;

    case "garden":
      // Green emissive tint on walls
      applyWallTint(scene, space, new Color3(0.5, 0.8, 0.4));
      // Vivid green floor tint
      applyFloorGreenTint(scene, space);
      // If shape is organic, replace floor with disc
      if (space.shape === "organic") {
        // Remove the existing box floor and replace with disc
        const existingFloor = scene.meshes.find(
          (m) => m.name === `floor_${space.id}`
        );
        if (existingFloor) {
          existingFloor.dispose();
          const radius = Math.min(space.size.width, space.size.depth) / 2;
          const disc = MeshBuilder.CreateDisc(
            `floor_${space.id}`,
            { radius, tessellation: 48 },
            scene
          );
          disc.rotation.x = Math.PI / 2;
          disc.position = new Vector3(
            space.position.x + space.size.width / 2,
            space.position.y + 0.01,
            space.position.z + space.size.depth / 2
          );
          const floorMat = materials.get(space.floor_block);
          if (floorMat) {
            const greenFloorMat = floorMat.clone(`gardenDisc_${space.id}`);
            if (greenFloorMat instanceof StandardMaterial) {
              greenFloorMat.diffuseColor = mixColor3(
                greenFloorMat.diffuseColor,
                new Color3(0.2, 0.8, 0.2),
                0.35
              );
            }
            disc.material = greenFloorMat;
          }
          disc.checkCollisions = true;
        }
      }
      // Green fog tint near ground
      addGardenGroundFog(scene, space);
      break;

    case "amphitheater":
      // Tiered floor: 3 concentric box rings
      addTieredFloor(scene, space, materials);
      // 4 accent lights at cardinal positions
      addAccentLights(
        scene,
        space,
        4,
        0.5,
        8,
        new Color3(1.0, 0.95, 0.85)
      );
      break;

    case "observatory":
      // Dome ceiling (hemisphere)
      addDomeCeiling(scene, space, materials);
      // Dark wall materials (reduce brightness by 50%)
      darkenWalls(scene, space, 0.5);
      // Accent point lights for dramatic feel
      addAccentLights(
        scene,
        space,
        3,
        0.4,
        6,
        new Color3(0.6, 0.6, 0.9)
      );
      break;

    case "workshop":
      // Warm emissive tint
      applyWallTint(scene, space, new Color3(0.85, 0.75, 0.6));
      // Warm diffuse tint
      applyWallDiffuseTint(scene, space, [160, 120, 80]);
      // 2 point lights with warm orange color
      addAccentLights(
        scene,
        space,
        2,
        0.45,
        6,
        new Color3(1.0, 0.8, 0.5)
      );
      break;

    case "gallery":
      // Spot-like lights along walls for display illumination
      addGallerySpotlights(scene, space);
      break;

    case "chamber":
      // Reduce lighting intensity by 30% for intimate feel (dim mood light)
      {
        const { position, size } = space;
        const light = new PointLight(
          `chamberAmbient_${space.id}`,
          new Vector3(
            position.x + size.width / 2,
            position.y + size.height * 0.6,
            position.z + size.depth / 2
          ),
          scene
        );
        light.intensity = 0.15;
        light.diffuse = new Color3(1.0, 0.9, 0.75);
        light.range = Math.max(size.width, size.depth) * 0.5;
      }
      // Warm tint + dark purple emissive
      applyWallTint(scene, space, new Color3(0.4, 0.35, 0.5));
      applyWallDiffuseTint(scene, space, [160, 120, 80]);
      break;
  }

  // Apply mood-based ambient lighting for all archetypes
  applyMoodLighting(scene, space);
}
