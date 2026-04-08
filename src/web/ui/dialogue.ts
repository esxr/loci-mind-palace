import type { ChatMessage, NPC } from "../../shared/types";

/**
 * NPC chat panel rendered as a DOM overlay on top of the 3D canvas.
 * Supports streaming responses via SSE (fetch + ReadableStream).
 */
export class DialoguePanel {
  private container: HTMLDivElement;
  private headerName: HTMLSpanElement;
  private messagesDiv: HTMLDivElement;
  private input: HTMLInputElement;
  private sendBtn: HTMLButtonElement;
  private history: ChatMessage[] = [];
  private currentNPC: NPC | null = null;
  private palaceId: string = "";
  private onClose: (() => void) | null = null;
  private isStreaming: boolean = false;

  constructor(private apiEndpoint: string) {
    this.injectStyles();
    this.container = this.createDOM();
    this.headerName = this.container.querySelector(".loci-dialogue-name")!;
    this.messagesDiv = this.container.querySelector(".loci-dialogue-messages")!;
    this.input = this.container.querySelector(".loci-dialogue-input")!;
    this.sendBtn = this.container.querySelector(".loci-dialogue-send")!;

    this.setupEventListeners();
  }

  // ── Style injection ──────────────────────────────────────────────────

  private injectStyles(): void {
    if (document.getElementById("loci-dialogue-styles")) return;
    const style = document.createElement("style");
    style.id = "loci-dialogue-styles";
    style.textContent = `
      .loci-dialogue-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.4);
        z-index: 200;
        display: none;
        align-items: center;
        justify-content: center;
      }

      .loci-dialogue-backdrop.open {
        display: flex;
      }

      .loci-dialogue-panel {
        width: 520px;
        max-width: 90vw;
        max-height: 70vh;
        background: #1a1a2e;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
      }

      /* ── Header ── */
      .loci-dialogue-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 18px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        flex-shrink: 0;
      }

      .loci-dialogue-name {
        color: #e0e0e0;
        font-size: 16px;
        font-weight: 600;
        letter-spacing: 0.3px;
      }

      .loci-dialogue-close {
        width: 28px;
        height: 28px;
        border: none;
        background: rgba(255, 255, 255, 0.08);
        color: #a0a0b0;
        font-size: 16px;
        border-radius: 6px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s, color 0.15s;
        line-height: 1;
      }

      .loci-dialogue-close:hover {
        background: rgba(255, 80, 80, 0.25);
        color: #ff6b6b;
      }

      /* ── Messages ── */
      .loci-dialogue-messages {
        flex: 1;
        overflow-y: auto;
        padding: 16px 18px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 200px;
      }

      .loci-dialogue-messages::-webkit-scrollbar {
        width: 5px;
      }

      .loci-dialogue-messages::-webkit-scrollbar-track {
        background: transparent;
      }

      .loci-dialogue-messages::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.12);
        border-radius: 3px;
      }

      .loci-msg {
        max-width: 85%;
        padding: 10px 14px;
        border-radius: 10px;
        font-size: 14px;
        line-height: 1.55;
        word-wrap: break-word;
      }

      .loci-msg-npc {
        align-self: flex-start;
        background: rgba(255, 255, 255, 0.07);
        color: #d0d0dc;
        border-bottom-left-radius: 3px;
      }

      .loci-msg-user {
        align-self: flex-end;
        background: #2d5a9e;
        color: #eef2f9;
        border-bottom-right-radius: 3px;
      }

      .loci-msg-npc .loci-msg-label {
        display: block;
        font-size: 11px;
        font-weight: 600;
        color: #8888aa;
        margin-bottom: 4px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .loci-msg-user .loci-msg-label {
        display: block;
        font-size: 11px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.55);
        margin-bottom: 4px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        text-align: right;
      }

      /* ── Input area ── */
      .loci-dialogue-inputbar {
        display: flex;
        gap: 8px;
        padding: 12px 18px 14px;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        flex-shrink: 0;
      }

      .loci-dialogue-input {
        flex: 1;
        padding: 10px 14px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        color: #e0e0e0;
        font-size: 14px;
        font-family: inherit;
        outline: none;
        transition: border-color 0.15s;
      }

      .loci-dialogue-input::placeholder {
        color: #666680;
      }

      .loci-dialogue-input:focus {
        border-color: rgba(100, 140, 255, 0.5);
      }

      .loci-dialogue-send {
        padding: 10px 18px;
        background: #2d5a9e;
        color: #ffffff;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.15s;
        font-family: inherit;
        white-space: nowrap;
      }

      .loci-dialogue-send:hover:not(:disabled) {
        background: #3a6dbf;
      }

      .loci-dialogue-send:disabled {
        opacity: 0.5;
        cursor: default;
      }
    `;
    document.head.appendChild(style);
  }

  // ── DOM construction ──────────────────────────────────────────────────

  private createDOM(): HTMLDivElement {
    const overlay = document.getElementById("ui-overlay") || document.body;

    const backdrop = document.createElement("div");
    backdrop.className = "loci-dialogue-backdrop";
    backdrop.innerHTML = `
      <div class="loci-dialogue-panel">
        <div class="loci-dialogue-header">
          <span class="loci-dialogue-name"></span>
          <button class="loci-dialogue-close" aria-label="Close">&times;</button>
        </div>
        <div class="loci-dialogue-messages"></div>
        <div class="loci-dialogue-inputbar">
          <input class="loci-dialogue-input" type="text" placeholder="Type your message..." autocomplete="off" />
          <button class="loci-dialogue-send">Send</button>
        </div>
      </div>
    `;

    overlay.appendChild(backdrop);
    return backdrop;
  }

  // ── Event listeners ───────────────────────────────────────────────────

  private setupEventListeners(): void {
    // Close button
    const closeBtn = this.container.querySelector(".loci-dialogue-close")!;
    closeBtn.addEventListener("click", () => this.close());

    // Send on button click
    this.sendBtn.addEventListener("click", () => this.sendMessage());

    // Send on Enter key
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
      // Prevent Escape from propagating to game (handled here)
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });

    // Stop all keyboard events inside the panel from reaching the game
    this.container.addEventListener("keydown", (e) => {
      e.stopPropagation();
    });
    this.container.addEventListener("keyup", (e) => {
      e.stopPropagation();
    });
  }

  // ── Public API ────────────────────────────────────────────────────────

  open(npc: NPC, palaceId: string, onClose: () => void): void {
    this.currentNPC = npc;
    this.palaceId = palaceId;
    this.onClose = onClose;
    this.history = [];
    this.isStreaming = false;

    // Set header
    this.headerName.textContent = npc.name;

    // Clear previous messages
    this.messagesDiv.innerHTML = "";

    // Display NPC greeting
    const greeting = `Hello, traveler! I am ${npc.name}. ${npc.dialogue_context.concept_description} What would you like to know?`;
    this.appendMessage("assistant", greeting, npc.name);
    this.history.push({ role: "assistant", content: greeting });

    // Show panel
    this.container.classList.add("open");

    // Focus input after a frame (so the 'E' keypress that opened us doesn't land here)
    requestAnimationFrame(() => {
      this.input.focus();
    });
  }

  close(): void {
    this.container.classList.remove("open");
    this.currentNPC = null;
    this.isStreaming = false;

    if (this.onClose) {
      this.onClose();
      this.onClose = null;
    }
  }

  isOpen(): boolean {
    return this.container.classList.contains("open");
  }

  cleanup(): void {
    this.container.remove();
    const style = document.getElementById("loci-dialogue-styles");
    if (style) style.remove();
  }

  // ── Messaging ─────────────────────────────────────────────────────────

  private async sendMessage(): Promise<void> {
    if (this.isStreaming) return;

    const text = this.input.value.trim();
    if (!text || !this.currentNPC) return;

    // Clear input
    this.input.value = "";

    // Add user message to history and display
    this.history.push({ role: "user", content: text });
    this.appendMessage("user", text, "You");

    // Stream NPC response
    this.isStreaming = true;
    this.sendBtn.disabled = true;
    this.input.disabled = true;

    try {
      await this.streamNPCResponse(text);
    } catch (err) {
      const errorText = "I seem to be having trouble thinking right now. Please try again.";
      this.appendMessage("assistant", errorText, this.currentNPC.name);
      console.error("NPC chat error:", err);
    } finally {
      this.isStreaming = false;
      this.sendBtn.disabled = false;
      this.input.disabled = false;
      this.input.focus();
    }
  }

  private async streamNPCResponse(message: string): Promise<void> {
    if (!this.currentNPC) return;

    const response = await fetch(`${this.apiEndpoint}/npc-chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        palace_id: this.palaceId,
        concept_id: this.currentNPC.concept_id,
        message,
        conversation_history: this.history.slice(0, -1), // exclude the user message we just added (server sees it via `message`)
      }),
    });

    if (!response.ok) {
      throw new Error(`NPC chat failed: ${response.status}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    // Create a streaming message bubble
    const { contentEl } = this.appendMessage("assistant", "", this.currentNPC.name);
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));

      for (const line of lines) {
        try {
          const data = JSON.parse(line.slice(6));

          if (data.type === "chunk") {
            fullText += data.text;
            contentEl.textContent = fullText;
            this.scrollToBottom();
          }

          if (data.type === "done") {
            fullText = data.full_text || fullText;
            contentEl.textContent = fullText;
            this.scrollToBottom();
          }
        } catch {
          // Ignore malformed SSE lines
        }
      }
    }

    // Finalize: add to conversation history
    this.history.push({ role: "assistant", content: fullText });
  }

  // ── DOM helpers ───────────────────────────────────────────────────────

  private appendMessage(
    role: "user" | "assistant",
    content: string,
    label: string
  ): { el: HTMLDivElement; contentEl: HTMLSpanElement } {
    const el = document.createElement("div");
    el.className = `loci-msg ${role === "user" ? "loci-msg-user" : "loci-msg-npc"}`;

    const labelEl = document.createElement("span");
    labelEl.className = "loci-msg-label";
    labelEl.textContent = label;

    const contentEl = document.createElement("span");
    contentEl.className = "loci-msg-content";
    contentEl.textContent = content;

    el.appendChild(labelEl);
    el.appendChild(contentEl);
    this.messagesDiv.appendChild(el);

    this.scrollToBottom();

    return { el, contentEl };
  }

  private scrollToBottom(): void {
    this.messagesDiv.scrollTop = this.messagesDiv.scrollHeight;
  }
}
