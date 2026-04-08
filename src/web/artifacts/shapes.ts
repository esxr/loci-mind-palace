import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Space } from "@babylonjs/core/Maths/math.axis";
import { Scene } from "@babylonjs/core/scene";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { SpotLight } from "@babylonjs/core/Lights/spotLight";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import type { Concept } from "../../shared/types";

// ─── Category Classification ───

export type ConceptCategory =
  | "structure"
  | "process"
  | "molecule"
  | "theory"
  | "system";

/**
 * Classify a concept into a visual category using keyword matching
 * on concept name and cluster_label.
 */
export function categorize(concept: Concept): ConceptCategory {
  const combined = `${concept.name} ${concept.cluster_label}`.toLowerCase();

  // Order matters: more specific categories first
  if (/protein|enzyme|dna|rna|amino|lipid|atp|molecule/.test(combined))
    return "molecule";
  if (
    /photosynth|respir|division|selection|mitosis|meiosis|transport/.test(
      combined,
    )
  )
    return "process";
  if (
    /cell|membrane|structur|wall|organelle|ribosome|nucleus/.test(combined)
  )
    return "structure";
  if (/evolution|genetic|inherit|ecology|theory|taxonomy/.test(combined))
    return "theory";
  if (/nervous|circulat|immune|system|digest|endocrine/.test(combined))
    return "system";

  // Default fallback
  return "structure";
}

// ─── Importance Tiers ───

interface ImportanceTier {
  scale: number;
  emissiveIntensity: number; // 0.0 = none, up to 0.8
  addParticles: boolean;
  addBeaconLight: boolean;
  addGlowLayer: boolean;
}

function getTier(importance: number): ImportanceTier {
  if (importance >= 9)
    return {
      scale: 1.3,
      emissiveIntensity: 0.6,
      addParticles: true,
      addBeaconLight: true,
      addGlowLayer: true,
    };
  if (importance >= 7)
    return {
      scale: 1.0,
      emissiveIntensity: 0.4,
      addParticles: true,
      addBeaconLight: false,
      addGlowLayer: true,
    };
  if (importance >= 4)
    return {
      scale: 0.8,
      emissiveIntensity: 0.2,
      addParticles: false,
      addBeaconLight: false,
      addGlowLayer: false,
    };
  return {
    scale: 0.5,
    emissiveIntensity: 0.0,
    addParticles: false,
    addBeaconLight: false,
    addGlowLayer: false,
  };
}

// ─── Hex Utility ───

function hexToColor3(hex: string): Color3 {
  const c = hex.replace("#", "");
  return new Color3(
    parseInt(c.substring(0, 2), 16) / 255,
    parseInt(c.substring(2, 4), 16) / 255,
    parseInt(c.substring(4, 6), 16) / 255,
  );
}

// ─── Shape Generators ───

/**
 * STRUCTURE: Icosahedron (polyhedron type 3) with wireframe overlay.
 * Semi-transparent lattice/crystalline aesthetic.
 */
function createStructureShape(
  scene: Scene,
  id: string,
  color: Color3,
  tier: ImportanceTier,
): Mesh {
  const parent = new Mesh(`artifact_structure_${id}`, scene);
  const radius = 0.8 * tier.scale;

  // Solid semi-transparent core
  const core = MeshBuilder.CreatePolyhedron(
    `struct_core_${id}`,
    { type: 3, size: radius },
    scene,
  );
  const coreMat = new StandardMaterial(`struct_coreMat_${id}`, scene);
  coreMat.diffuseColor = color;
  coreMat.alpha = 0.7;
  coreMat.emissiveColor = color.scale(tier.emissiveIntensity);
  coreMat.specularColor = new Color3(0.3, 0.3, 0.3);
  core.material = coreMat;
  core.parent = parent;

  // Wireframe overlay (slightly larger)
  const wireframe = MeshBuilder.CreatePolyhedron(
    `struct_wire_${id}`,
    { type: 3, size: radius * 1.05 },
    scene,
  );
  const wireMat = new StandardMaterial(`struct_wireMat_${id}`, scene);
  wireMat.diffuseColor = color.scale(0.6);
  wireMat.wireframe = true;
  wireMat.emissiveColor = color.scale(0.3);
  wireframe.material = wireMat;
  wireframe.parent = parent;

  return parent;
}

/**
 * PROCESS: Interlocking torus rings (2-3 at different angles).
 * Gears/flow feel with slow rotation animation.
 */
function createProcessShape(
  scene: Scene,
  id: string,
  color: Color3,
  tier: ImportanceTier,
): Mesh {
  const parent = new Mesh(`artifact_process_${id}`, scene);
  const baseRadius = 0.7 * tier.scale;

  // Warm color shift for processes
  const warmColor = new Color3(
    Math.min(1, color.r + 0.15),
    color.g,
    Math.max(0, color.b - 0.1),
  );

  const torusCount = tier.scale >= 1.0 ? 3 : 2;
  const rotations = [
    { x: 0, y: 0, z: 0 },
    { x: Math.PI / 3, y: 0, z: Math.PI / 4 },
    { x: 0, y: Math.PI / 3, z: Math.PI / 6 },
  ];

  for (let i = 0; i < torusCount; i++) {
    const torus = MeshBuilder.CreateTorus(
      `process_ring_${id}_${i}`,
      {
        diameter: baseRadius * 2,
        thickness: 0.12 * tier.scale,
        tessellation: 32,
      },
      scene,
    );
    const mat = new StandardMaterial(`process_mat_${id}_${i}`, scene);
    mat.diffuseColor = warmColor.scale(1.0 - i * 0.15);
    mat.emissiveColor = warmColor.scale(tier.emissiveIntensity);
    mat.specularColor = new Color3(0.4, 0.4, 0.4);
    torus.material = mat;
    torus.rotation.x = rotations[i].x;
    torus.rotation.y = rotations[i].y;
    torus.rotation.z = rotations[i].z;
    torus.parent = parent;
  }

  // Slow rotation animation
  let angle = 0;
  scene.registerBeforeRender(() => {
    if (parent.isDisposed()) return;
    angle += 0.003;
    parent.rotation.y = angle;
  });

  return parent;
}

/**
 * MOLECULE: Cluster of 4-6 spheres connected by thin cylinders.
 * Ball-and-stick model aesthetic.
 */
function createMoleculeShape(
  scene: Scene,
  id: string,
  color: Color3,
  tier: ImportanceTier,
): Mesh {
  const parent = new Mesh(`artifact_molecule_${id}`, scene);
  const atomRadius = 0.15 * tier.scale;
  const bondRadius = 0.03 * tier.scale;

  // Organic color palette
  const organicColor = new Color3(
    Math.max(0, color.r - 0.05),
    Math.min(1, color.g + 0.1),
    Math.max(0, color.b - 0.05),
  );

  const atomMat = new StandardMaterial(`mol_atomMat_${id}`, scene);
  atomMat.diffuseColor = organicColor;
  atomMat.emissiveColor = organicColor.scale(tier.emissiveIntensity);
  atomMat.specularColor = new Color3(0.5, 0.5, 0.5);

  const bondMat = new StandardMaterial(`mol_bondMat_${id}`, scene);
  bondMat.diffuseColor = new Color3(0.6, 0.6, 0.6);

  // Atom positions (predefined molecule shape)
  const atomCount = tier.scale >= 1.0 ? 6 : 4;
  const atomPositions: Vector3[] = [
    new Vector3(0, 0, 0), // center
    new Vector3(0.4, 0.2, 0), // right-up
    new Vector3(-0.3, 0.3, 0.2), // left-up-forward
    new Vector3(0, -0.3, -0.3), // down-back
    new Vector3(0.3, -0.1, 0.4), // right-down-forward
    new Vector3(-0.4, -0.2, -0.1), // left-down-back
  ];

  // Scale positions
  for (const p of atomPositions) {
    p.scaleInPlace(tier.scale);
  }

  // Create atoms
  for (let i = 0; i < atomCount; i++) {
    const atom = MeshBuilder.CreateSphere(
      `mol_atom_${id}_${i}`,
      { diameter: atomRadius * 2, segments: 12 },
      scene,
    );
    atom.position = atomPositions[i];
    atom.material = atomMat;
    atom.parent = parent;
  }

  // Create bonds (connect each non-center atom to center)
  for (let i = 1; i < atomCount; i++) {
    const start = atomPositions[0];
    const end = atomPositions[i];
    const dist = Vector3.Distance(start, end);
    const mid = Vector3.Center(start, end);

    const bond = MeshBuilder.CreateCylinder(
      `mol_bond_${id}_${i}`,
      { height: dist, diameter: bondRadius * 2, tessellation: 8 },
      scene,
    );
    bond.position = mid;
    bond.material = bondMat;
    bond.parent = parent;

    // Orient cylinder between two points
    const direction = end.subtract(start).normalize();
    const up = new Vector3(0, 1, 0);
    const axis = Vector3.Cross(up, direction).normalize();
    const dotAngle = Math.acos(
      Math.max(-1, Math.min(1, Vector3.Dot(up, direction))),
    );
    if (axis.length() > 0.001) {
      bond.rotationQuaternion = null;
      bond.rotate(axis, dotAngle, Space.WORLD);
    }
  }

  // Slow tumble
  let t = 0;
  scene.registerBeforeRender(() => {
    if (parent.isDisposed()) return;
    t += 0.002;
    parent.rotation.y = t;
    parent.rotation.x = Math.sin(t * 0.5) * 0.1;
  });

  return parent;
}

/**
 * THEORY: Book shape (flat wide box) with floating orbiting page planes.
 * Gold/brown scholarly tones.
 */
function createTheoryShape(
  scene: Scene,
  id: string,
  color: Color3,
  tier: ImportanceTier,
): Mesh {
  const parent = new Mesh(`artifact_theory_${id}`, scene);
  const s = tier.scale;

  // Suppress unused variable lint -- color is available for future theming
  void color;

  // Book body: flat wide box
  const book = MeshBuilder.CreateBox(
    `theory_book_${id}`,
    { width: 0.6 * s, height: 0.15 * s, depth: 0.8 * s },
    scene,
  );
  const bookMat = new StandardMaterial(`theory_bookMat_${id}`, scene);
  // Warm gold/brown
  bookMat.diffuseColor = new Color3(0.6, 0.45, 0.2);
  bookMat.emissiveColor = new Color3(0.6, 0.45, 0.2).scale(
    tier.emissiveIntensity,
  );
  bookMat.specularColor = new Color3(0.3, 0.25, 0.1);
  book.material = bookMat;
  book.parent = parent;

  // Floating page planes orbiting slowly
  const pageCount = tier.scale >= 1.0 ? 3 : 2;
  const pageMat = new StandardMaterial(`theory_pageMat_${id}`, scene);
  pageMat.diffuseColor = new Color3(0.95, 0.92, 0.85);
  pageMat.emissiveColor = new Color3(0.95, 0.92, 0.85).scale(0.2);
  pageMat.backFaceCulling = false;
  pageMat.alpha = 0.85;

  const pages: Mesh[] = [];
  for (let i = 0; i < pageCount; i++) {
    const page = MeshBuilder.CreatePlane(
      `theory_page_${id}_${i}`,
      { width: 0.3 * s, height: 0.4 * s },
      scene,
    );
    page.material = pageMat;
    page.parent = parent;
    pages.push(page);
  }

  // Orbiting animation
  let orbitAngle = 0;
  scene.registerBeforeRender(() => {
    if (parent.isDisposed()) return;
    orbitAngle += 0.004;
    for (let i = 0; i < pages.length; i++) {
      const offset = (i / pages.length) * Math.PI * 2;
      const orbitRadius = 0.5 * s;
      pages[i].position.x = Math.cos(orbitAngle + offset) * orbitRadius;
      pages[i].position.y =
        0.3 * s + Math.sin(orbitAngle * 2 + offset) * 0.05;
      pages[i].position.z = Math.sin(orbitAngle + offset) * orbitRadius;
      pages[i].rotation.y = -(orbitAngle + offset);
    }
  });

  return parent;
}

/**
 * SYSTEM: Node-and-edge network graph.
 * 5-8 small spheres connected by thin cylinders in a 3D layout.
 */
function createSystemShape(
  scene: Scene,
  id: string,
  color: Color3,
  tier: ImportanceTier,
): Mesh {
  const parent = new Mesh(`artifact_system_${id}`, scene);
  const s = tier.scale;

  const nodeCount = tier.scale >= 1.0 ? 8 : 5;
  const nodeRadius = 0.08 * s;
  const edgeRadius = 0.02 * s;

  const nodeMat = new StandardMaterial(`sys_nodeMat_${id}`, scene);
  nodeMat.diffuseColor = color;
  nodeMat.emissiveColor = color.scale(
    Math.max(0.3, tier.emissiveIntensity),
  );
  nodeMat.specularColor = new Color3(0.4, 0.4, 0.4);

  const edgeMat = new StandardMaterial(`sys_edgeMat_${id}`, scene);
  edgeMat.diffuseColor = color.scale(0.5);
  edgeMat.alpha = 0.6;

  // Generate node positions (pseudo-random but deterministic from id)
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  let seed = Math.abs(hash);
  const rand = (): number => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  const nodePositions: Vector3[] = [];
  for (let i = 0; i < nodeCount; i++) {
    nodePositions.push(
      new Vector3(
        (rand() - 0.5) * 0.8 * s,
        (rand() - 0.5) * 0.8 * s,
        (rand() - 0.5) * 0.8 * s,
      ),
    );
  }

  // Create nodes
  for (let i = 0; i < nodeCount; i++) {
    const node = MeshBuilder.CreateSphere(
      `sys_node_${id}_${i}`,
      { diameter: nodeRadius * 2, segments: 8 },
      scene,
    );
    node.position = nodePositions[i];
    node.material = nodeMat;
    node.parent = parent;
  }

  // Create edges (connect neighbors -- each node to 2-3 nearest)
  const connected = new Set<string>();
  for (let i = 0; i < nodeCount; i++) {
    // Sort by distance from node i
    const distances = nodePositions
      .map((p, j) => ({ j, dist: Vector3.Distance(nodePositions[i], p) }))
      .filter((d) => d.j !== i)
      .sort((a, b) => a.dist - b.dist);

    const connectCount = Math.min(2, distances.length);
    for (let c = 0; c < connectCount; c++) {
      const j = distances[c].j;
      const edgeKey = [Math.min(i, j), Math.max(i, j)].join("_");
      if (connected.has(edgeKey)) continue;
      connected.add(edgeKey);

      const start = nodePositions[i];
      const end = nodePositions[j];
      const dist = Vector3.Distance(start, end);
      const mid = Vector3.Center(start, end);

      const edge = MeshBuilder.CreateCylinder(
        `sys_edge_${id}_${i}_${j}`,
        { height: dist, diameter: edgeRadius * 2, tessellation: 6 },
        scene,
      );
      edge.position = mid;
      edge.material = edgeMat;
      edge.parent = parent;

      // Orient cylinder to connect the two node positions
      const dir = end.subtract(start).normalize();
      const up = new Vector3(0, 1, 0);
      const axis = Vector3.Cross(up, dir).normalize();
      const ang = Math.acos(
        Math.max(-1, Math.min(1, Vector3.Dot(up, dir))),
      );
      if (axis.length() > 0.001) {
        edge.rotationQuaternion = null;
        edge.rotate(axis, ang, Space.WORLD);
      }
    }
  }

  // Slow rotation
  let t = 0;
  scene.registerBeforeRender(() => {
    if (parent.isDisposed()) return;
    t += 0.002;
    parent.rotation.y = t;
  });

  return parent;
}

// ─── Shared Glow Layer Cache ───

let sharedGlowLayer: GlowLayer | null = null;

function getOrCreateGlowLayer(scene: Scene): GlowLayer {
  if (sharedGlowLayer) {
    return sharedGlowLayer;
  }
  sharedGlowLayer = new GlowLayer("defaultGlow", scene, {
    mainTextureFixedSize: 512,
    blurKernelSize: 32,
  });
  sharedGlowLayer.intensity = 0.5;
  return sharedGlowLayer;
}

// ─── Main Entry Point ───

/**
 * Create a category-specific artifact mesh with importance-tier visual effects.
 *
 * @param scene       Babylon.js scene
 * @param concept     Concept data for category classification and importance
 * @param zoneColor   Hex color string for the concept's zone
 * @param worldPos    World position to place the artifact
 * @param pedestalHeight  Height of pedestal (artifact placed on top)
 */
export function createArtifactByCategory(
  scene: Scene,
  concept: Concept,
  zoneColor: string,
  worldPos: { x: number; y: number; z: number },
  pedestalHeight: number,
): Mesh {
  const category = categorize(concept);
  const color = hexToColor3(zoneColor);
  const tier = getTier(concept.importance);
  const id = concept.id;

  let mesh: Mesh;
  switch (category) {
    case "structure":
      mesh = createStructureShape(scene, id, color, tier);
      break;
    case "process":
      mesh = createProcessShape(scene, id, color, tier);
      break;
    case "molecule":
      mesh = createMoleculeShape(scene, id, color, tier);
      break;
    case "theory":
      mesh = createTheoryShape(scene, id, color, tier);
      break;
    case "system":
      mesh = createSystemShape(scene, id, color, tier);
      break;
  }

  // Position on top of pedestal
  mesh.position = new Vector3(
    worldPos.x,
    worldPos.y + pedestalHeight + 0.5,
    worldPos.z,
  );

  // ── Importance Effects ──

  // Glow layer (importance 7+)
  if (tier.addGlowLayer) {
    const gl = getOrCreateGlowLayer(scene);
    gl.addIncludedOnlyMesh(mesh);
  }

  // Particle sparkles (importance 7+)
  if (tier.addParticles) {
    const ps = new ParticleSystem(`sparkle_${id}`, 30, scene);
    ps.emitter = mesh;
    ps.minSize = 0.02;
    ps.maxSize = 0.06;
    ps.minLifeTime = 0.8;
    ps.maxLifeTime = 2.0;
    ps.emitRate = 15;
    ps.direction1 = new Vector3(-0.3, 0.5, -0.3);
    ps.direction2 = new Vector3(0.3, 1.0, 0.3);
    ps.gravity = new Vector3(0, -0.05, 0);
    ps.color1 = new Color4(1, 0.95, 0.7, 1);
    ps.color2 = new Color4(1, 0.85, 0.4, 0.8);
    ps.colorDead = new Color4(1, 0.8, 0.3, 0);
    ps.createPointEmitter(
      new Vector3(-0.2, 0, -0.2),
      new Vector3(0.2, 0.3, 0.2),
    );
    ps.start();
  }

  // Beacon SpotLight (importance 9+)
  if (tier.addBeaconLight) {
    const beacon = new SpotLight(
      `beacon_${id}`,
      new Vector3(worldPos.x, worldPos.y + pedestalHeight + 1.5, worldPos.z),
      new Vector3(0, 1, 0), // pointing UP
      Math.PI / 6, // cone angle 30 degrees
      2, // exponent
      scene,
    );
    beacon.intensity = 0.8;
    beacon.range = 40;
    beacon.diffuse = color;
  }

  // Slow spin for all artifacts
  scene.registerBeforeRender(() => {
    if (!mesh.isDisposed()) {
      mesh.rotation.y += 0.005;
    }
  });

  return mesh;
}
