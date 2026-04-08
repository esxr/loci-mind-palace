/**
 * Loci — Main entry point.
 *
 * Hash-based routing:
 *   /#/           → Library page (list of palaces)
 *   /#/library    → Library page
 *   /#/palace/:id → 3D palace viewer
 */

import { createEngine, registerBlocks } from "./engine/setup";
import { getThemeById } from "./themes/index";
import { applyTheme } from "./themes/applicator";
import { generateWorld } from "./world/generator";
import { NPCManager } from "./npcs/manager";
import { HUD } from "./ui/hud";
import { Minimap } from "./ui/minimap";
import { Library } from "./ui/library";
import type { PalaceConfig } from "../shared/types";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

// ── Loading overlay ──────────────────────────────────────────────────────────

function showLoadingScreen(container: HTMLElement): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.id = "loci-loading-overlay";
  overlay.innerHTML = `
    <div class="loci-loading-inner">
      <div class="loci-loading-spinner"></div>
      <p class="loci-loading-text">Loading palace<span class="loci-loading-dots"></span></p>
    </div>
  `;
  injectLoadingStyles();
  container.appendChild(overlay);
  return overlay;
}

function hideLoadingScreen(overlay: HTMLDivElement): void {
  overlay.classList.add("loci-loading-fade-out");
  overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
  // Fallback removal in case transitionend never fires
  setTimeout(() => {
    if (overlay.parentNode) overlay.remove();
  }, 600);
}

function showErrorOverlay(container: HTMLElement, message: string): void {
  const overlay = document.createElement("div");
  overlay.id = "loci-error-overlay";
  overlay.innerHTML = `
    <div class="loci-error-inner">
      <div class="loci-error-icon">!</div>
      <h2>Failed to load palace</h2>
      <p>${escapeHtml(message)}</p>
      <button class="loci-error-btn" onclick="window.location.hash='#/library'">Back to Library</button>
    </div>
  `;
  injectErrorStyles();
  container.appendChild(overlay);
}

function escapeHtml(s: string): string {
  const el = document.createElement("span");
  el.textContent = s;
  return el.innerHTML;
}

// ── Style injection ──────────────────────────────────────────────────────────

function injectLoadingStyles(): void {
  if (document.getElementById("loci-loading-styles")) return;
  const style = document.createElement("style");
  style.id = "loci-loading-styles";
  style.textContent = `
    #loci-loading-overlay {
      position: fixed;
      inset: 0;
      background: #0a0a0a;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      transition: opacity 0.4s ease;
    }
    #loci-loading-overlay.loci-loading-fade-out {
      opacity: 0;
      pointer-events: none;
    }
    .loci-loading-inner {
      text-align: center;
      color: #c8c8d4;
      font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
    }
    .loci-loading-spinner {
      width: 48px;
      height: 48px;
      margin: 0 auto 24px;
      border: 3px solid rgba(255, 255, 255, 0.1);
      border-top-color: rgba(255, 255, 255, 0.7);
      border-radius: 50%;
      animation: loci-load-spin 0.8s linear infinite;
    }
    .loci-loading-text {
      font-size: 18px;
      letter-spacing: 0.3px;
    }
    .loci-loading-dots::after {
      content: '';
      animation: loci-load-dots 1.5s steps(4, end) infinite;
    }
    @keyframes loci-load-spin {
      to { transform: rotate(360deg); }
    }
    @keyframes loci-load-dots {
      0%   { content: ''; }
      25%  { content: '.'; }
      50%  { content: '..'; }
      75%  { content: '...'; }
      100% { content: ''; }
    }
  `;
  document.head.appendChild(style);
}

function injectErrorStyles(): void {
  if (document.getElementById("loci-error-styles")) return;
  const style = document.createElement("style");
  style.id = "loci-error-styles";
  style.textContent = `
    #loci-error-overlay {
      position: fixed;
      inset: 0;
      background: #0a0a0a;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
    }
    .loci-error-inner {
      text-align: center;
      color: #c8c8d4;
      font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
      max-width: 420px;
      padding: 40px;
    }
    .loci-error-icon {
      width: 56px;
      height: 56px;
      margin: 0 auto 20px;
      border-radius: 50%;
      background: rgba(255, 80, 80, 0.15);
      color: #ff6b6b;
      font-size: 28px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid rgba(255, 80, 80, 0.3);
    }
    .loci-error-inner h2 {
      font-size: 20px;
      color: #e0e0e0;
      margin: 0 0 12px;
      font-weight: 600;
    }
    .loci-error-inner p {
      font-size: 14px;
      color: #888;
      margin: 0 0 28px;
      line-height: 1.6;
    }
    .loci-error-btn {
      padding: 10px 24px;
      background: #2d5a9e;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.15s;
    }
    .loci-error-btn:hover {
      background: #3a6dbf;
    }
  `;
  document.head.appendChild(style);
}

// ── Palace loading ───────────────────────────────────────────────────────────

async function fetchPalaceConfig(palaceId: string): Promise<PalaceConfig> {
  const url = `${SUPABASE_URL}/rest/v1/palaces?id=eq.${encodeURIComponent(palaceId)}&select=palace_config`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Supabase returned ${res.status}: ${res.statusText}`);
  }

  const rows: Array<{ palace_config: PalaceConfig }> = await res.json();
  if (!rows || rows.length === 0) {
    throw new Error("Palace not found");
  }

  return rows[0].palace_config;
}

async function loadPalace(
  palaceId: string,
  app: HTMLElement,
  uiOverlay: HTMLElement
): Promise<void> {
  // 1. Show loading screen
  const loadingOverlay = showLoadingScreen(app);

  try {
    // 2. Fetch palace config from Supabase
    const palaceConfig = await fetchPalaceConfig(palaceId);

    // 3. Get theme (use embedded theme from config, fallback to registry)
    const theme = palaceConfig.theme || getThemeById(palaceConfig.metadata.theme_id);

    // 4. Create noa-engine bound to #app container
    const noa = createEngine(app);

    // 5. Register block types from theme palette
    const blockMap = registerBlocks(noa, theme);

    // 6. Apply theme visuals (lighting, fog, skybox, particles)
    applyTheme(noa, theme, blockMap);

    // 7. Generate world geometry (spaces, paths, pedestals, artifacts)
    await generateWorld(noa, palaceConfig, blockMap);

    // 8. Create NPCManager and spawn all NPCs
    const apiEndpoint = `${SUPABASE_URL}/functions/v1`;
    const npcManager = new NPCManager(noa, palaceId, apiEndpoint);
    npcManager.spawnAll(palaceConfig.npcs);

    // 9. Create HUD (crosshair, interaction prompt, etc.)
    const hud = new HUD();

    // 10. Create minimap
    const minimap = new Minimap(palaceConfig);

    // 11. Hook minimap updates into the game loop
    noa.on("tick", () => {
      const pos = noa.entities.getPositionData(noa.playerEntity)?.position;
      if (pos) {
        minimap.update(pos[0], pos[2]);
      }
    });

    // 12. Hide loading screen
    hideLoadingScreen(loadingOverlay);

    // 13. Request pointer lock on canvas click for FPS controls
    const canvas = app.querySelector("canvas");
    if (canvas) {
      canvas.addEventListener("click", () => {
        if (!document.pointerLockElement) {
          canvas.requestPointerLock();
        }
      });
    }
  } catch (err) {
    // Remove loading screen, show error
    if (loadingOverlay.parentNode) loadingOverlay.remove();
    const message = err instanceof Error ? err.message : "An unknown error occurred";
    showErrorOverlay(app, message);
    console.error("Failed to load palace:", err);
  }
}

// ── Library page ─────────────────────────────────────────────────────────────

function showLibrary(app: HTMLElement, _uiOverlay: HTMLElement): void {
  const library = new Library(SUPABASE_URL, SUPABASE_ANON_KEY);
  library.render(app);
}

// ── Router ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const hash = window.location.hash || "#/library";
  const app = document.getElementById("app")!;
  const uiOverlay = document.getElementById("ui-overlay")!;

  // Clean up any previous overlays/errors (on hash change)
  const prevLoading = document.getElementById("loci-loading-overlay");
  if (prevLoading) prevLoading.remove();
  const prevError = document.getElementById("loci-error-overlay");
  if (prevError) prevError.remove();

  if (hash.startsWith("#/palace/")) {
    const palaceId = hash.replace("#/palace/", "");
    if (!palaceId) {
      showErrorOverlay(app, "No palace ID provided in the URL.");
      return;
    }
    await loadPalace(palaceId, app, uiOverlay);
  } else {
    showLibrary(app, uiOverlay);
  }
}

// Listen for hash changes to navigate
window.addEventListener("hashchange", () => main());
main();
