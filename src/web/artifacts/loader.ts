import Engine from "noa-engine";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/loaders/glTF";
import type { Artifact } from "../../shared/types";

/**
 * Build a voxel pedestal underneath an artifact's world position.
 *
 * The pedestal is a solid block of pedestal.width x pedestal.height x pedestal.width
 * centered under the artifact position. It raises the artifact above the floor.
 *
 * @param noa      The noa-engine instance
 * @param artifact Artifact configuration from PalaceConfig
 * @param blockMap Map of block type IDs to noa numeric block IDs
 */
export function buildPedestal(
  noa: Engine,
  artifact: Artifact,
  blockMap: Map<string, number>
): void {
  const { pedestal, position } = artifact;
  const pedestalId = blockMap.get(pedestal.block);
  if (pedestalId === undefined) return;

  const halfW = Math.floor(pedestal.width / 2);

  for (let h = 0; h < pedestal.height; h++) {
    for (let dx = -halfW; dx <= halfW; dx++) {
      for (let dz = -halfW; dz <= halfW; dz++) {
        noa.setBlock(
          pedestalId,
          Math.round(position.x) + dx,
          Math.round(position.y) + h,
          Math.round(position.z) + dz
        );
      }
    }
  }
}

/**
 * Create a simple colored cube mesh as a placeholder when GLB loading fails.
 * The cube is tinted with a deterministic color derived from the artifact ID.
 */
function createPlaceholderArtifact(noa: Engine, artifact: Artifact): void {
  const scene = noa.rendering.getScene();

  // Deterministic hue from artifact ID hash
  let hash = 0;
  for (let i = 0; i < artifact.id.length; i++) {
    hash = ((hash << 5) - hash + artifact.id.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash % 360) / 360;

  const box = MeshBuilder.CreateBox(
    `placeholder_${artifact.id}`,
    { size: 0.8 * artifact.scale },
    scene
  );

  const mat = new StandardMaterial(`placeholder_mat_${artifact.id}`, scene);
  mat.diffuseColor = Color3.FromHSV(hue * 360, 0.7, 0.9);
  mat.specularColor = new Color3(0.2, 0.2, 0.2);
  box.material = mat;

  box.position.set(
    artifact.position.x,
    artifact.position.y + artifact.pedestal.height + 0.5,
    artifact.position.z
  );
  box.rotation.y = artifact.rotation_y;

  // Attach to noa entity system for chunk management
  const eid = noa.entities.add(
    [artifact.position.x, artifact.position.y, artifact.position.z],
    1, // width
    1, // height
    null,
    null,
    false,
    false
  );
  noa.entities.addComponentAgain(eid, "mesh", { mesh: box });
}

/**
 * Load a GLB artifact mesh via Babylon.js SceneLoader and position it on its pedestal.
 *
 * The mesh is scaled by artifact.scale, rotated by artifact.rotation_y on the Y axis,
 * and positioned at the artifact's world position raised by the pedestal height.
 *
 * On failure (network error, invalid GLB, etc.) a colored placeholder cube is created
 * instead so the world remains functional.
 *
 * @param noa      The noa-engine instance
 * @param artifact Artifact configuration from PalaceConfig
 */
export async function loadArtifact(
  noa: Engine,
  artifact: Artifact
): Promise<void> {
  const scene = noa.rendering.getScene();

  try {
    // Split the GLB URL into directory + filename for SceneLoader
    const lastSlash = artifact.glb_url.lastIndexOf("/");
    const rootUrl =
      lastSlash >= 0 ? artifact.glb_url.substring(0, lastSlash + 1) : "";
    const fileName =
      lastSlash >= 0 ? artifact.glb_url.substring(lastSlash + 1) : artifact.glb_url;

    const result = await SceneLoader.ImportMeshAsync(
      "",
      rootUrl,
      fileName,
      scene
    );

    const root = result.meshes[0];
    root.scaling.setAll(artifact.scale);
    root.rotation.y = artifact.rotation_y;
    root.position.set(
      artifact.position.x,
      artifact.position.y + artifact.pedestal.height,
      artifact.position.z
    );

    // Attach to noa entity system for chunk management
    const eid = noa.entities.add(
      [artifact.position.x, artifact.position.y, artifact.position.z],
      1, // width
      1, // height
      null,
      null,
      false,
      false
    );
    noa.entities.addComponentAgain(eid, "mesh", { mesh: root });
  } catch (err) {
    console.warn(
      `Failed to load artifact ${artifact.id} from ${artifact.glb_url}, using placeholder`,
      err
    );
    createPlaceholderArtifact(noa, artifact);
  }
}
