/**
 * HUD overlay elements: crosshair, interaction prompt, loading indicator.
 * All elements are DOM-based and appended to #ui-overlay.
 */
export class HUD {
  private crosshair: HTMLDivElement;
  private promptDiv: HTMLDivElement;
  private loadingDiv: HTMLDivElement;
  private overlay: HTMLElement;

  constructor() {
    this.overlay = document.getElementById("ui-overlay") || document.body;
    this.injectStyles();
    this.crosshair = this.createCrosshair();
    this.promptDiv = this.createPrompt();
    this.loadingDiv = this.createLoading();
  }

  // ── Style injection ──────────────────────────────────────────────────

  private injectStyles(): void {
    if (document.getElementById("loci-hud-styles")) return;
    const style = document.createElement("style");
    style.id = "loci-hud-styles";
    style.textContent = `
      .loci-crosshair {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.85);
        box-shadow: 0 0 3px rgba(0, 0, 0, 0.6);
        pointer-events: none;
        z-index: 100;
      }

      .loci-prompt {
        position: fixed;
        top: 56%;
        left: 50%;
        transform: translateX(-50%);
        padding: 8px 18px;
        background: rgba(26, 26, 46, 0.85);
        color: #e0e0e0;
        font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
        font-size: 14px;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        pointer-events: none;
        z-index: 100;
        opacity: 0;
        transition: opacity 0.2s ease;
        white-space: nowrap;
      }

      .loci-prompt.visible {
        opacity: 1;
      }

      .loci-prompt kbd {
        display: inline-block;
        padding: 2px 6px;
        margin: 0 3px;
        background: rgba(255, 255, 255, 0.15);
        border: 1px solid rgba(255, 255, 255, 0.25);
        border-radius: 3px;
        font-family: inherit;
        font-size: 13px;
        font-weight: 600;
        color: #ffffff;
      }

      .loci-loading {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        padding: 10px 22px;
        background: rgba(26, 26, 46, 0.9);
        color: #c8c8d4;
        font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
        font-size: 14px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        z-index: 100;
        display: none;
        pointer-events: none;
      }

      .loci-loading::before {
        content: '';
        display: inline-block;
        width: 14px;
        height: 14px;
        margin-right: 10px;
        border: 2px solid rgba(255, 255, 255, 0.2);
        border-top-color: #ffffff;
        border-radius: 50%;
        animation: loci-spin 0.8s linear infinite;
        vertical-align: middle;
      }

      @keyframes loci-spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  // ── Element creation ──────────────────────────────────────────────────

  private createCrosshair(): HTMLDivElement {
    const el = document.createElement("div");
    el.className = "loci-crosshair";
    this.overlay.appendChild(el);
    return el;
  }

  private createPrompt(): HTMLDivElement {
    const el = document.createElement("div");
    el.className = "loci-prompt";
    this.overlay.appendChild(el);
    return el;
  }

  private createLoading(): HTMLDivElement {
    const el = document.createElement("div");
    el.className = "loci-loading";
    this.overlay.appendChild(el);
    return el;
  }

  // ── Public API ────────────────────────────────────────────────────────

  showInteractionPrompt(npcName: string): void {
    this.promptDiv.innerHTML = `Press <kbd>E</kbd> to talk to <strong>${npcName}</strong>`;
    this.promptDiv.classList.add("visible");
  }

  hideInteractionPrompt(): void {
    this.promptDiv.classList.remove("visible");
  }

  showLoading(text: string): void {
    this.loadingDiv.textContent = text;
    this.loadingDiv.style.display = "block";
  }

  hideLoading(): void {
    this.loadingDiv.style.display = "none";
  }

  cleanup(): void {
    this.crosshair.remove();
    this.promptDiv.remove();
    this.loadingDiv.remove();

    const style = document.getElementById("loci-hud-styles");
    if (style) style.remove();
  }
}
