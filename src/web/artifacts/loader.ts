import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/loaders/glTF";
import type { Artifact, PalaceConfig } from "../../shared/types";
import { createArtifactByCategory } from "./shapes";

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
 * Create a category-specific placeholder artifact.
 * Called when GLB loading fails or glb_url is "/placeholder.glb".
 *
 * @param scene    Babylon.js scene
 * @param artifact Artifact configuration
 * @param config   Full PalaceConfig (needed to look up concept data)
 */
function createPlaceholderArtifact(
  scene: Scene,
  artifact: Artifact,
  config: PalaceConfig,
): void {
  // Look up concept data
  const concept = config.concept_graph.concepts.find(
    (c) => c.id === artifact.concept_id,
  );
  if (!concept) {
    // Fallback to a plain box if concept not found
    const box = MeshBuilder.CreateBox(
      `placeholder_${artifact.id}`,
      { size: 0.8 * artifact.scale },
      scene,
    );
    box.position = new Vector3(
      artifact.position.x,
      artifact.position.y + artifact.pedestal.height + 0.5,
      artifact.position.z,
    );
    return;
  }

  // Find zone color from the space
  const space = config.spaces.find(
    (s) => s.concept_id === artifact.concept_id,
  );
  const zoneColor = space?.zone_color ?? "#888888";

  createArtifactByCategory(
    scene,
    concept,
    zoneColor,
    artifact.position,
    artifact.pedestal.height,
  );
}

/**
 * Load a GLB artifact mesh via Babylon.js SceneLoader and position it on its pedestal.
 * On failure, a category-specific placeholder is created instead.
 *
 * @param scene    Babylon.js scene
 * @param artifact Artifact configuration from PalaceConfig
 * @param config   Full PalaceConfig (passed to placeholder for concept lookup)
 */
export async function loadArtifact(
  scene: Scene,
  artifact: Artifact,
  config: PalaceConfig,
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
      scene,
    );

    const root = result.meshes[0];
    root.scaling.setAll(artifact.scale);
    root.rotation.y = artifact.rotation_y;
    root.position = new Vector3(
      artifact.position.x,
      artifact.position.y + artifact.pedestal.height,
      artifact.position.z,
    );
  } catch (err) {
    console.warn(
      `Failed to load artifact ${artifact.id} from ${artifact.glb_url}, using placeholder`,
      err,
    );
    createPlaceholderArtifact(scene, artifact, config);
  }
}
