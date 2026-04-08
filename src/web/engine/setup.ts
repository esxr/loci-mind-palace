import {
  Engine,
  Scene,
  FreeCamera,
  Vector3,
  HemisphericLight,
  Color3,
  Color4,
  KeyboardEventTypes,
} from "@babylonjs/core";

export interface GameEngine {
  engine: Engine;
  scene: Scene;
  camera: FreeCamera;
  canvas: HTMLCanvasElement;
  setGroundLevel: (y: number) => void;
}

/**
 * Creates and configures a pure Babylon.js engine bound to the given container element.
 * Sets up an FPS-style camera with WASD movement, gravity, and collisions.
 */
export function createEngine(container: HTMLElement): GameEngine {
  const canvas =
    (container.querySelector("canvas") as HTMLCanvasElement) ||
    document.createElement("canvas");
  if (!canvas.parentElement) container.appendChild(canvas);

  const engine = new Engine(canvas, true, {
    stencil: true,
    preserveDrawingBuffer: true,
  });
  const scene = new Scene(engine);

  // Default clear color (will be overridden by theme)
  scene.clearColor = new Color4(0.05, 0.05, 0.08, 1.0);

  // ── FPS Camera with WASD + mouse ──
  const camera = new FreeCamera("camera", new Vector3(0, 3, 0), scene);
  camera.attachControl(canvas, true);
  camera.speed = 0.5;
  camera.angularSensibility = 3000;
  camera.minZ = 0.1;
  camera.inertia = 0.85;

  // WASD keys
  camera.keysUp = [87]; // W
  camera.keysDown = [83]; // S
  camera.keysLeft = [65]; // A
  camera.keysRight = [68]; // D

  // Collision + built-in gravity for natural falling & ground detection
  scene.gravity = new Vector3(0, -0.4, 0);
  camera.applyGravity = true;
  camera.checkCollisions = true;
  camera.ellipsoid = new Vector3(0.3, 0.9, 0.3);
  scene.collisionsEnabled = true;

  // Default ambient light (overridden by theme applicator)
  const defaultLight = new HemisphericLight(
    "defaultLight",
    new Vector3(0, 1, 0),
    scene
  );
  defaultLight.intensity = 0.4;
  defaultLight.diffuse = new Color3(1, 1, 1);

  // Render loop
  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());

  // Pointer lock
  canvas.addEventListener("click", () => {
    if (!document.pointerLockElement) {
      canvas.requestPointerLock();
    }
  });

  // ── Jump (spacebar) — gravity is handled by Babylon.js built-in system ──
  let jumpVelocity = 0;
  let prevY = 0;

  scene.onKeyboardObservable.add((kbInfo) => {
    if (
      kbInfo.type === KeyboardEventTypes.KEYDOWN &&
      kbInfo.event.code === "Space"
    ) {
      // Only jump if on the ground (vertical speed ~ 0 means resting on surface)
      if (Math.abs(camera.position.y - prevY) < 0.01) {
        jumpVelocity = 0.25;
      }
    }
  });

  // Apply jump velocity on top of built-in gravity each frame
  scene.onBeforeRenderObservable.add(() => {
    if (jumpVelocity > 0) {
      camera.position.y += jumpVelocity;
      jumpVelocity -= 0.012; // decelerate upward motion; gravity pulls back down
      if (jumpVelocity <= 0) {
        jumpVelocity = 0;
      }
    }
    prevY = camera.position.y;
  });

  // setGroundLevel is kept for API compatibility but is now a no-op
  // (Babylon.js collision detection handles ground automatically)
  const setGroundLevel = (_y: number): void => {
    /* no-op — built-in gravity + collisions handle ground level */
  };

  return { engine, scene, camera, canvas, setGroundLevel };
}
