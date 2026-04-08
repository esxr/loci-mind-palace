import { Engine } from "noa-engine";
import {
  MeshBuilder,
  Color3,
  StandardMaterial,
  Mesh,
  TransformNode,
  Scene,
  Vector3,
} from "@babylonjs/core";
import type { NPCVoxelModel, WorldPosition } from "../../shared/types";

/**
 * Builds a voxel-style NPC mesh (3 blocks tall: legs, body, head) and
 * registers it as a noa entity at the given world position.
 *
 * Returns the noa entity ID and the parent Babylon.js mesh.
 */
export function buildNPCMesh(
  noa: Engine,
  model: NPCVoxelModel,
  position: WorldPosition,
  facing: number = 0
): { entityId: number; mesh: Mesh } {
  const scene: Scene = noa.rendering.getScene();

  // ── Materials ──────────────────────────────────────────────────────────
  const bodyMat = new StandardMaterial("npcBodyMat_" + Date.now(), scene);
  bodyMat.diffuseColor = Color3.FromHexString(model.palette.body);
  bodyMat.specularColor = Color3.Black();

  const headMat = new StandardMaterial("npcHeadMat_" + Date.now(), scene);
  headMat.diffuseColor = Color3.FromHexString(model.palette.head);
  headMat.specularColor = Color3.Black();

  const accentMat = new StandardMaterial("npcAccentMat_" + Date.now(), scene);
  accentMat.diffuseColor = Color3.FromHexString(model.palette.accent);
  accentMat.specularColor = Color3.Black();

  // ── Parent mesh ────────────────────────────────────────────────────────
  const parent = new Mesh("npcParent_" + Date.now(), scene);

  // ── Legs (bottom block, y = 0 to 1) ────────────────────────────────────
  const legs = MeshBuilder.CreateBox(
    "npcLegs",
    { width: 0.6, height: 1, depth: 0.6 },
    scene
  );
  legs.material = bodyMat;
  legs.position.y = 0.5;
  legs.parent = parent;

  // ── Body (middle block, y = 1 to 2) ────────────────────────────────────
  const body = MeshBuilder.CreateBox(
    "npcBody",
    { width: 0.9, height: 1, depth: 0.6 },
    scene
  );
  body.material = bodyMat;
  body.position.y = 1.5;
  body.parent = parent;

  // ── Accent detail on body (belt/badge stripe) ──────────────────────────
  const accent = MeshBuilder.CreateBox(
    "npcAccent",
    { width: 0.92, height: 0.15, depth: 0.62 },
    scene
  );
  accent.material = accentMat;
  accent.position.y = 1.25;
  accent.parent = parent;

  // ── Head (top block, y = 2 to 2.8, slightly smaller) ──────────────────
  const head = MeshBuilder.CreateBox(
    "npcHead",
    { width: 0.8, height: 0.8, depth: 0.8 },
    scene
  );
  head.material = headMat;
  head.position.y = 2.4;
  head.parent = parent;

  // ── Apply facing rotation ──────────────────────────────────────────────
  parent.rotation.y = facing;

  // ── Idle bob animation ─────────────────────────────────────────────────
  const baseY = 0;
  scene.registerBeforeRender(() => {
    if (!parent.isDisposed()) {
      parent.position.y = baseY + Math.sin(Date.now() / 500) * 0.05;
    }
  });

  // ── Create noa entity ──────────────────────────────────────────────────
  const entityId = noa.entities.add(
    [position.x + 0.5, position.y, position.z + 0.5], // center of block
    1, // width
    model.height_blocks, // height (typically 3)
    parent, // mesh
    [0, 0, 0], // mesh offset from entity position
    false, // not a sprite
    false // not collidable with player
  );

  // Attach the mesh to the entity via noa's mesh component
  noa.entities.addComponentAgain(noa.entities.names.mesh, entityId, {
    mesh: parent,
    offset: [0, 0, 0],
  });

  return { entityId, mesh: parent };
}
