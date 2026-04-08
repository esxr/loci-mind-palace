import { Engine } from "noa-engine";
import type { ThemeConfig, BlockType } from "../../shared/types";

let blockIdCounter = 1;

/**
 * Creates and configures a noa-engine instance bound to the given container element.
 */
export function createEngine(container: HTMLElement): Engine {
  const noa = new Engine({
    domElement: container,
    showFPS: false,
    inverseY: false,
    chunkSize: 32,
    chunkAddDistance: [3, 2],
    chunkRemoveDistance: [4, 3],
    gravity: [0, -10, 0],
    playerHeight: 1.8,
    playerWidth: 0.6,
    playerStart: [0, 2, 0],
    blockTestDistance: 8,
    playerAutoStep: true,
  });
  return noa;
}

/**
 * Registers all block types from a theme palette with noa-engine.
 * Each BlockType is registered as a material (solid color) and then as a block.
 * Returns a Map from block string ID to noa numeric block ID for use in world gen.
 */
export function registerBlocks(
  noa: Engine,
  theme: ThemeConfig
): Map<string, number> {
  const blockMap = new Map<string, number>();

  const allBlocks: BlockType[] = [
    ...theme.palette.ground,
    ...theme.palette.walls,
    ...theme.palette.paths,
    ...theme.palette.accent,
    ...theme.palette.pedestal,
  ];

  for (const block of allBlocks) {
    // Skip if already registered (same id can appear in multiple palette categories)
    if (blockMap.has(block.id)) continue;

    const [r, g, b] = block.color;
    // Register the material with normalized RGB values
    noa.registry.registerMaterial(block.id, {
      color: [r / 255, g / 255, b / 255],
    });

    // Assign a numeric block ID and register the block
    const numericId = blockIdCounter++;
    noa.registry.registerBlock(numericId, {
      material: block.id,
      solid: true,
      opaque: true,
    });

    blockMap.set(block.id, numericId);
  }

  return blockMap;
}
