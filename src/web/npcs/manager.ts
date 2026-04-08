import {
  Scene,
  FreeCamera,
  Vector3,
  Mesh,
} from "@babylonjs/core";
import type { NPC } from "../../shared/types";
import { buildNPCMesh } from "./renderer";
import { DialoguePanel } from "../ui/dialogue";
import { HUD } from "../ui/hud";
import type { GameEngine } from "../engine/setup";

interface NPCEntity {
  npc: NPC;
  mesh: Mesh;
  showingPrompt: boolean;
}

/**
 * Manages the full NPC lifecycle: spawning mesh entities, proximity detection,
 * interaction key bindings, and dialogue panel orchestration.
 *
 * Uses pure Babylon.js scene + camera instead of noa-engine.
 */
export class NPCManager {
  private npcs: NPCEntity[] = [];
  private activeNPC: NPCEntity | null = null;
  private dialoguePanel: DialoguePanel;
  private hud: HUD;
  private updateObserver: (() => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  private scene: Scene;
  private camera: FreeCamera;
  private canvas: HTMLCanvasElement;

  constructor(
    private gameEngine: GameEngine,
    private palaceId: string,
    private apiEndpoint: string
  ) {
    this.scene = gameEngine.scene;
    this.camera = gameEngine.camera;
    this.canvas = gameEngine.canvas;

    this.dialoguePanel = new DialoguePanel(apiEndpoint);
    this.hud = new HUD();
    this.setupKeyBindings();
    this.setupUpdateLoop();
  }

  // ── Spawning ──

  /**
   * Creates a mesh for a single NPC at its configured world position.
   */
  spawnNPC(npc: NPC): void {
    const { mesh } = buildNPCMesh(
      this.scene,
      npc.voxel_model,
      npc.position,
      npc.facing
    );

    this.npcs.push({
      npc,
      mesh,
      showingPrompt: false,
    });
  }

  /**
   * Spawns all NPCs from an array (typically `palaceConfig.npcs`).
   */
  spawnAll(npcs: NPC[]): void {
    for (const npc of npcs) {
      this.spawnNPC(npc);
    }
  }

  // ── Per-frame update ──

  /**
   * Called each frame. Checks the distance from the camera to every NPC
   * and shows/hides the interaction prompt when within 4 units.
   */
  update(): void {
    if (this.dialoguePanel.isOpen()) return;

    const camPos = this.camera.position;

    let closestNPC: NPCEntity | null = null;
    let closestDist = Infinity;

    for (const npcEntity of this.npcs) {
      const dist = Vector3.Distance(camPos, npcEntity.mesh.position);

      if (dist < 4 && dist < closestDist) {
        closestDist = dist;
        closestNPC = npcEntity;
      }
    }

    // Update prompt visibility
    for (const npcEntity of this.npcs) {
      if (npcEntity === closestNPC) {
        if (!npcEntity.showingPrompt) {
          this.hud.showInteractionPrompt(npcEntity.npc.name);
          npcEntity.showingPrompt = true;
        }
      } else {
        if (npcEntity.showingPrompt) {
          npcEntity.showingPrompt = false;
        }
      }
    }

    if (!closestNPC) {
      this.hud.hideInteractionPrompt();
    }
  }

  // ── Key bindings ──

  private setupKeyBindings(): void {
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key !== "e" && e.key !== "E") return;
      if (this.dialoguePanel.isOpen()) return;

      const nearNPC = this.npcs.find((n) => n.showingPrompt);
      if (nearNPC) {
        e.preventDefault();
        e.stopPropagation();
        this.openDialogue(nearNPC);
      }
    };

    document.addEventListener("keydown", this.keyHandler);
  }

  private setupUpdateLoop(): void {
    this.updateObserver = () => this.update();
    this.scene.registerBeforeRender(this.updateObserver);
  }

  // ── Dialogue management ──

  private openDialogue(npcEntity: NPCEntity): void {
    this.activeNPC = npcEntity;

    // Detach camera controls to prevent movement during dialogue
    this.camera.detachControl();

    // Release pointer lock so user can interact with dialogue UI
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }

    // Hide interaction prompt
    this.hud.hideInteractionPrompt();

    // Open the dialogue panel
    this.dialoguePanel.open(npcEntity.npc, this.palaceId, () => {
      this.closeDialogue();
    });
  }

  private closeDialogue(): void {
    // Re-enable camera controls
    this.camera.attachControl(this.canvas, true);
    this.activeNPC = null;

    // Re-acquire pointer lock for game controls
    this.canvas.requestPointerLock();
  }

  // ── Cleanup ──

  /**
   * Removes all NPC meshes, UI elements, and event listeners.
   */
  cleanup(): void {
    for (const npcEntity of this.npcs) {
      if (!npcEntity.mesh.isDisposed()) {
        npcEntity.mesh.dispose(false, true);
      }
    }
    this.npcs = [];
    this.activeNPC = null;

    if (this.updateObserver) {
      this.scene.unregisterBeforeRender(this.updateObserver);
      this.updateObserver = null;
    }

    if (this.keyHandler) {
      document.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }

    this.dialoguePanel.cleanup();
    this.hud.cleanup();
  }
}
