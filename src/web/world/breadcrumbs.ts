import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  Mesh,
  DynamicTexture,
} from "@babylonjs/core";
import type {
  PalaceConfig,
  Space,
  Path as PalacePath,
  WorldPosition,
} from "../../shared/types";

/**
 * Build the golden breadcrumb trail along the learning path.
 *
 * For each consecutive pair of concepts in config.learning_path:
 *   1. Find the path connecting them.
 *   2. Along that path's waypoints, place glowing floor discs every 3 blocks.
 *   3. At each concept stop, place a numbered step marker.
 *
 * @param scene     Babylon.js scene
 * @param config    Full PalaceConfig
 * @returns Array of all created meshes
 */
export function buildGoldenPath(
  scene: Scene,
  config: PalaceConfig,
): Mesh[] {
  const meshes: Mesh[] = [];
  const lp = config.learning_path;
  if (!lp || lp.length < 2) return meshes;

  // Build lookup maps
  const spaceMap = new Map<string, Space>();
  for (const s of config.spaces) spaceMap.set(s.concept_id, s);

  const pathMap = new Map<string, PalacePath>();
  for (const p of config.paths) {
    // Index by both directions
    const key1 = `${p.source_space_id}__${p.target_space_id}`;
    const key2 = `${p.target_space_id}__${p.source_space_id}`;
    pathMap.set(key1, p);
    pathMap.set(key2, p);
  }

  // ── Golden material (shared across all breadcrumb discs) ──
  const goldMat = new StandardMaterial("goldenBreadcrumb", scene);
  goldMat.diffuseColor = new Color3(1.0, 0.84, 0.0);       // #FFD700
  goldMat.emissiveColor = new Color3(0.6, 0.5, 0.0);       // 60% emissive
  goldMat.specularColor = new Color3(0.8, 0.7, 0.3);
  goldMat.backFaceCulling = false;

  let globalDiscIndex = 0;

  // ── Place floor discs along each path segment ──
  for (let step = 0; step < lp.length - 1; step++) {
    const fromId = lp[step];
    const toId = lp[step + 1];
    const pathKey = `${fromId}__${toId}`;
    const palacePath = pathMap.get(pathKey);

    if (!palacePath) continue;

    // Determine if waypoints need to be reversed
    const waypoints =
      palacePath.source_space_id === fromId
        ? [...palacePath.waypoints]
        : [...palacePath.waypoints].reverse();

    // Walk along waypoints, placing discs every 3 blocks
    let accumulated = 0;
    for (let w = 0; w < waypoints.length - 1; w++) {
      const wpA = waypoints[w];
      const wpB = waypoints[w + 1];
      const dx = wpB.x - wpA.x;
      const dy = wpB.y - wpA.y;
      const dz = wpB.z - wpA.z;
      const segLen = Math.sqrt(dx * dx + dy * dy + dz * dz);

      let cursor = 0;
      // If there's leftover from previous segment, start from the remainder
      if (accumulated > 0) {
        cursor = 3 - accumulated;
      }

      while (cursor <= segLen) {
        const t = cursor / segLen;
        const discX = wpA.x + dx * t;
        const discY = wpA.y + dy * t;
        const discZ = wpA.z + dz * t;

        const disc = MeshBuilder.CreateDisc(
          `goldDisc_${globalDiscIndex}`,
          { radius: 0.4, tessellation: 16 },
          scene,
        );
        disc.rotation.x = Math.PI / 2;  // Lay flat on ground
        disc.position = new Vector3(discX, discY + 0.05, discZ);
        disc.material = goldMat;
        meshes.push(disc);

        // Bob animation (subtle y oscillation +/- 0.02)
        const baseY = discY + 0.05;
        const phase = globalDiscIndex * 0.7;  // stagger phase per disc
        scene.registerBeforeRender(() => {
          if (!disc.isDisposed()) {
            disc.position.y = baseY + Math.sin(Date.now() * 0.002 + phase) * 0.02;
          }
        });

        globalDiscIndex++;
        cursor += 3;
      }

      accumulated = (accumulated + segLen) % 3;
    }
  }

  // ── Numbered step markers at each concept along the learning path ──
  for (let step = 0; step < lp.length; step++) {
    const conceptId = lp[step];
    const space = spaceMap.get(conceptId);
    if (!space) continue;

    const markerMesh = createStepMarker(
      scene,
      step + 1,
      space,
      `goldenStep_${step}`,
    );
    meshes.push(markerMesh);
  }

  return meshes;
}

/**
 * Create a numbered step marker (billboard plane with DynamicTexture)
 * positioned above a room entrance.
 */
function createStepMarker(
  scene: Scene,
  stepNumber: number,
  space: Space,
  id: string,
): Mesh {
  const planeSize = 1.2;
  const plane = MeshBuilder.CreatePlane(
    id,
    { width: planeSize, height: planeSize },
    scene,
  );

  // Position above the front-center of the room (z + depth = entrance side)
  const cx = space.position.x + space.size.width / 2;
  const entranceZ = space.position.z;  // front face
  plane.position = new Vector3(
    cx,
    space.position.y + space.size.height + 1.5,
    entranceZ,
  );
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;

  // DynamicTexture with step number
  const texSize = 128;
  const dt = new DynamicTexture(`${id}_tex`, texSize, scene, false);
  dt.hasAlpha = true;

  const ctx = dt.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, texSize, texSize);

  // Golden circle background
  ctx.beginPath();
  ctx.arc(texSize / 2, texSize / 2, texSize / 2 - 4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 215, 0, 0.85)";
  ctx.fill();
  ctx.strokeStyle = "rgba(180, 140, 0, 1)";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Number text
  ctx.fillStyle = "rgba(40, 30, 0, 1)";
  ctx.font = `bold 72px Inter, Segoe UI, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${stepNumber}`, texSize / 2, texSize / 2);
  dt.update();

  const mat = new StandardMaterial(`${id}_mat`, scene);
  mat.diffuseTexture = dt;
  mat.emissiveColor = new Color3(1, 0.9, 0.4);
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.useAlphaFromDiffuseTexture = true;
  plane.material = mat;

  return plane;
}
