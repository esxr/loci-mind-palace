import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  Mesh,
  PointLight,
  DynamicTexture,
} from "@babylonjs/core";
import type { Space } from "../../shared/types";

// ─── Position Utilities ───

interface PropPosition {
  x: number;
  y: number;
  z: number;
}

/**
 * Computes key placement positions within a room.
 */
function getRoomPositions(space: Space): {
  center: PropPosition;
  corners: PropPosition[];
  wallMidpoints: PropPosition[];
} {
  const { position, size } = space;
  const inset = 1.5; // Distance inset from walls

  const center: PropPosition = {
    x: position.x + size.width / 2,
    y: position.y + 0.15, // Slightly above floor
    z: position.z + size.depth / 2,
  };

  const corners: PropPosition[] = [
    { x: position.x + inset, y: position.y + 0.15, z: position.z + inset },
    { x: position.x + size.width - inset, y: position.y + 0.15, z: position.z + inset },
    { x: position.x + inset, y: position.y + 0.15, z: position.z + size.depth - inset },
    { x: position.x + size.width - inset, y: position.y + 0.15, z: position.z + size.depth - inset },
  ];

  const wallMidpoints: PropPosition[] = [
    // Left wall midpoint
    { x: position.x + inset, y: position.y + 0.15, z: position.z + size.depth / 2 },
    // Right wall midpoint
    { x: position.x + size.width - inset, y: position.y + 0.15, z: position.z + size.depth / 2 },
    // Back wall midpoint
    { x: position.x + size.width / 2, y: position.y + 0.15, z: position.z + inset },
    // Front wall midpoint
    { x: position.x + size.width / 2, y: position.y + 0.15, z: position.z + size.depth - inset },
  ];

  return { center, corners, wallMidpoints };
}

/**
 * Generates scattered positions within the room for organic placement.
 * Uses deterministic pseudo-random based on space id hash.
 */
function getScatteredPositions(space: Space, count: number): PropPosition[] {
  const { position, size } = space;
  const inset = 2.0;
  let hash = 0;
  for (let i = 0; i < space.id.length; i++) {
    hash = ((hash << 5) - hash + space.id.charCodeAt(i)) | 0;
  }
  // Mulberry32 PRNG
  let s = Math.abs(hash);
  const rand = (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const positions: PropPosition[] = [];
  for (let i = 0; i < count; i++) {
    positions.push({
      x: position.x + inset + rand() * (size.width - inset * 2),
      y: position.y + 0.15,
      z: position.z + inset + rand() * (size.depth - inset * 2),
    });
  }
  return positions;
}

// ─── Prop Generator Functions ───

/**
 * A simple table: flat box top on 4 thin cylinder legs.
 * Dimensions: 2.0 wide x 0.8 tall x 1.0 deep.
 */
function createTable(scene: Scene, pos: PropPosition, id: string): Mesh {
  const parent = new Mesh(`table_${id}`, scene);

  const topWidth = 2.0;
  const topDepth = 1.0;
  const topThickness = 0.1;
  const legHeight = 0.7;
  const legDiameter = 0.08;

  // Table top
  const top = MeshBuilder.CreateBox(
    `tableTop_${id}`,
    { width: topWidth, height: topThickness, depth: topDepth },
    scene
  );
  top.position.y = legHeight + topThickness / 2;
  top.parent = parent;

  const tableMat = new StandardMaterial(`tableMat_${id}`, scene);
  tableMat.diffuseColor = new Color3(0.45, 0.3, 0.15); // Wood brown
  tableMat.specularColor = new Color3(0.1, 0.1, 0.1);
  top.material = tableMat;

  // 4 Legs
  const legOffsets = [
    [-topWidth / 2 + 0.1, -topDepth / 2 + 0.1],
    [topWidth / 2 - 0.1, -topDepth / 2 + 0.1],
    [-topWidth / 2 + 0.1, topDepth / 2 - 0.1],
    [topWidth / 2 - 0.1, topDepth / 2 - 0.1],
  ];
  for (let i = 0; i < 4; i++) {
    const leg = MeshBuilder.CreateCylinder(
      `tableLeg_${id}_${i}`,
      { height: legHeight, diameter: legDiameter, tessellation: 8 },
      scene
    );
    leg.position = new Vector3(legOffsets[i][0], legHeight / 2, legOffsets[i][1]);
    leg.material = tableMat;
    leg.parent = parent;
  }

  parent.position = new Vector3(pos.x, pos.y, pos.z);
  return parent;
}

/**
 * A laboratory beaker: thin cylinder body with a small sphere on top (liquid meniscus).
 * Dimensions: 0.15 diameter x 0.4 tall.
 */
function createBeaker(scene: Scene, pos: PropPosition, id: string): Mesh {
  const parent = new Mesh(`beaker_${id}`, scene);

  // Glass body
  const body = MeshBuilder.CreateCylinder(
    `beakerBody_${id}`,
    { height: 0.35, diameterTop: 0.18, diameterBottom: 0.14, tessellation: 12 },
    scene
  );
  body.position.y = 0.175;
  body.parent = parent;

  const glassMat = new StandardMaterial(`glassMat_${id}`, scene);
  glassMat.diffuseColor = new Color3(0.7, 0.85, 0.95);
  glassMat.alpha = 0.5;
  glassMat.specularColor = new Color3(0.5, 0.5, 0.5);
  glassMat.specularPower = 64;
  body.material = glassMat;

  // Liquid top
  const liquid = MeshBuilder.CreateSphere(
    `beakerLiquid_${id}`,
    { diameter: 0.14, segments: 8 },
    scene
  );
  liquid.position.y = 0.3;
  liquid.scaling.y = 0.3; // Flatten into disc
  liquid.parent = parent;

  const liquidMat = new StandardMaterial(`liquidMat_${id}`, scene);
  liquidMat.diffuseColor = new Color3(0.2, 0.8, 0.4); // Green liquid
  liquidMat.emissiveColor = new Color3(0.05, 0.2, 0.1);
  liquidMat.alpha = 0.7;
  liquid.material = liquidMat;

  parent.position = new Vector3(pos.x, pos.y, pos.z);
  return parent;
}

/**
 * A bookshelf: box frame with 3 shelves and colored box "books" on each shelf.
 * Dimensions: 2.0 wide x 2.5 tall x 0.5 deep.
 */
function createBookshelf(scene: Scene, pos: PropPosition, id: string): Mesh {
  const parent = new Mesh(`bookshelf_${id}`, scene);
  const shelfWidth = 2.0;
  const shelfHeight = 2.5;
  const shelfDepth = 0.5;

  const woodMat = new StandardMaterial(`shelfWood_${id}`, scene);
  woodMat.diffuseColor = new Color3(0.4, 0.25, 0.12);
  woodMat.specularColor = new Color3(0.05, 0.05, 0.05);

  // Back panel
  const back = MeshBuilder.CreateBox(
    `shelfBack_${id}`,
    { width: shelfWidth, height: shelfHeight, depth: 0.05 },
    scene
  );
  back.position = new Vector3(0, shelfHeight / 2, shelfDepth / 2 - 0.025);
  back.material = woodMat;
  back.parent = parent;

  // 4 horizontal shelves (bottom, 3 intermediate)
  for (let s = 0; s < 4; s++) {
    const shelf = MeshBuilder.CreateBox(
      `shelfPlank_${id}_${s}`,
      { width: shelfWidth, height: 0.06, depth: shelfDepth },
      scene
    );
    shelf.position = new Vector3(0, s * (shelfHeight / 3.5) + 0.03, 0);
    shelf.material = woodMat;
    shelf.parent = parent;
  }

  // Books on each of 3 shelves (skip bottom shelf as it's at floor level)
  const bookColors = [
    new Color3(0.7, 0.15, 0.1),  // Red
    new Color3(0.1, 0.3, 0.7),   // Blue
    new Color3(0.1, 0.6, 0.2),   // Green
    new Color3(0.6, 0.5, 0.1),   // Gold
    new Color3(0.5, 0.1, 0.5),   // Purple
  ];

  for (let s = 1; s < 4; s++) {
    const shelfY = s * (shelfHeight / 3.5) + 0.06;
    const numBooks = 4 + (s % 2); // 4 or 5 books per shelf
    for (let b = 0; b < numBooks; b++) {
      const bookWidth = 0.15 + Math.random() * 0.1;
      const bookHeight = 0.35 + Math.random() * 0.25;
      const book = MeshBuilder.CreateBox(
        `book_${id}_${s}_${b}`,
        { width: bookWidth, height: bookHeight, depth: shelfDepth * 0.85 },
        scene
      );
      book.position = new Vector3(
        -shelfWidth / 2 + 0.2 + b * 0.35,
        shelfY + bookHeight / 2,
        0
      );
      const bookMat = new StandardMaterial(`bookMat_${id}_${s}_${b}`, scene);
      bookMat.diffuseColor = bookColors[(s * 5 + b) % bookColors.length];
      bookMat.specularColor = new Color3(0.05, 0.05, 0.05);
      book.material = bookMat;
      book.parent = parent;
    }
  }

  parent.position = new Vector3(pos.x, pos.y, pos.z);
  parent.checkCollisions = true;
  return parent;
}

/**
 * A simple bench: flat box seat on two box supports.
 * Dimensions: 1.5 wide x 0.5 tall x 0.5 deep.
 */
function createBench(scene: Scene, pos: PropPosition, id: string): Mesh {
  const parent = new Mesh(`bench_${id}`, scene);

  const benchMat = new StandardMaterial(`benchMat_${id}`, scene);
  benchMat.diffuseColor = new Color3(0.5, 0.35, 0.2);
  benchMat.specularColor = new Color3(0.05, 0.05, 0.05);

  // Seat
  const seat = MeshBuilder.CreateBox(
    `benchSeat_${id}`,
    { width: 1.5, height: 0.08, depth: 0.5 },
    scene
  );
  seat.position.y = 0.45;
  seat.material = benchMat;
  seat.parent = parent;

  // Two supports
  for (const offset of [-0.55, 0.55]) {
    const support = MeshBuilder.CreateBox(
      `benchSupport_${id}_${offset}`,
      { width: 0.12, height: 0.44, depth: 0.45 },
      scene
    );
    support.position = new Vector3(offset, 0.22, 0);
    support.material = benchMat;
    support.parent = parent;
  }

  parent.position = new Vector3(pos.x, pos.y, pos.z);
  parent.checkCollisions = true;
  return parent;
}

/**
 * A wall torch: cylinder handle + point light + simple fire particle emitter.
 * The PointLight provides actual scene illumination (range=8, intensity=0.5).
 */
function createTorch(scene: Scene, pos: PropPosition, id: string): Mesh {
  const parent = new Mesh(`torch_${id}`, scene);

  // Handle
  const handle = MeshBuilder.CreateCylinder(
    `torchHandle_${id}`,
    { height: 0.6, diameter: 0.1, tessellation: 8 },
    scene
  );
  handle.position.y = 1.8; // Mount at roughly eye level
  handle.parent = parent;

  const handleMat = new StandardMaterial(`torchHandleMat_${id}`, scene);
  handleMat.diffuseColor = new Color3(0.3, 0.2, 0.1);
  handle.material = handleMat;

  // Flame (emissive sphere)
  const flame = MeshBuilder.CreateSphere(
    `torchFlame_${id}`,
    { diameter: 0.2, segments: 8 },
    scene
  );
  flame.position.y = 2.15;
  flame.parent = parent;

  const flameMat = new StandardMaterial(`torchFlameMat_${id}`, scene);
  flameMat.diffuseColor = new Color3(1.0, 0.6, 0.1);
  flameMat.emissiveColor = new Color3(1.0, 0.5, 0.0);
  flameMat.disableLighting = true;
  flame.material = flameMat;

  // Point light
  const light = new PointLight(
    `torchLight_${id}`,
    new Vector3(pos.x, pos.y + 2.2, pos.z),
    scene
  );
  light.intensity = 0.5;
  light.range = 8;
  light.diffuse = new Color3(1.0, 0.8, 0.4);

  // Flicker animation
  const baseIntensity = 0.5;
  scene.registerBeforeRender(() => {
    if (!light.isDisposed()) {
      light.intensity = baseIntensity + Math.sin(Date.now() / 200) * 0.1
        + Math.sin(Date.now() / 130) * 0.05;
    }
  });

  parent.position = new Vector3(pos.x, pos.y, pos.z);
  return parent;
}

/**
 * A presentation podium: tapered cylinder.
 * Dimensions: 0.6 diameter bottom, 0.4 diameter top, 1.0 tall.
 */
function createPodium(scene: Scene, pos: PropPosition, id: string): Mesh {
  const podium = MeshBuilder.CreateCylinder(
    `podium_${id}`,
    { height: 1.0, diameterTop: 0.4, diameterBottom: 0.6, tessellation: 16 },
    scene
  );
  podium.position = new Vector3(pos.x, pos.y + 0.5, pos.z);

  const mat = new StandardMaterial(`podiumMat_${id}`, scene);
  mat.diffuseColor = new Color3(0.35, 0.25, 0.18);
  mat.specularColor = new Color3(0.15, 0.15, 0.15);
  mat.specularPower = 16;
  podium.material = mat;
  podium.checkCollisions = true;

  return podium;
}

/**
 * A hanging banner: vertical plane with colored material.
 * Dimensions: 0.8 wide x 2.0 tall.
 */
function createBanner(
  scene: Scene,
  pos: PropPosition,
  id: string,
  color?: Color3
): Mesh {
  const banner = MeshBuilder.CreatePlane(
    `banner_${id}`,
    { width: 0.8, height: 2.0 },
    scene
  );
  banner.position = new Vector3(pos.x, pos.y + 2.5, pos.z);

  const mat = new StandardMaterial(`bannerMat_${id}`, scene);
  mat.diffuseColor = color || new Color3(0.6, 0.15, 0.15); // Default: deep red
  mat.emissiveColor = (color || new Color3(0.6, 0.15, 0.15)).scale(0.1);
  mat.backFaceCulling = false;
  banner.material = mat;

  return banner;
}

/**
 * A transparent display case: glass box with subtle emissive edge.
 * Dimensions: 0.8 x 0.8 x 0.8 cube.
 */
function createDisplayCase(scene: Scene, pos: PropPosition, id: string): Mesh {
  const caseBox = MeshBuilder.CreateBox(
    `displayCase_${id}`,
    { width: 0.8, height: 0.8, depth: 0.8 },
    scene
  );
  caseBox.position = new Vector3(pos.x, pos.y + 0.8, pos.z); // On a pedestal height

  const glassMat = new StandardMaterial(`caseMat_${id}`, scene);
  glassMat.diffuseColor = new Color3(0.85, 0.9, 0.95);
  glassMat.alpha = 0.2;
  glassMat.specularColor = new Color3(0.6, 0.6, 0.6);
  glassMat.specularPower = 128;
  glassMat.emissiveColor = new Color3(0.05, 0.05, 0.08);
  glassMat.backFaceCulling = false;
  caseBox.material = glassMat;

  // Small pedestal beneath the case
  const pedestal = MeshBuilder.CreateBox(
    `casePedestal_${id}`,
    { width: 0.9, height: 0.6, depth: 0.9 },
    scene
  );
  pedestal.position = new Vector3(pos.x, pos.y + 0.3, pos.z);
  const pedMat = new StandardMaterial(`casePedMat_${id}`, scene);
  pedMat.diffuseColor = new Color3(0.25, 0.25, 0.3);
  pedestal.material = pedMat;
  pedestal.checkCollisions = true;

  return caseBox;
}

/**
 * A telescope: tilted cylinder body + small cylinder eyepiece.
 * Body: 1.2 long, 0.15 diameter. Eyepiece: 0.3 long, 0.1 diameter.
 */
function createTelescope(scene: Scene, pos: PropPosition, id: string): Mesh {
  const parent = new Mesh(`telescope_${id}`, scene);

  const metalMat = new StandardMaterial(`telescopeMat_${id}`, scene);
  metalMat.diffuseColor = new Color3(0.5, 0.5, 0.55);
  metalMat.specularColor = new Color3(0.4, 0.4, 0.4);
  metalMat.specularPower = 64;

  // Main tube (tilted 30 degrees upward)
  const tube = MeshBuilder.CreateCylinder(
    `telescopeTube_${id}`,
    { height: 1.2, diameter: 0.15, tessellation: 12 },
    scene
  );
  tube.rotation.x = -Math.PI / 6; // 30 degrees upward tilt
  tube.position.y = 1.2;
  tube.material = metalMat;
  tube.parent = parent;

  // Eyepiece (small cylinder at the base end)
  const eyepiece = MeshBuilder.CreateCylinder(
    `telescopeEyepiece_${id}`,
    { height: 0.3, diameter: 0.1, tessellation: 8 },
    scene
  );
  eyepiece.rotation.z = Math.PI / 2; // Perpendicular
  eyepiece.position = new Vector3(0, 0.95, 0.25);
  eyepiece.material = metalMat;
  eyepiece.parent = parent;

  // Tripod legs (3 thin cylinders)
  for (let i = 0; i < 3; i++) {
    const angle = (i * 2 * Math.PI) / 3;
    const leg = MeshBuilder.CreateCylinder(
      `telescopeLeg_${id}_${i}`,
      { height: 1.0, diameter: 0.04, tessellation: 6 },
      scene
    );
    leg.position = new Vector3(
      Math.cos(angle) * 0.25,
      0.5,
      Math.sin(angle) * 0.25
    );
    leg.rotation.x = Math.cos(angle) * 0.15;
    leg.rotation.z = Math.sin(angle) * 0.15;
    leg.material = metalMat;
    leg.parent = parent;
  }

  parent.position = new Vector3(pos.x, pos.y, pos.z);
  parent.checkCollisions = true;
  return parent;
}

/**
 * A decorative gear: torus mesh lying flat.
 * Dimensions: 0.5 diameter, 0.08 tube thickness.
 */
function createGear(scene: Scene, pos: PropPosition, id: string): Mesh {
  const gear = MeshBuilder.CreateTorus(
    `gear_${id}`,
    { diameter: 0.5, thickness: 0.08, tessellation: 24 },
    scene
  );
  gear.position = new Vector3(pos.x, pos.y + 0.85, pos.z); // Resting on table height

  const mat = new StandardMaterial(`gearMat_${id}`, scene);
  mat.diffuseColor = new Color3(0.55, 0.5, 0.35); // Brass
  mat.specularColor = new Color3(0.3, 0.3, 0.2);
  mat.specularPower = 32;
  gear.material = mat;

  // Slow spin
  scene.registerBeforeRender(() => {
    if (!gear.isDisposed()) {
      gear.rotation.y += 0.003;
    }
  });

  return gear;
}

/**
 * A vine-covered pillar: cylinder with green tint.
 * Dimensions: 0.3 diameter x 3.0 tall.
 */
function createVinePillar(scene: Scene, pos: PropPosition, id: string): Mesh {
  const pillar = MeshBuilder.CreateCylinder(
    `vinePillar_${id}`,
    { height: 3.0, diameter: 0.3, tessellation: 12 },
    scene
  );
  pillar.position = new Vector3(pos.x, pos.y + 1.5, pos.z);

  const mat = new StandardMaterial(`vinePillarMat_${id}`, scene);
  mat.diffuseColor = new Color3(0.3, 0.55, 0.2); // Green-brown
  mat.emissiveColor = new Color3(0.02, 0.06, 0.01);
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  pillar.material = mat;
  pillar.checkCollisions = true;

  return pillar;
}

/**
 * A cluster of flower spheres in random colors, arranged in a small group.
 * 3-5 small spheres clustered together.
 */
function createFlowerCluster(scene: Scene, pos: PropPosition, id: string): Mesh {
  const parent = new Mesh(`flowers_${id}`, scene);

  const flowerColors = [
    new Color3(0.9, 0.2, 0.3),   // Pink
    new Color3(0.95, 0.8, 0.1),  // Yellow
    new Color3(0.6, 0.2, 0.8),   // Purple
    new Color3(1.0, 0.5, 0.2),   // Orange
    new Color3(0.9, 0.9, 0.95),  // White
  ];

  const count = 3 + Math.floor(Math.abs(id.charCodeAt(0) % 3)); // 3-5 flowers
  for (let i = 0; i < count; i++) {
    const flower = MeshBuilder.CreateSphere(
      `flower_${id}_${i}`,
      { diameter: 0.2 + (i % 2) * 0.08, segments: 8 },
      scene
    );
    const angle = (i / count) * Math.PI * 2;
    const radius = 0.15 + (i % 2) * 0.1;
    flower.position = new Vector3(
      Math.cos(angle) * radius,
      0.15 + i * 0.02,
      Math.sin(angle) * radius
    );
    flower.parent = parent;

    const mat = new StandardMaterial(`flowerMat_${id}_${i}`, scene);
    mat.diffuseColor = flowerColors[i % flowerColors.length];
    mat.emissiveColor = flowerColors[i % flowerColors.length].scale(0.15);
    flower.material = mat;

    // Stem
    const stem = MeshBuilder.CreateCylinder(
      `stem_${id}_${i}`,
      { height: 0.15, diameter: 0.03, tessellation: 6 },
      scene
    );
    stem.position = new Vector3(
      Math.cos(angle) * radius,
      0.075,
      Math.sin(angle) * radius
    );
    stem.parent = parent;

    const stemMat = new StandardMaterial(`stemMat_${id}_${i}`, scene);
    stemMat.diffuseColor = new Color3(0.2, 0.5, 0.15);
    stem.material = stemMat;
  }

  parent.position = new Vector3(pos.x, pos.y, pos.z);
  return parent;
}

/**
 * A hanging lantern: small box frame with a point light inside.
 * Dimensions: 0.25 x 0.35 x 0.25.
 */
export function createLantern(scene: Scene, pos: PropPosition, id: string): Mesh {
  const parent = new Mesh(`lantern_${id}`, scene);

  const frame = MeshBuilder.CreateBox(
    `lanternFrame_${id}`,
    { width: 0.25, height: 0.35, depth: 0.25 },
    scene
  );
  frame.position.y = 2.8; // Hanging height
  frame.parent = parent;

  const frameMat = new StandardMaterial(`lanternFrameMat_${id}`, scene);
  frameMat.diffuseColor = new Color3(0.2, 0.2, 0.22);
  frameMat.alpha = 0.6;
  frameMat.emissiveColor = new Color3(0.4, 0.3, 0.1);
  frameMat.backFaceCulling = false;
  frame.material = frameMat;

  // Inner glow sphere
  const glow = MeshBuilder.CreateSphere(
    `lanternGlow_${id}`,
    { diameter: 0.15, segments: 8 },
    scene
  );
  glow.position.y = 2.8;
  glow.parent = parent;

  const glowMat = new StandardMaterial(`lanternGlowMat_${id}`, scene);
  glowMat.diffuseColor = new Color3(1.0, 0.85, 0.4);
  glowMat.emissiveColor = new Color3(1.0, 0.7, 0.3);
  glowMat.disableLighting = true;
  glow.material = glowMat;

  // Point light
  const light = new PointLight(
    `lanternLight_${id}`,
    new Vector3(pos.x, pos.y + 2.8, pos.z),
    scene
  );
  light.intensity = 0.4;
  light.range = 6;
  light.diffuse = new Color3(1.0, 0.85, 0.5);

  parent.position = new Vector3(pos.x, pos.y, pos.z);
  return parent;
}

/**
 * A floor cushion: flattened sphere.
 * Dimensions: 0.5 diameter, 0.15 height.
 */
function createCushion(scene: Scene, pos: PropPosition, id: string): Mesh {
  const cushion = MeshBuilder.CreateSphere(
    `cushion_${id}`,
    { diameter: 0.5, segments: 12 },
    scene
  );
  cushion.scaling.y = 0.3; // Flatten
  cushion.position = new Vector3(pos.x, pos.y + 0.08, pos.z);

  const mat = new StandardMaterial(`cushionMat_${id}`, scene);
  mat.diffuseColor = new Color3(0.6, 0.25, 0.3); // Muted red/burgundy
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  cushion.material = mat;

  return cushion;
}

/**
 * A star chart: plane with dot-pattern texture created via DynamicTexture.
 * Dimensions: 1.5 x 1.5 plane, mounted on a wall or lying on a table.
 */
function createStarChart(scene: Scene, pos: PropPosition, id: string): Mesh {
  const chart = MeshBuilder.CreatePlane(
    `starChart_${id}`,
    { width: 1.5, height: 1.5 },
    scene
  );
  chart.position = new Vector3(pos.x, pos.y + 1.5, pos.z);
  chart.billboardMode = Mesh.BILLBOARDMODE_Y; // Always face horizontally

  const texSize = 256;
  const dt = new DynamicTexture(`starChartTex_${id}`, texSize, scene, false);
  dt.hasAlpha = true;

  const ctx = dt.getContext() as unknown as CanvasRenderingContext2D;

  // Dark background
  ctx.fillStyle = "rgba(5, 5, 20, 0.85)";
  ctx.fillRect(0, 0, texSize, texSize);

  // Draw constellation dots
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  // Deterministic star positions from id hash
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  let seed = Math.abs(hash);
  for (let i = 0; i < 30; i++) {
    seed = ((seed * 1103515245 + 12345) & 0x7fffffff);
    const sx = (seed % texSize);
    seed = ((seed * 1103515245 + 12345) & 0x7fffffff);
    const sy = (seed % texSize);
    const radius = 1 + (i % 3);
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw connecting lines between some stars
  ctx.strokeStyle = "rgba(100, 150, 255, 0.3)";
  ctx.lineWidth = 1;
  seed = Math.abs(hash);
  for (let i = 0; i < 8; i++) {
    seed = ((seed * 1103515245 + 12345) & 0x7fffffff);
    const x1 = seed % texSize;
    seed = ((seed * 1103515245 + 12345) & 0x7fffffff);
    const y1 = seed % texSize;
    seed = ((seed * 1103515245 + 12345) & 0x7fffffff);
    const x2 = seed % texSize;
    seed = ((seed * 1103515245 + 12345) & 0x7fffffff);
    const y2 = seed % texSize;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  dt.update();

  const mat = new StandardMaterial(`starChartMat_${id}`, scene);
  mat.diffuseTexture = dt;
  mat.emissiveColor = new Color3(0.15, 0.15, 0.25);
  mat.useAlphaFromDiffuseTexture = true;
  mat.backFaceCulling = false;
  mat.disableLighting = true;
  chart.material = mat;

  return chart;
}

// ─── Archetype Prop Placement Rules ───

interface PropPlacement {
  factory: (scene: Scene, pos: PropPosition, id: string, color?: Color3) => Mesh;
  count: number;
  placement: "wall" | "corner" | "center" | "scatter" | "onTable";
}

/**
 * Returns the list of props to place for a given archetype.
 */
function getArchetypeProps(archetype: string): PropPlacement[] {
  switch (archetype) {
    case "laboratory":
      return [
        { factory: createTable, count: 2, placement: "wall" },
        { factory: createBeaker, count: 3, placement: "onTable" },
        { factory: createTorch, count: 2, placement: "corner" },
      ];

    case "library":
      return [
        { factory: createBookshelf, count: 3, placement: "wall" },
        { factory: createBench, count: 1, placement: "center" },
        { factory: createTorch, count: 2, placement: "corner" },
        { factory: createBanner, count: 1, placement: "wall" },
      ];

    case "garden":
      return [
        { factory: createVinePillar, count: 2, placement: "corner" },
        { factory: createFlowerCluster, count: 4, placement: "scatter" },
        { factory: createBench, count: 1, placement: "center" },
      ];

    case "amphitheater":
      return [
        { factory: createPodium, count: 1, placement: "center" },
        { factory: createBanner, count: 2, placement: "wall" },
        { factory: createTorch, count: 4, placement: "corner" },
      ];

    case "observatory":
      return [
        { factory: createTelescope, count: 1, placement: "center" },
        { factory: createStarChart, count: 2, placement: "wall" },
        { factory: createCushion, count: 2, placement: "scatter" },
        { factory: createTorch, count: 2, placement: "corner" },
      ];

    case "workshop":
      return [
        { factory: createTable, count: 1, placement: "wall" },
        { factory: createGear, count: 3, placement: "onTable" },
        { factory: createTorch, count: 2, placement: "corner" },
        { factory: createBeaker, count: 1, placement: "onTable" },
      ];

    case "gallery":
      return [
        { factory: createDisplayCase, count: 4, placement: "wall" },
        { factory: createTorch, count: 2, placement: "corner" },
        { factory: createBanner, count: 1, placement: "wall" },
      ];

    case "chamber":
      return [
        { factory: createCushion, count: 2, placement: "corner" },
        { factory: createTorch, count: 2, placement: "corner" },
        { factory: createBanner, count: 1, placement: "wall" },
        { factory: createBookshelf, count: 1, placement: "wall" },
      ];

    default:
      return [
        { factory: createTorch, count: 2, placement: "corner" },
      ];
  }
}

// ─── Main decorateSpace Implementation ───

/**
 * Places archetype-specific prop meshes inside a space.
 * All props use Babylon.js primitives (boxes, cylinders, spheres, tori, planes).
 * Returns the array of created meshes for potential cleanup.
 */
export function decorateSpace(
  scene: Scene,
  space: Space,
  materials: Map<string, StandardMaterial>
): Mesh[] {
  const archetype = space.archetype || "chamber"; // Fallback
  const props = getArchetypeProps(archetype);
  const { center, corners, wallMidpoints } = getRoomPositions(space);
  const allMeshes: Mesh[] = [];

  let cornerIdx = 0;
  let wallIdx = 0;
  const tablePositions: PropPosition[] = []; // Track where tables were placed

  for (const propDef of props) {
    for (let i = 0; i < propDef.count; i++) {
      let pos: PropPosition;
      const uniqueId = `${space.id}_${archetype}_${i}_${propDef.factory.name}`;

      switch (propDef.placement) {
        case "center":
          pos = { ...center, x: center.x + i * 1.5, z: center.z + i * 0.5 };
          break;

        case "corner":
          pos = corners[cornerIdx % corners.length];
          cornerIdx++;
          break;

        case "wall":
          pos = wallMidpoints[wallIdx % wallMidpoints.length];
          wallIdx++;
          break;

        case "scatter": {
          const scattered = getScatteredPositions(space, propDef.count);
          pos = scattered[i % scattered.length];
          break;
        }

        case "onTable":
          // Place on top of a previously placed table, with x offset
          if (tablePositions.length > 0) {
            const tablePos = tablePositions[i % tablePositions.length];
            pos = {
              x: tablePos.x + (i - 1) * 0.4,
              y: tablePos.y + 0.78, // Table top height
              z: tablePos.z,
            };
          } else {
            pos = wallMidpoints[wallIdx % wallMidpoints.length];
            wallIdx++;
          }
          break;

        default:
          pos = center;
      }

      const mesh = propDef.factory(scene, pos, uniqueId);
      allMeshes.push(mesh);

      // Track table positions for "onTable" placement
      if (propDef.factory === createTable) {
        tablePositions.push(pos);
      }
    }
  }

  return allMeshes;
}
