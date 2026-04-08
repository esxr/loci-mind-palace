import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import "@babylonjs/loaders/glTF";
import type { Artifact } from "../../shared/types";

/**
 * Build a smooth pedestal mesh underneath an artifact's world position.
 * The pedestal is a beveled box centered under the artifact.
 *
 * @param scene     Babylon.js scene
 * @param artifact  Artifact configuration from PalaceConfig
 * @param materials Map of block type IDs to StandardMaterial
 */
export function buildPedestal(
  scene: Scene,
  artifact: Artifact,
  materials: Map<string, StandardMaterial>
): void {
  const { pedestal, position } = artifact;
  const pedestalMat = materials.get(pedestal.block);
  if (!pedestalMat) return;

  const pedestalMesh = MeshBuilder.CreateBox(
    `pedestal_${artifact.id}`,
    {
      width: pedestal.width,
      height: pedestal.height,
      depth: pedestal.width,
    },
    scene
  );

  pedestalMesh.position = new Vector3(
    position.x,
    position.y + pedestal.height / 2,
    position.z
  );
  pedestalMesh.material = pedestalMat;
  pedestalMesh.checkCollisions = true;
}

/**
 * Create a simple colored cube mesh as a placeholder when GLB loading fails.
 * The cube is tinted with a deterministic color derived from the artifact ID.
 */
function createPlaceholderArtifact(scene: Scene, artifact: Artifact): void {
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

  box.position = new Vector3(
    artifact.position.x,
    artifact.position.y + artifact.pedestal.height + 0.5,
    artifact.position.z
  );
  box.rotation.y = artifact.rotation_y;

  // Slow spin animation for visual interest
  scene.registerBeforeRender(() => {
    if (!box.isDisposed()) {
      box.rotation.y += 0.005;
    }
  });
}

/**
 * Load a GLB artifact mesh via Babylon.js SceneLoader and position it on its pedestal.
 * On failure, a colored placeholder cube is created instead.
 *
 * @param scene    Babylon.js scene
 * @param artifact Artifact configuration from PalaceConfig
 */
export async function loadArtifact(
  scene: Scene,
  artifact: Artifact
): Promise<void> {
  try {
    const lastSlash = artifact.glb_url.lastIndexOf("/");
    const rootUrl =
      lastSlash >= 0 ? artifact.glb_url.substring(0, lastSlash + 1) : "";
    const fileName =
      lastSlash >= 0
        ? artifact.glb_url.substring(lastSlash + 1)
        : artifact.glb_url;

    const result = await SceneLoader.ImportMeshAsync(
      "",
      rootUrl,
      fileName,
      scene
    );

    const root = result.meshes[0];
    root.scaling.setAll(artifact.scale);
    root.rotation.y = artifact.rotation_y;
    root.position = new Vector3(
      artifact.position.x,
      artifact.position.y + artifact.pedestal.height,
      artifact.position.z
    );
  } catch (err) {
    console.warn(
      `Failed to load artifact ${artifact.id} from ${artifact.glb_url}, using placeholder`,
      err
    );
    createPlaceholderArtifact(scene, artifact);
  }
}
