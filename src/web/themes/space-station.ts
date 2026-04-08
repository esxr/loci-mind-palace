import type { ThemeConfig } from "../../shared/types";

export const SPACE_STATION_THEME: ThemeConfig = {
  id: "space_station",
  name: "Space Station",
  palette: {
    ground: [{ id: "hull_panel", color: [180, 185, 190], texture_url: null }],
    walls: [
      { id: "bulkhead", color: [140, 145, 155], texture_url: null },
      { id: "window", color: [20, 20, 40], texture_url: null },
    ],
    paths: [{ id: "grated_floor", color: [120, 125, 130], texture_url: null }],
    accent: [
      { id: "holo_blue", color: [100, 180, 255], texture_url: null },
      { id: "warning_orange", color: [255, 140, 0], texture_url: null },
    ],
    pedestal: [{ id: "holo_pedestal", color: [60, 80, 120], texture_url: null }],
  },
  lighting: {
    ambient: { color: "#e0e8ff", intensity: 0.5 },
    directional: { color: "#ffffff", intensity: 0.6, direction: [0, -1, 0.2] },
  },
  fog: { color: "#000010", near: 50, far: 120 },
  particles: [{ type: "stars", density: 0.4, color: "#ffffff" }],
  space_shape: "geometric",
  path_style: "corridors",
  npc_style: {
    default_style: "robot",
    palette_template: { body: "#88aacc", head: "#ccddee", accent: "#44aaff" },
  },
  pedestal_style: { default_block: "holo_pedestal", default_width: 2, default_height: 1 },
  skybox: { type: "color", top_color: "#000005", bottom_color: "#000010" },
};
