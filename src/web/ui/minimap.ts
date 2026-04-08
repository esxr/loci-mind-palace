import type { PalaceConfig, Space, Path as LociPath } from "../../shared/types";

/**
 * 2D minimap overlay — shows a top-down view of the palace layout with the
 * player's live position. Toggle with the M key.
 *
 * Renders to a <canvas> element appended to #ui-overlay, positioned in the
 * bottom-right corner of the viewport.
 */
export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private visible: boolean = false;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  // Precomputed layout bounds
  private boundsMinX: number = 0;
  private boundsMinZ: number = 0;
  private boundsMaxX: number = 0;
  private boundsMaxZ: number = 0;
  private scale: number = 1;

  // Zone color palette for visual clustering
  private static readonly ZONE_COLORS: string[] = [
    "#56aa30", // green
    "#4a90d9", // blue
    "#d94a7a", // pink
    "#d9a04a", // orange
    "#9b59b6", // purple
    "#2ecc71", // emerald
    "#e67e22", // dark orange
    "#1abc9c", // teal
    "#e74c3c", // red
    "#3498db", // light blue
  ];

  constructor(private palaceConfig: PalaceConfig) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = 200;
    this.canvas.height = 200;
    this.ctx = this.canvas.getContext("2d")!;

    this.injectStyles();
    this.applyCanvasStyles();
    this.computeBounds();
    this.setupKeyBinding();

    const overlay = document.getElementById("ui-overlay") || document.body;
    overlay.appendChild(this.canvas);

    // Start hidden
    this.canvas.style.display = "none";
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Updates the minimap each frame with the player's current world position.
   * Does nothing if the minimap is hidden.
   */
  update(playerX: number, playerZ: number): void {
    if (!this.visible) return;

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Draw semi-transparent background
    ctx.fillStyle = "rgba(10, 10, 14, 0.8)";
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 8);
    ctx.fill();

    // Compute player-centered offset
    const centerX = w / 2;
    const centerZ = h / 2;
    const offsetX = centerX - (playerX - this.boundsMinX) * this.scale;
    const offsetZ = centerZ - (playerZ - this.boundsMinZ) * this.scale;

    // Draw paths (lines between spaces)
    this.drawPaths(ctx, offsetX, offsetZ);

    // Draw spaces (colored rectangles)
    this.drawSpaces(ctx, offsetX, offsetZ);

    // Draw player position (bright dot at center)
    this.drawPlayer(ctx, centerX, centerZ);

    // Draw border
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(0.5, 0.5, w - 1, h - 1, 8);
    ctx.stroke();

    // Draw "M" hint
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    ctx.font = "10px 'Inter', system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("M to hide", w - 8, h - 8);
  }

  /**
   * Toggle minimap visibility.
   */
  toggle(): void {
    this.visible = !this.visible;
    this.canvas.style.display = this.visible ? "block" : "none";
  }

  /**
   * Removes the minimap from the DOM and detaches event listeners.
   */
  cleanup(): void {
    this.canvas.remove();
    if (this.keyHandler) {
      document.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }
  }

  // ── Drawing helpers ────────────────────────────────────────────────────────

  private drawSpaces(
    ctx: CanvasRenderingContext2D,
    offsetX: number,
    offsetZ: number
  ): void {
    for (const space of this.palaceConfig.spaces) {
      const sx = (space.position.x - this.boundsMinX) * this.scale + offsetX;
      const sz = (space.position.z - this.boundsMinZ) * this.scale + offsetZ;
      const sw = space.size.width * this.scale;
      const sd = space.size.depth * this.scale;

      // Skip spaces entirely outside the canvas
      if (sx + sw < 0 || sx > this.canvas.width) continue;
      if (sz + sd < 0 || sz > this.canvas.height) continue;

      const color = Minimap.ZONE_COLORS[space.zone_id % Minimap.ZONE_COLORS.length];

      // Fill with zone color at reduced opacity
      ctx.fillStyle = this.hexToRgba(color, 0.35);
      ctx.fillRect(sx, sz, sw, sd);

      // Outline
      ctx.strokeStyle = this.hexToRgba(color, 0.7);
      ctx.lineWidth = 1;
      ctx.strokeRect(sx, sz, sw, sd);
    }
  }

  private drawPaths(
    ctx: CanvasRenderingContext2D,
    offsetX: number,
    offsetZ: number
  ): void {
    ctx.lineWidth = 1;

    for (const path of this.palaceConfig.paths) {
      if (path.waypoints.length < 2) continue;

      ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
      ctx.beginPath();

      const first = path.waypoints[0];
      ctx.moveTo(
        (first.x - this.boundsMinX) * this.scale + offsetX,
        (first.z - this.boundsMinZ) * this.scale + offsetZ
      );

      for (let i = 1; i < path.waypoints.length; i++) {
        const wp = path.waypoints[i];
        ctx.lineTo(
          (wp.x - this.boundsMinX) * this.scale + offsetX,
          (wp.z - this.boundsMinZ) * this.scale + offsetZ
        );
      }

      ctx.stroke();
    }
  }

  private drawPlayer(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cz: number
  ): void {
    // Outer glow
    ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
    ctx.beginPath();
    ctx.arc(cx, cz, 6, 0, Math.PI * 2);
    ctx.fill();

    // Inner dot
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(cx, cz, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Layout computation ─────────────────────────────────────────────────────

  private computeBounds(): void {
    const spaces = this.palaceConfig.spaces;
    if (spaces.length === 0) return;

    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;

    for (const space of spaces) {
      const x0 = space.position.x;
      const z0 = space.position.z;
      const x1 = x0 + space.size.width;
      const z1 = z0 + space.size.depth;

      if (x0 < minX) minX = x0;
      if (z0 < minZ) minZ = z0;
      if (x1 > maxX) maxX = x1;
      if (z1 > maxZ) maxZ = z1;
    }

    // Add padding around bounds
    const padding = 10;
    this.boundsMinX = minX - padding;
    this.boundsMinZ = minZ - padding;
    this.boundsMaxX = maxX + padding;
    this.boundsMaxZ = maxZ + padding;

    // Calculate scale to fit within the canvas
    const rangeX = this.boundsMaxX - this.boundsMinX;
    const rangeZ = this.boundsMaxZ - this.boundsMinZ;
    const scaleX = this.canvas.width / Math.max(rangeX, 1);
    const scaleZ = this.canvas.height / Math.max(rangeZ, 1);
    this.scale = Math.min(scaleX, scaleZ);
  }

  // ── Key bindings ───────────────────────────────────────────────────────────

  private setupKeyBinding(): void {
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === "m" || e.key === "M") {
        // Don't toggle if user is typing in an input/textarea
        const tag = (e.target as HTMLElement).tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea") return;

        this.toggle();
      }
    };
    document.addEventListener("keydown", this.keyHandler);
  }

  // ── Styling ────────────────────────────────────────────────────────────────

  private applyCanvasStyles(): void {
    const s = this.canvas.style;
    s.position = "fixed";
    s.bottom = "20px";
    s.right = "20px";
    s.width = "200px";
    s.height = "200px";
    s.borderRadius = "10px";
    s.zIndex = "90";
    s.pointerEvents = "none";
    s.imageRendering = "pixelated";
  }

  private injectStyles(): void {
    // No external styles needed — canvas is styled inline.
    // This method exists for symmetry with other UI modules.
  }

  // ── Utility ────────────────────────────────────────────────────────────────

  private hexToRgba(hex: string, alpha: number): string {
    const clean = hex.replace("#", "");
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
}
