import type { ThemeConfig } from "../../shared/types";

export const CITYSCAPE_THEME: ThemeConfig = {
  id: "cityscape",
  name: "Neon City",
  palette: {
    ground: [{ id: "concrete", color: [160, 160, 160], texture_url: null }],
    walls: [
      { id: "steel", color: [100, 100, 110], texture_url: null },
      { id: "glass", color: [180, 210, 230], texture_url: null },
    ],
    paths: [{ id: "asphalt", color: [60, 60, 65], texture_url: null }],
    accent: [
      { id: "neon_pink", color: [255, 50, 150], texture_url: null },
      { id: "neon_blue", color: [50, 150, 255], texture_url: null },
    ],
    pedestal: [{ id: "metal_platform", color: [80, 80, 90], texture_url: null }],
  },
  lighting: {
    ambient: { color: "#1a1a2e", intensity: 0.4 },
    directional: { color: "#6666aa", intensity: 0.5, direction: [0, -1, 0] },
  },
  fog: { color: "#1a1a2e", near: 30, far: 80 },
  particles: [{ type: "rain", density: 0.5, color: "#aaccff" }],
  space_shape: "geometric",
  path_style: "corridors",
  npc_style: {
    default_style: "cyber_guide",
    palette_template: { body: "#333344", head: "#aabbcc", accent: "#ff44aa" },
  },
  pedestal_style: { default_block: "metal_platform", default_width: 2, default_height: 2 },
  skybox: { type: "gradient", top_color: "#0a0a1a", bottom_color: "#1a1a3e" },
};
