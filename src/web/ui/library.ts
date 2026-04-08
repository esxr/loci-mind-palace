import type { PalaceConfig } from "../../shared/types";

/**
 * Palace Library page — lists all available palaces as cards and allows
 * navigating into a 3D palace viewer, or generating a demo palace.
 */
export class Library {
  constructor(
    private supabaseUrl: string,
    private supabaseAnonKey: string
  ) {}

  // ── Public API ────────────────────────────────────────────────────────────

  async render(container: HTMLElement): Promise<void> {
    this.injectStyles();
    container.innerHTML = "";

    // Build page shell
    const page = document.createElement("div");
    page.className = "loci-library";
    page.innerHTML = `
      <header class="loci-library-header">
        <h1 class="loci-library-title">Loci</h1>
        <p class="loci-library-subtitle">Your Mind Palaces</p>
      </header>
      <div class="loci-library-content">
        <div class="loci-library-loading">
          <div class="loci-library-spinner"></div>
          <p>Loading palaces...</p>
        </div>
      </div>
    `;
    container.appendChild(page);

    const content = page.querySelector(".loci-library-content") as HTMLDivElement;

    try {
      const palaces = await this.fetchPalaces();
      content.innerHTML = "";

      if (palaces.length === 0) {
        content.innerHTML = `
          <div class="loci-library-empty">
            <div class="loci-library-empty-icon">&#9670;</div>
            <h2>No palaces yet</h2>
            <p>Generate one from Obsidian using the Loci plugin, or create a demo below.</p>
            <button class="loci-library-demo-btn">Create with Demo Data</button>
          </div>
        `;
        const demoBtn = content.querySelector(".loci-library-demo-btn") as HTMLButtonElement;
        demoBtn.addEventListener("click", () => this.createDemoPalace(content));
        return;
      }

      // Build card grid
      const grid = document.createElement("div");
      grid.className = "loci-library-grid";

      for (const palace of palaces) {
        const card = this.buildCard(palace);
        grid.appendChild(card);
      }

      // Append grid + demo button
      content.appendChild(grid);

      const footer = document.createElement("div");
      footer.className = "loci-library-footer";
      footer.innerHTML = `<button class="loci-library-demo-btn loci-library-demo-btn-small">Create with Demo Data</button>`;
      const demoBtn = footer.querySelector(".loci-library-demo-btn") as HTMLButtonElement;
      demoBtn.addEventListener("click", () => this.createDemoPalace(content));
      content.appendChild(footer);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      content.innerHTML = `
        <div class="loci-library-empty">
          <div class="loci-library-empty-icon" style="color:#ff6b6b">!</div>
          <h2>Failed to load palaces</h2>
          <p>${this.escapeHtml(message)}</p>
          <button class="loci-library-demo-btn" onclick="location.reload()">Retry</button>
        </div>
      `;
      console.error("Library fetch error:", err);
    }
  }

  // ── Data fetching ──────────────────────────────────────────────────────────

  private async fetchPalaces(): Promise<
    Array<{ id: string; palace_config: PalaceConfig }>
  > {
    const url = `${this.supabaseUrl}/rest/v1/palaces?status=eq.ready&select=id,palace_config&order=created_at.desc`;
    const res = await fetch(url, {
      headers: {
        apikey: this.supabaseAnonKey,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Supabase returned ${res.status}: ${res.statusText}`);
    }

    return res.json();
  }

  // ── Card building ──────────────────────────────────────────────────────────

  private buildCard(
    palace: { id: string; palace_config: PalaceConfig }
  ): HTMLDivElement {
    const config = palace.palace_config;
    const meta = config.metadata;

    const themeColorMap: Record<string, string> = {
      nature: "#56aa30",
      cityscape: "#ff3296",
      space_station: "#64b4ff",
    };
    const accentColor = themeColorMap[meta.theme_id] || "#888";

    const themeNameMap: Record<string, string> = {
      nature: "Nature Garden",
      cityscape: "Neon City",
      space_station: "Space Station",
    };
    const themeName = themeNameMap[meta.theme_id] || meta.theme_id;

    const dateStr = this.formatDate(meta.created_at);

    const card = document.createElement("div");
    card.className = "loci-library-card";

    card.innerHTML = `
      <div class="loci-card-accent" style="background: ${accentColor}"></div>
      <div class="loci-card-body">
        <h3 class="loci-card-name">${this.escapeHtml(meta.name)}</h3>
        <div class="loci-card-meta">
          <span class="loci-card-concepts">${meta.concept_count} concept${meta.concept_count !== 1 ? "s" : ""}</span>
          <span class="loci-card-theme" style="color: ${accentColor}">${this.escapeHtml(themeName)}</span>
        </div>
        <span class="loci-card-date">${dateStr}</span>
        <button class="loci-card-enter">Enter Palace &rarr;</button>
      </div>
    `;

    const enterBtn = card.querySelector(".loci-card-enter") as HTMLButtonElement;
    enterBtn.addEventListener("click", () => {
      window.location.hash = `#/palace/${palace.id}`;
    });

    // Also allow clicking the card itself (but not double-navigating on button)
    card.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".loci-card-enter")) return;
      window.location.hash = `#/palace/${palace.id}`;
    });

    return card;
  }

  // ── Demo palace ────────────────────────────────────────────────────────────

  private async createDemoPalace(contentEl: HTMLDivElement): Promise<void> {
    const btn = contentEl.querySelector(".loci-library-demo-btn") as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Generating...";
    }

    try {
      const res = await fetch(`${this.supabaseUrl}/functions/v1/generate-palace`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: this.supabaseAnonKey,
        },
        body: JSON.stringify({
          graph_id: "__demo__",
          theme_id: "nature",
        }),
      });

      if (!res.ok) {
        throw new Error(`Generation failed: ${res.status}`);
      }

      const data = await res.json();
      if (data.palace_id) {
        window.location.hash = `#/palace/${data.palace_id}`;
      } else {
        throw new Error("No palace_id in response");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Create with Demo Data";
      }
      alert(`Failed to create demo palace: ${message}`);
      console.error("Demo palace error:", err);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private formatDate(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return iso;
    }
  }

  private escapeHtml(s: string): string {
    const el = document.createElement("span");
    el.textContent = s;
    return el.innerHTML;
  }

  // ── Styles ─────────────────────────────────────────────────────────────────

  private injectStyles(): void {
    if (document.getElementById("loci-library-styles")) return;
    const style = document.createElement("style");
    style.id = "loci-library-styles";
    style.textContent = `
      .loci-library {
        min-height: 100vh;
        background: #0a0a0a;
        color: #e0e0e0;
        font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
        overflow-y: auto;
      }

      /* ── Header ── */
      .loci-library-header {
        text-align: center;
        padding: 64px 24px 40px;
      }

      .loci-library-title {
        font-size: 42px;
        font-weight: 700;
        letter-spacing: -0.5px;
        color: #ffffff;
        margin: 0 0 8px;
        background: linear-gradient(135deg, #ffffff 0%, #aabbdd 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .loci-library-subtitle {
        font-size: 16px;
        color: #666680;
        margin: 0;
        font-weight: 400;
        letter-spacing: 0.3px;
      }

      /* ── Content area ── */
      .loci-library-content {
        max-width: 960px;
        margin: 0 auto;
        padding: 0 24px 64px;
      }

      /* ── Loading state ── */
      .loci-library-loading {
        text-align: center;
        padding: 80px 0;
        color: #666680;
      }

      .loci-library-spinner {
        width: 36px;
        height: 36px;
        margin: 0 auto 16px;
        border: 3px solid rgba(255, 255, 255, 0.08);
        border-top-color: rgba(255, 255, 255, 0.5);
        border-radius: 50%;
        animation: loci-lib-spin 0.8s linear infinite;
      }

      @keyframes loci-lib-spin {
        to { transform: rotate(360deg); }
      }

      /* ── Empty state ── */
      .loci-library-empty {
        text-align: center;
        padding: 80px 0;
      }

      .loci-library-empty-icon {
        font-size: 48px;
        color: #444460;
        margin-bottom: 20px;
        line-height: 1;
      }

      .loci-library-empty h2 {
        font-size: 22px;
        color: #c8c8d4;
        margin: 0 0 10px;
        font-weight: 600;
      }

      .loci-library-empty p {
        font-size: 14px;
        color: #666680;
        margin: 0 0 32px;
        line-height: 1.6;
        max-width: 360px;
        margin-left: auto;
        margin-right: auto;
      }

      /* ── Card grid ── */
      .loci-library-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 20px;
      }

      .loci-library-card {
        background: #141418;
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 12px;
        overflow: hidden;
        cursor: pointer;
        transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
      }

      .loci-library-card:hover {
        transform: translateY(-2px);
        border-color: rgba(255, 255, 255, 0.12);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
      }

      .loci-card-accent {
        height: 4px;
        width: 100%;
      }

      .loci-card-body {
        padding: 20px 22px 22px;
      }

      .loci-card-name {
        font-size: 17px;
        font-weight: 600;
        color: #e8e8ee;
        margin: 0 0 12px;
        line-height: 1.3;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .loci-card-meta {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 8px;
        font-size: 13px;
      }

      .loci-card-concepts {
        color: #888898;
      }

      .loci-card-theme {
        font-weight: 500;
      }

      .loci-card-date {
        display: block;
        font-size: 12px;
        color: #555568;
        margin-bottom: 18px;
      }

      .loci-card-enter {
        display: inline-block;
        padding: 8px 18px;
        background: rgba(255, 255, 255, 0.06);
        color: #c0c0d0;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 6px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        font-family: inherit;
        transition: background 0.15s, color 0.15s, border-color 0.15s;
      }

      .loci-card-enter:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #ffffff;
        border-color: rgba(255, 255, 255, 0.2);
      }

      /* ── Footer ── */
      .loci-library-footer {
        text-align: center;
        padding: 40px 0 0;
      }

      /* ── Demo button ── */
      .loci-library-demo-btn {
        padding: 12px 28px;
        background: #2d5a9e;
        color: #ffffff;
        border: none;
        border-radius: 8px;
        font-size: 15px;
        font-weight: 500;
        cursor: pointer;
        font-family: inherit;
        transition: background 0.15s;
      }

      .loci-library-demo-btn:hover:not(:disabled) {
        background: #3a6dbf;
      }

      .loci-library-demo-btn:disabled {
        opacity: 0.5;
        cursor: default;
      }

      .loci-library-demo-btn-small {
        font-size: 13px;
        padding: 9px 22px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: #a0a0b0;
      }

      .loci-library-demo-btn-small:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.1);
        color: #ffffff;
      }
    `;
    document.head.appendChild(style);
  }
}
