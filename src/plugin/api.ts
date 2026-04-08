import { requestUrl } from "obsidian";
import type { LociPluginSettings } from "./settings";
import type {
  NoteContent,
  IngestResponse,
  GeneratePalaceResponse,
} from "../../shared/types";

export async function ingestNotes(
  settings: LociPluginSettings,
  notes: NoteContent[],
  depth: number
): Promise<IngestResponse> {
  const response = await requestUrl({
    url: `${settings.apiEndpoint}/ingest`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes, traversal_depth: depth }),
  });
  return response.json;
}

export async function generatePalace(
  settings: LociPluginSettings,
  graphId: string,
  themeId: string
): Promise<GeneratePalaceResponse> {
  const response = await requestUrl({
    url: `${settings.apiEndpoint}/generate-palace`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graph_id: graphId, theme_id: themeId }),
  });
  return response.json;
}
