import {
  MeshBuilder,
  Color3,
  StandardMaterial,
  Mesh,
  Scene,
  Vector3,
} from "@babylonjs/core";
import type { NPCVoxelModel, WorldPosition } from "../../shared/types";

/**
 * Builds a smooth NPC mesh (cylinder body + sphere head) and places it
 * in the scene at the given world position.
 *
 * Returns the parent mesh for proximity detection and cleanup.
 */
export function buildNPCMesh(
  scene: Scene,
  model: NPCVoxelModel,
  position: WorldPosition,
  facing: number = 0
): { mesh: Mesh } {
  // ── Materials ──
  const bodyMat = new StandardMaterial("npcBodyMat_" + Date.now(), scene);
  bodyMat.diffuseColor = Color3.FromHexString(model.palette.body);
  bodyMat.specularColor = new Color3(0.05, 0.05, 0.05);

  const headMat = new StandardMaterial("npcHeadMat_" + Date.now(), scene);
  headMat.diffuseColor = Color3.FromHexString(model.palette.head);
  headMat.specularColor = new Color3(0.05, 0.05, 0.05);

  const accentMat = new StandardMaterial("npcAccentMat_" + Date.now(), scene);
  accentMat.diffuseColor = Color3.FromHexString(model.palette.accent);
  accentMat.emissiveColor = Color3.FromHexString(model.palette.accent).scale(
    0.3
  );
  accentMat.specularColor = new Color3(0.05, 0.05, 0.05);

  // ── Parent mesh ──
  const parent = new Mesh("npcParent_" + Date.now(), scene);

  // ── Body (cylinder, y = 0.6 center, height = 1.2) ──
  const body = MeshBuilder.CreateCylinder(
    "npcBody",
    { height: 1.2, diameter: 0.6, tessellation: 16 },
    scene
  );
  body.material = bodyMat;
  body.position.y = 0.6;
  body.parent = parent;

  // ── Accent ring (thin torus/cylinder around the waist) ──
  const accent = MeshBuilder.CreateTorus(
    "npcAccent",
    { diameter: 0.62, thickness: 0.08, tessellation: 16 },
    scene
  );
  accent.material = accentMat;
  accent.position.y = 0.7;
  accent.parent = parent;

  // ── Head (sphere, sitting on top of body) ──
  const head = MeshBuilder.CreateSphere(
    "npcHead",
    { diameter: 0.5, segments: 12 },
    scene
  );
  head.material = headMat;
  head.position.y = 1.45;
  head.parent = parent;

  // ── Eyes (two small dark spheres) ──
  const eyeMat = new StandardMaterial("npcEyeMat_" + Date.now(), scene);
  eyeMat.diffuseColor = new Color3(0.1, 0.1, 0.15);
  eyeMat.specularColor = new Color3(0.5, 0.5, 0.5);

  for (const side of [-1, 1]) {
    const eye = MeshBuilder.CreateSphere(
      "npcEye",
      { diameter: 0.08, segments: 8 },
      scene
    );
    eye.material = eyeMat;
    eye.position = new Vector3(side * 0.1, 1.5, -0.22);
    eye.parent = parent;
  }

  // ── Position and facing ──
  parent.position = new Vector3(
    position.x + 0.5,
    position.y,
    position.z + 0.5
  );
  parent.rotation.y = facing;

  // ── Idle bob animation ──
  const baseY = parent.position.y;
  scene.registerBeforeRender(() => {
    if (!parent.isDisposed()) {
      parent.position.y = baseY + Math.sin(Date.now() / 600) * 0.06;
    }
  });

  return { mesh: parent };
}
