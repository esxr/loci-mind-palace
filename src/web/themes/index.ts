import { NATURE_THEME } from "./nature";
import { CITYSCAPE_THEME } from "./cityscape";
import { SPACE_STATION_THEME } from "./space-station";
import type { ThemeConfig } from "../../shared/types";

const THEMES: Record<string, ThemeConfig> = {
  nature: NATURE_THEME,
  cityscape: CITYSCAPE_THEME,
  space_station: SPACE_STATION_THEME,
};

/**
 * Retrieves a theme by its string ID. Throws if the theme is not found.
 */
export function getThemeById(id: string): ThemeConfig {
  const theme = THEMES[id];
  if (!theme) throw new Error(`Unknown theme: ${id}`);
  return theme;
}

export { NATURE_THEME, CITYSCAPE_THEME, SPACE_STATION_THEME };
