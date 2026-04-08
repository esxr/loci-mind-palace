import { Engine } from "noa-engine";

/**
 * BlockStore buffers voxel block placements in a Map keyed by "x,y,z".
 *
 * noa-engine requires a `worldDataNeeded` event handler to populate chunk
 * data before any blocks are visible. Without it, `noa.setBlock()` silently
 * does nothing because the target chunk does not yet exist.
 *
 * Usage:
 *   1. Create a BlockStore and call `install(noa)` to register the handler.
 *   2. Use `store.set(id, x, y, z)` instead of `noa.setBlock(id, x, y, z)`.
 *   3. When noa requests chunk data, the handler reads from the store.
 */
export class BlockStore {
  /** Map from "x,y,z" coordinate string to numeric block ID */
  private _blocks = new Map<string, number>();

  private static _key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  /** Buffer a block placement. */
  set(id: number, x: number, y: number, z: number): void {
    this._blocks.set(BlockStore._key(x, y, z), id);
  }

  /** Retrieve the block ID at a given position, or undefined if none stored. */
  get(x: number, y: number, z: number): number | undefined {
    return this._blocks.get(BlockStore._key(x, y, z));
  }

  /**
   * Install the `worldDataNeeded` handler on the noa engine.
   *
   * When noa needs data for a chunk at world coords (x, y, z) with the
   * configured chunkSize, this handler iterates through the chunk's voxel
   * space, looks up each coordinate in the store, writes any stored block
   * IDs into the ndarray, and finalizes the chunk via `noa.world.setChunkData`.
   */
  install(noa: Engine): void {
    const store = this;
    noa.world.on(
      "worldDataNeeded",
      (requestID: string, data: any, x: number, y: number, z: number) => {
        const size = (noa.world as any)._chunkSize as number;
        for (let i = 0; i < size; i++) {
          for (let j = 0; j < size; j++) {
            for (let k = 0; k < size; k++) {
              const wx = x + i;
              const wy = y + j;
              const wz = z + k;
              const blockId = store.get(wx, wy, wz);
              if (blockId !== undefined) {
                data.set(i, j, k, blockId);
              }
            }
          }
        }
        noa.world.setChunkData(requestID, data);
      }
    );
  }
}
