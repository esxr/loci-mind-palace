import { Plugin, Notice } from "obsidian";
import {
  LociSettingTab,
  DEFAULT_SETTINGS,
  type LociPluginSettings,
} from "./settings";
import { GenerateModal } from "./modals/generate-modal";

interface RecentPalace {
  palace_id: string;
  theme_id: string;
  name: string;
  created_at: string;
}

interface LociPluginData {
  settings: LociPluginSettings;
  recentPalaces: RecentPalace[];
}

const DEFAULT_DATA: LociPluginData = {
  settings: { ...DEFAULT_SETTINGS },
  recentPalaces: [],
};

export default class LociPlugin extends Plugin {
  settings: LociPluginSettings = { ...DEFAULT_SETTINGS };
  data: LociPluginData = { ...DEFAULT_DATA };

  async onload(): Promise<void> {
    await this.loadSettings();

    // Ribbon icon — opens the generation modal
    this.addRibbonIcon("lucide-brain", "Loci — Generate Mind Palace", () => {
      new GenerateModal(this.app, this).open();
    });

    // Command: Generate Mind Palace
    this.addCommand({
      id: "generate-palace",
      name: "Generate Mind Palace",
      callback: () => {
        new GenerateModal(this.app, this).open();
      },
    });

    // Command: Open Palace Library
    this.addCommand({
      id: "open-library",
      name: "Palace Library",
      callback: () => {
        if (!this.settings.apiEndpoint) {
          new Notice("Please set the API Endpoint in Loci settings first.");
          return;
        }
        const libraryUrl = this.settings.apiEndpoint.replace(
          "/functions/v1",
          ""
        );
        window.open(libraryUrl, "_blank");
      },
    });

    // Settings tab
    this.addSettingTab(new LociSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    const saved = await this.loadData();
    this.data = Object.assign({}, DEFAULT_DATA, saved);
    this.settings = this.data.settings;
  }

  async saveSettings(): Promise<void> {
    this.data.settings = this.settings;
    await this.saveData(this.data);
  }
}
