import Engine from "noa-engine";
import type { NPC, ChatMessage } from "../../shared/types";
import { buildNPCMesh } from "./renderer";
import { DialoguePanel } from "../ui/dialogue";
import { HUD } from "../ui/hud";

interface NPCEntity {
  npc: NPC;
  entityId: number;
  showingPrompt: boolean;
}

/**
 * Manages the full NPC lifecycle: spawning voxel entities, proximity detection,
 * interaction key bindings, and dialogue panel orchestration.
 */
export class NPCManager {
  private npcs: NPCEntity[] = [];
  private activeNPC: NPCEntity | null = null;
  private dialoguePanel: DialoguePanel;
  private hud: HUD;
  private tickHandler: (() => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    private noa: Engine,
    private palaceId: string,
    private apiEndpoint: string
  ) {
    this.dialoguePanel = new DialoguePanel(apiEndpoint);
    this.hud = new HUD();
    this.setupKeyBindings();
    this.setupTickLoop();
  }

  // ── Spawning ──────────────────────────────────────────────────────────

  /**
   * Creates a noa entity for a single NPC at its configured world position
   * with the voxel mesh defined by its model.
   */
  spawnNPC(npc: NPC): void {
    const { entityId, mesh } = buildNPCMesh(
      this.noa,
      npc.voxel_model,
      npc.position,
      npc.facing
    );

    this.npcs.push({
      npc,
      entityId,
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

  // ── Per-frame update ──────────────────────────────────────────────────

  /**
   * Called each game tick. Checks the distance from the player to every NPC
   * and shows/hides the interaction prompt when within 4 blocks.
   */
  update(): void {
    // Don't run proximity checks if dialogue is open
    if (this.dialoguePanel.isOpen()) return;

    const playerPos = this.noa.entities.getPositionData(
      this.noa.playerEntity
    )?.position;
    if (!playerPos) return;

    let closestNPC: NPCEntity | null = null;
    let closestDist = Infinity;

    for (const npcEntity of this.npcs) {
      const np = npcEntity.npc.position;
      const dx = playerPos[0] - (np.x + 0.5);
      const dy = playerPos[1] - np.y;
      const dz = playerPos[2] - (np.z + 0.5);
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

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

    // If no NPC is close enough, hide the prompt
    if (!closestNPC) {
      this.hud.hideInteractionPrompt();
    }
  }

  // ── Key bindings ──────────────────────────────────────────────────────

  private setupKeyBindings(): void {
    this.keyHandler = (e: KeyboardEvent) => {
      // Only handle 'E' key
      if (e.key !== "e" && e.key !== "E") return;

      // If dialogue is open, ignore (dialogue handles its own input)
      if (this.dialoguePanel.isOpen()) return;

      // Find the NPC currently showing a prompt
      const nearNPC = this.npcs.find((n) => n.showingPrompt);
      if (nearNPC) {
        e.preventDefault();
        e.stopPropagation();
        this.openDialogue(nearNPC);
      }
    };

    document.addEventListener("keydown", this.keyHandler);
  }

  private setupTickLoop(): void {
    this.tickHandler = () => this.update();
    this.noa.on("tick", this.tickHandler);
  }

  // ── Dialogue management ───────────────────────────────────────────────

  private openDialogue(npcEntity: NPCEntity): void {
    this.activeNPC = npcEntity;

    // Lock player controls
    this.noa.inputs.disabled = true;

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
    // Re-enable player controls
    this.noa.inputs.disabled = false;
    this.activeNPC = null;

    // Re-acquire pointer lock for game controls
    const canvas = this.noa.container?.canvas;
    if (canvas) {
      canvas.requestPointerLock();
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  /**
   * Removes all NPC entities, UI elements, and event listeners.
   */
  cleanup(): void {
    // Remove noa entities
    for (const npcEntity of this.npcs) {
      try {
        this.noa.entities.removeEntity(npcEntity.entityId);
      } catch {
        // Entity may already be removed
      }
    }
    this.npcs = [];
    this.activeNPC = null;

    // Remove tick handler
    if (this.tickHandler) {
      this.noa.off("tick", this.tickHandler);
      this.tickHandler = null;
    }

    // Remove key handler
    if (this.keyHandler) {
      document.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }

    // Cleanup UI
    this.dialoguePanel.cleanup();
    this.hud.cleanup();
  }
}
