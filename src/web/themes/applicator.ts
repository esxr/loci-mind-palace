import { Engine } from "noa-engine";
import {
  Color3,
  Color4,
  Vector3,
  HemisphericLight,
  DirectionalLight,
  ParticleSystem,
  Texture,
} from "@babylonjs/core";
import type { ThemeConfig, ParticleConfig } from "../../shared/types";

/**
 * Parses a hex color string (e.g. "#ff00aa") into a Babylon.js Color3.
 */
function hexToColor3(hex: string): Color3 {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return new Color3(r, g, b);
}

/**
 * Parses a hex color string into a Babylon.js Color4 with the given alpha.
 */
function hexToColor4(hex: string, alpha: number = 1.0): Color4 {
  const c = hexToColor3(hex);
  return new Color4(c.r, c.g, c.b, alpha);
}

/**
 * Creates a particle system for a given particle config entry.
 * Emits particles from a point above the player (or scene center).
 */
function createParticleSystem(
  scene: any,
  config: ParticleConfig,
  index: number
): ParticleSystem {
  const ps = new ParticleSystem(`particles_${config.type}_${index}`, 200, scene);

  // Use a default circle texture for particles (generated procedurally)
  ps.createPointEmitter(new Vector3(-50, 10, -50), new Vector3(50, 20, 50));

  const color = hexToColor4(config.color, 1.0);
  const colorFaded = hexToColor4(config.color, 0.0);

  ps.color1 = color;
  ps.color2 = new Color4(color.r, color.g, color.b, 0.6);
  ps.colorDead = colorFaded;

  // Adjust behavior by particle type
  switch (config.type) {
    case "fireflies":
      ps.minLifeTime = 2;
      ps.maxLifeTime = 5;
      ps.emitRate = Math.floor(50 * config.density);
      ps.minSize = 0.05;
      ps.maxSize = 0.15;
      ps.gravity = new Vector3(0, 0.2, 0);
      break;
    case "rain":
      ps.minLifeTime = 0.5;
      ps.maxLifeTime = 1.5;
      ps.emitRate = Math.floor(300 * config.density);
      ps.minSize = 0.02;
      ps.maxSize = 0.05;
      ps.gravity = new Vector3(0, -15, 0);
      break;
    case "snow":
      ps.minLifeTime = 3;
      ps.maxLifeTime = 6;
      ps.emitRate = Math.floor(100 * config.density);
      ps.minSize = 0.05;
      ps.maxSize = 0.12;
      ps.gravity = new Vector3(0, -2, 0);
      break;
    case "stars":
      ps.minLifeTime = 4;
      ps.maxLifeTime = 8;
      ps.emitRate = Math.floor(40 * config.density);
      ps.minSize = 0.02;
      ps.maxSize = 0.08;
      ps.gravity = new Vector3(0, 0, 0);
      break;
    case "dust":
      ps.minLifeTime = 2;
      ps.maxLifeTime = 4;
      ps.emitRate = Math.floor(30 * config.density);
      ps.minSize = 0.03;
      ps.maxSize = 0.08;
      ps.gravity = new Vector3(0, -0.5, 0);
      break;
    case "embers":
      ps.minLifeTime = 1;
      ps.maxLifeTime = 3;
      ps.emitRate = Math.floor(60 * config.density);
      ps.minSize = 0.03;
      ps.maxSize = 0.1;
      ps.gravity = new Vector3(0, 1, 0);
      break;
    case "bubbles":
      ps.minLifeTime = 2;
      ps.maxLifeTime = 5;
      ps.emitRate = Math.floor(40 * config.density);
      ps.minSize = 0.05;
      ps.maxSize = 0.15;
      ps.gravity = new Vector3(0, 2, 0);
      break;
    default:
      ps.minLifeTime = 2;
      ps.maxLifeTime = 4;
      ps.emitRate = Math.floor(50 * config.density);
      ps.minSize = 0.05;
      ps.maxSize = 0.1;
      ps.gravity = new Vector3(0, 0, 0);
  }

  ps.start();
  return ps;
}

/**
 * Applies a theme's visual configuration to the noa-engine scene.
 * Sets up ambient/directional lighting, fog, skybox clear color, and particle systems.
 */
export function applyTheme(
  noa: Engine,
  theme: ThemeConfig,
  blockMap: Map<string, number>
): void {
  const scene = noa.rendering.getScene();

  // --- Ambient Lighting ---
  const ambientLight = new HemisphericLight(
    "ambient",
    new Vector3(0, 1, 0),
    scene
  );
  ambientLight.diffuse = hexToColor3(theme.lighting.ambient.color);
  ambientLight.intensity = theme.lighting.ambient.intensity;
  ambientLight.groundColor = hexToColor3(theme.lighting.ambient.color).scale(0.5);

  // --- Directional Lighting ---
  const [dx, dy, dz] = theme.lighting.directional.direction;
  const dirLight = new DirectionalLight(
    "directional",
    new Vector3(dx, dy, dz),
    scene
  );
  dirLight.diffuse = hexToColor3(theme.lighting.directional.color);
  dirLight.intensity = theme.lighting.directional.intensity;

  // --- Fog ---
  scene.fogMode = 2; // FOGMODE_LINEAR
  scene.fogColor = hexToColor3(theme.fog.color);
  scene.fogStart = theme.fog.near;
  scene.fogEnd = theme.fog.far;

  // --- Skybox (clear color as gradient approximation) ---
  // Babylon.js scene.clearColor sets the background. We use the top_color for this.
  // For a gradient effect, a skybox mesh would be ideal, but clearColor is the
  // simplest approach and works well with fog blending.
  scene.clearColor = hexToColor4(theme.skybox.top_color, 1.0);

  // --- Particle Systems ---
  theme.particles.forEach((particleConfig, index) => {
    createParticleSystem(scene, particleConfig, index);
  });
}
