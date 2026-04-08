import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Color4,
  Vector3,
  Mesh,
  DynamicTexture,
  SpotLight,
  ParticleSystem,
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

/**
 * Identify the hub concept for each zone (highest importance) and build
 * a tall glowing beacon at its location.
 */
export function buildLandmarkBeacons(
  scene: Scene,
  config: PalaceConfig,
): Mesh[] {
  const beacons: Mesh[] = [];

  // Group spaces by zone_id, find hub (highest importance) per zone
  const zoneSpaces = new Map<number, Space[]>();
  for (const space of config.spaces) {
    if (!zoneSpaces.has(space.zone_id)) zoneSpaces.set(space.zone_id, []);
    zoneSpaces.get(space.zone_id)!.push(space);
  }

  // Concept importance lookup
  const importanceMap = new Map<string, number>();
  for (const c of config.concept_graph.concepts) {
    importanceMap.set(c.id, c.importance);
  }

  for (const [_zoneId, spaces] of zoneSpaces) {
    // Find hub: space with highest importance concept
    let hubSpace: Space | null = null;
    let maxImportance = -1;
    for (const space of spaces) {
      const imp = importanceMap.get(space.concept_id) ?? 0;
      if (imp > maxImportance) {
        maxImportance = imp;
        hubSpace = space;
      }
    }
    if (!hubSpace) continue;

    const pillar = buildSingleBeacon(scene, hubSpace);
    beacons.push(pillar);
  }

  return beacons;
}

function buildSingleBeacon(scene: Scene, hubSpace: Space): Mesh {
  const zoneColor = hexToColor3(hubSpace.zone_color);
  const { position, size } = hubSpace;

  // Beacon base position: center of the hub space, at floor level
  const cx = position.x + size.width / 2;
  const cz = position.z + size.depth / 2;
  const baseY = position.y;

  const pillarHeight = 20;
  const pillarDiameter = 1.5;
  const sphereDiameter = 3;
  const beaconId = `beacon_${hubSpace.id}`;

  // -- Tall cylindrical pillar --
  const pillar = MeshBuilder.CreateCylinder(
    `${beaconId}_pillar`,
    {
      height: pillarHeight,
      diameter: pillarDiameter,
      tessellation: 16,
    },
    scene,
  );
  const pillarMat = new StandardMaterial(`${beaconId}_pillarMat`, scene);
  pillarMat.diffuseColor = zoneColor;
  pillarMat.emissiveColor = zoneColor.scale(0.5);
  pillarMat.specularColor = new Color3(0.2, 0.2, 0.2);
  pillar.material = pillarMat;
  pillar.position = new Vector3(cx, baseY + pillarHeight / 2, cz);
  pillar.checkCollisions = true;

  // -- Glowing sphere on top --
  const sphere = MeshBuilder.CreateSphere(
    `${beaconId}_sphere`,
    { diameter: sphereDiameter, segments: 24 },
    scene,
  );
  const sphereMat = new StandardMaterial(`${beaconId}_sphereMat`, scene);
  sphereMat.diffuseColor = zoneColor;
  sphereMat.emissiveColor = zoneColor.scale(0.8);
  sphereMat.alpha = 0.6;
  sphereMat.specularColor = new Color3(0.1, 0.1, 0.1);
  sphere.material = sphereMat;
  sphere.position = new Vector3(cx, baseY + pillarHeight + sphereDiameter / 2, cz);

  // -- SpotLight pointing upward from sphere --
  const spotLight = new SpotLight(
    `${beaconId}_light`,
    new Vector3(cx, baseY + pillarHeight + sphereDiameter, cz),
    new Vector3(0, 1, 0),     // direction: straight up
    Math.PI / 6,               // angle: 30-degree cone
    2,                         // exponent
    scene,
  );
  spotLight.intensity = 1.0;
  spotLight.range = 50;
  spotLight.diffuse = zoneColor;

  // -- Particle system: upward emission from sphere --
  const ps = new ParticleSystem(`${beaconId}_particles`, 20, scene);
  ps.emitter = new Vector3(cx, baseY + pillarHeight + sphereDiameter / 2, cz);
  ps.minSize = 0.08;
  ps.maxSize = 0.2;
  ps.minLifeTime = 1.5;
  ps.maxLifeTime = 2.5;
  ps.emitRate = 12;
  ps.direction1 = new Vector3(-0.1, 1.0, -0.1);
  ps.direction2 = new Vector3(0.1, 2.0, 0.1);
  ps.gravity = new Vector3(0, 0.1, 0);  // slight upward drift
  ps.color1 = new Color4(zoneColor.r, zoneColor.g, zoneColor.b, 1.0);
  ps.color2 = new Color4(zoneColor.r, zoneColor.g, zoneColor.b, 0.6);
  ps.colorDead = new Color4(zoneColor.r, zoneColor.g, zoneColor.b, 0.0);
  ps.createPointEmitter(
    new Vector3(-0.3, 0, -0.3),
    new Vector3(0.3, 0.5, 0.3),
  );
  ps.start();

  return pillar;
}
