import type { ThemeConfig } from "../../shared/types";

export const NATURE_THEME: ThemeConfig = {
  id: "nature",
  name: "Nature Garden",
  palette: {
    ground: [{ id: "grass", color: [86, 170, 48], texture_url: null }],
    walls: [
      { id: "oak_log", color: [110, 80, 40], texture_url: null },
      { id: "leaves", color: [55, 130, 40], texture_url: null },
    ],
    paths: [{ id: "stone_path", color: [140, 140, 130], texture_url: null }],
    accent: [
      { id: "flower_red", color: [200, 50, 50], texture_url: null },
      { id: "flower_yellow", color: [230, 200, 50], texture_url: null },
    ],
    pedestal: [{ id: "mossy_stone", color: [100, 120, 90], texture_url: null }],
  },
  lighting: {
    ambient: { color: "#fffbe6", intensity: 0.6 },
    directional: { color: "#fff5cc", intensity: 0.8, direction: [-0.5, -1, -0.3] },
  },
  fog: { color: "#c8e6c8", near: 40, far: 100 },
  particles: [{ type: "fireflies", density: 0.3, color: "#aaff66" }],
  space_shape: "organic",
  path_style: "trails",
  npc_style: {
    default_style: "forest_sage",
    palette_template: { body: "#5b8c3e", head: "#8bc34a", accent: "#ffeb3b" },
  },
  pedestal_style: { default_block: "mossy_stone", default_width: 3, default_height: 1 },
  skybox: { type: "gradient", top_color: "#87ceeb", bottom_color: "#e0f7e0" },
};
