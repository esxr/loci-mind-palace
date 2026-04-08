import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  Mesh,
  DynamicTexture,
} from "@babylonjs/core";
import type { PalaceConfig, Space } from "../../shared/types";

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

/**
 * Scans all paths for cross-zone connections and builds archway meshes
 * at the midpoint of each such path.
 */
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
