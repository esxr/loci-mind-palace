import { App, PluginSettingTab, Setting } from "obsidian";
import type LociPlugin from "./main";

export interface LociPluginSettings {
  apiEndpoint: string;
}

export const DEFAULT_SETTINGS: LociPluginSettings = {
  apiEndpoint: "",
};

export class LociSettingTab extends PluginSettingTab {
  plugin: LociPlugin;

  constructor(app: App, plugin: LociPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Loci — Mind Palace Generator" });

    new Setting(containerEl)
      .setName("API Endpoint")
      .setDesc(
        "Supabase Edge Functions base URL (e.g. https://xyz.supabase.co/functions/v1)"
      )
      .addText((text) =>
        text
          .setPlaceholder("https://your-project.supabase.co/functions/v1")
          .setValue(this.plugin.settings.apiEndpoint)
          .onChange(async (value) => {
            this.plugin.settings.apiEndpoint = value.trim();
            await this.plugin.saveSettings();
          })
      );
  }
}
