import { App, Modal, Setting, Notice, TFile } from "obsidian";
import type LociPlugin from "../main";
import { collectNotes } from "../traversal";
import { ingestNotes, generatePalace } from "../api";

interface ThemeOption {
  id: string;
  name: string;
  colors: string; // CSS linear-gradient value
}

const THEMES: ThemeOption[] = [
  {
    id: "nature",
    name: "Nature",
    colors: "linear-gradient(135deg, #56aa30, #8bc34a, #87ceeb)",
  },
  {
    id: "cityscape",
    name: "Cityscape",
    colors: "linear-gradient(135deg, #1a1a2e, #ff3296, #3296ff)",
  },
  {
    id: "space_station",
    name: "Space Station",
    colors: "linear-gradient(135deg, #000010, #64b4ff, #b4c1be)",
  },
];

const PROGRESS_STAGES = [
  "Collecting notes...",
  "Extracting concepts...",
  "Building palace...",
];

export class GenerateModal extends Modal {
  private plugin: LociPlugin;
  private selectedNotes: Set<string> = new Set();
  private depth: number = 2;
  private themeId: string = "nature";
  private generateBtn: HTMLButtonElement | null = null;
  private progressContainer: HTMLElement | null = null;
  private progressFill: HTMLElement | null = null;
  private progressText: HTMLElement | null = null;
  private errorContainer: HTMLElement | null = null;

  constructor(app: App, plugin: LociPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("loci-modal");
    contentEl.createEl("h2", { text: "Generate Mind Palace", cls: "modal-title" });

    this.renderNoteSelector(contentEl);
    this.renderDepthSelector(contentEl);
    this.renderThemePicker(contentEl);
    this.renderGenerateButton(contentEl);
    this.renderProgress(contentEl);
    this.renderError(contentEl);

    // Pre-select the active file
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && activeFile.extension === "md") {
      const title = activeFile.basename;
      this.selectedNotes.add(title);
      // Check the corresponding checkbox
      const checkbox = contentEl.querySelector(
        `input[data-note-title="${CSS.escape(title)}"]`
      ) as HTMLInputElement | null;
      if (checkbox) checkbox.checked = true;
      this.updateGenerateButton();
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderNoteSelector(container: HTMLElement): void {
    container.createEl("div", { text: "Select Notes", cls: "loci-section-label" });

    const listEl = container.createEl("div", { cls: "loci-note-list" });
    const markdownFiles = this.app.vault
      .getMarkdownFiles()
      .sort((a, b) => a.basename.localeCompare(b.basename));

    const activeFile = this.app.workspace.getActiveFile();

    for (const file of markdownFiles) {
      const itemEl = listEl.createEl("label", { cls: "loci-note-item" });
      const checkbox = itemEl.createEl("input", { type: "checkbox" });
      checkbox.dataset.noteTitle = file.basename;

      if (activeFile && file.path === activeFile.path) {
        checkbox.checked = true;
        this.selectedNotes.add(file.basename);
      }

      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          this.selectedNotes.add(file.basename);
        } else {
          this.selectedNotes.delete(file.basename);
        }
        this.updateGenerateButton();
      });

      itemEl.createEl("span", { text: file.basename });
    }
  }

  private renderDepthSelector(container: HTMLElement): void {
    new Setting(container)
      .setName("Link depth")
      .setDesc("How many levels of [[wikilinks]] to follow")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ "1": "1", "2": "2", "3": "3" })
          .setValue("2")
          .onChange((value) => {
            this.depth = parseInt(value, 10);
          })
      );
  }

  private renderThemePicker(container: HTMLElement): void {
    container.createEl("div", { text: "Theme", cls: "loci-section-label" });

    const pickerEl = container.createEl("div", { cls: "loci-theme-picker" });

    for (const theme of THEMES) {
      const card = pickerEl.createEl("div", { cls: "loci-theme-card" });
      card.dataset.theme = theme.id;

      if (theme.id === this.themeId) {
        card.addClass("selected");
      }

      const preview = card.createEl("div", { cls: "theme-preview" });
      preview.style.background = theme.colors;

      card.createEl("div", { text: theme.name, cls: "theme-name" });

      card.addEventListener("click", () => {
        this.themeId = theme.id;
        pickerEl.querySelectorAll(".loci-theme-card").forEach((el) => {
          el.removeClass("selected");
        });
        card.addClass("selected");
      });
    }
  }

  private renderGenerateButton(container: HTMLElement): void {
    const btnContainer = container.createEl("div", {
      attr: { style: "margin-top: 16px;" },
    });
    this.generateBtn = btnContainer.createEl("button", {
      text: "Build My Palace",
      cls: "loci-generate-btn",
    });
    this.generateBtn.disabled = this.selectedNotes.size === 0;
    this.generateBtn.addEventListener("click", () => this.handleGenerate());
  }

  private renderProgress(container: HTMLElement): void {
    this.progressContainer = container.createEl("div", {
      cls: "loci-progress-container",
    });
    this.progressContainer.style.display = "none";

    const bar = this.progressContainer.createEl("div", { cls: "loci-progress-bar" });
    this.progressFill = bar.createEl("div", { cls: "loci-progress-fill" });
    this.progressText = this.progressContainer.createEl("div", {
      cls: "loci-progress-text",
    });
  }

  private renderError(container: HTMLElement): void {
    this.errorContainer = container.createEl("div", {
      attr: { style: "margin-top: 12px; display: none;" },
    });
  }

  private updateGenerateButton(): void {
    if (this.generateBtn) {
      this.generateBtn.disabled = this.selectedNotes.size === 0;
    }
  }

  private setProgress(stage: number): void {
    if (!this.progressContainer || !this.progressFill || !this.progressText) return;

    this.progressContainer.style.display = "block";
    const percent = ((stage + 1) / PROGRESS_STAGES.length) * 100;
    this.progressFill.style.width = `${percent}%`;
    this.progressText.textContent = PROGRESS_STAGES[stage] ?? "";
  }

  private showError(message: string): void {
    if (!this.errorContainer) return;

    this.errorContainer.style.display = "block";
    this.errorContainer.empty();
    this.errorContainer.createEl("p", {
      text: message,
      attr: { style: "color: var(--text-error); margin-bottom: 8px;" },
    });

    const retryBtn = this.errorContainer.createEl("button", {
      text: "Retry",
      cls: "loci-generate-btn",
    });
    retryBtn.addEventListener("click", () => {
      this.errorContainer!.style.display = "none";
      this.handleGenerate();
    });
  }

  private async handleGenerate(): Promise<void> {
    if (!this.plugin.settings.apiEndpoint) {
      new Notice("Please set the API Endpoint in Loci settings first.");
      return;
    }

    // Reset UI state
    if (this.errorContainer) this.errorContainer.style.display = "none";
    if (this.generateBtn) this.generateBtn.disabled = true;

    try {
      // Stage 0: Collecting notes
      this.setProgress(0);
      const selectedTitles = Array.from(this.selectedNotes);
      const notes = await collectNotes(this.app.vault, selectedTitles, this.depth);

      if (notes.length === 0) {
        throw new Error("No notes found. Check that the selected notes exist.");
      }

      // Stage 1: Extracting concepts (ingest)
      this.setProgress(1);
      const ingestResult = await ingestNotes(
        this.plugin.settings,
        notes,
        this.depth
      );

      // Stage 2: Building palace (generate)
      this.setProgress(2);
      const result = await generatePalace(
        this.plugin.settings,
        ingestResult.graph_id,
        this.themeId
      );

      // Save to recent palaces
      if (!this.plugin.data.recentPalaces) {
        this.plugin.data.recentPalaces = [];
      }
      this.plugin.data.recentPalaces.unshift({
        palace_id: result.palace_id,
        theme_id: this.themeId,
        name: result.palace_config.metadata.name,
        created_at: result.palace_config.metadata.created_at,
      });
      await this.plugin.saveData(this.plugin.data);

      // Open in browser and close modal
      window.open(result.palace_url, "_blank");
      new Notice("Mind palace generated successfully!");
      this.close();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "An unexpected error occurred.";
      this.showError(message);
      if (this.generateBtn) this.generateBtn.disabled = false;
    }
  }
}
