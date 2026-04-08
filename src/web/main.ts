/**
 * Loci -- Main entry point.
 *
 * Hash-based routing:
 *   /#/           -> Library page (list of palaces)
 *   /#/library    -> Library page
 *   /#/palace/:id -> 3D palace viewer
 *   /#/demo       -> Demo palace loaded from /seed-palace.json (no backend required)
 */

import { createEngine } from "./engine/setup";
import type { GameEngine } from "./engine/setup";
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
  overlay.addEventListener("transitionend", () => overlay.remove(), {
    once: true,
  });
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

/**
 * Shared palace initialization -- sets up engine, theme, world, NPCs, HUD, minimap.
 * Uses pure Babylon.js GameEngine instead of noa-engine.
 */
async function initPalace(
  config: PalaceConfig,
  app: HTMLElement,
  uiOverlay: HTMLElement,
  palaceId?: string
): Promise<void> {
  // Get theme (use embedded theme from config, fallback to registry)
  const theme = config.theme || getThemeById(config.metadata.theme_id);

  // Create Babylon.js engine bound to #app container
  const gameEngine: GameEngine = createEngine(app);

  // Apply theme visuals and get materials map
  const materials = applyTheme(gameEngine.scene, theme);

  // Generate world geometry (spaces, paths, pedestals, artifacts)
  await generateWorld(gameEngine, config, materials);

  // Create NPCManager and spawn all NPCs
  const apiEndpoint = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1` : "";
  const npcManager = new NPCManager(
    gameEngine,
    palaceId || "__demo__",
    apiEndpoint
  );
  npcManager.spawnAll(config.npcs);

  // Create HUD (crosshair, interaction prompt, etc.)
  const hud = new HUD();

  // Create minimap
  const minimap = new Minimap(config);

  // Hook minimap updates into the render loop
  gameEngine.scene.registerBeforeRender(() => {
    const pos = gameEngine.camera.position;
    minimap.update(pos.x, pos.z);
  });
}

async function loadPalace(
  palaceId: string,
  app: HTMLElement,
  uiOverlay: HTMLElement
): Promise<void> {
  if (!SUPABASE_URL) {
    showErrorOverlay(app, "Configure SUPABASE_URL to connect to backend");
    return;
  }

  const loadingOverlay = showLoadingScreen(app);

  try {
    const palaceConfig = await fetchPalaceConfig(palaceId);
    await initPalace(palaceConfig, app, uiOverlay, palaceId);
    hideLoadingScreen(loadingOverlay);
  } catch (err) {
    if (loadingOverlay.parentNode) loadingOverlay.remove();
    const message =
      err instanceof Error ? err.message : "An unknown error occurred";
    showErrorOverlay(app, message);
    console.error("Failed to load palace:", err);
  }
}

// ── Demo mode ────────────────────────────────────────────────────────────────

async function loadDemo(
  app: HTMLElement,
  uiOverlay: HTMLElement
): Promise<void> {
  const loadingOverlay = showLoadingScreen(app);

  try {
    const response = await fetch("/seed-palace.json");
    if (!response.ok) {
      throw new Error(
        `Failed to fetch seed palace: ${response.status} ${response.statusText}`
      );
    }
    const config: PalaceConfig = await response.json();
    await initPalace(config, app, uiOverlay);
    hideLoadingScreen(loadingOverlay);
  } catch (err) {
    if (loadingOverlay.parentNode) loadingOverlay.remove();
    const message =
      err instanceof Error ? err.message : "An unknown error occurred";
    showErrorOverlay(app, message);
    console.error("Failed to load demo palace:", err);
  }
}

// ── Library page ─────────────────────────────────────────────────────────────

function showLibrary(app: HTMLElement, _uiOverlay: HTMLElement): void {
  const library = new Library(SUPABASE_URL, SUPABASE_ANON_KEY);
  library.render(app).then(() => {
    const content = app.querySelector(".loci-library-content");
    if (!content) return;

    if (!SUPABASE_URL) {
      const notice = document.createElement("div");
      notice.className = "loci-library-notice";
      notice.innerHTML = `
        <p style="text-align:center; color:#888898; font-size:14px; padding:12px 0 0;">
          Configure SUPABASE_URL to connect to backend
        </p>
      `;
      content.prepend(notice);
    }

    let footer = content.querySelector(
      ".loci-library-footer"
    ) as HTMLDivElement | null;
    if (!footer) {
      footer = document.createElement("div");
      footer.className = "loci-library-footer";
      content.appendChild(footer);
    }

    if (!footer.querySelector(".loci-library-demo-palace-btn")) {
      const demoBtn = document.createElement("button");
      demoBtn.className =
        "loci-library-demo-btn loci-library-demo-palace-btn";
      demoBtn.textContent = "Try Demo Palace";
      demoBtn.style.marginLeft = "12px";
      demoBtn.addEventListener("click", () => {
        window.location.hash = "#/demo";
      });
      footer.appendChild(demoBtn);
    }
  });
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

  if (hash === "#/demo") {
    await loadDemo(app, uiOverlay);
  } else if (hash.startsWith("#/palace/")) {
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
