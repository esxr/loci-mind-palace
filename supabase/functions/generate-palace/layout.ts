import Graph from "npm:graphology";
import louvain from "npm:graphology-communities-louvain";
import forceAtlas2 from "npm:graphology-layout-forceatlas2";
import type {
  ConceptGraph,
  Concept,
  Space,
  Path,
  Artifact,
  NPC,
  WorldPosition,
  ThemeConfig,
  Pedestal,
} from "../_shared/types.ts";

// ---------------------------------------------------------------------------
// Theme definitions (from spec Section 3)
// ---------------------------------------------------------------------------

const THEMES: Record<string, ThemeConfig> = {
  nature: {
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
      pedestal: [
        { id: "mossy_stone", color: [100, 120, 90], texture_url: null },
      ],
    },
    lighting: {
      ambient: { color: "#fffbe6", intensity: 0.6 },
      directional: {
        color: "#fff5cc",
        intensity: 0.8,
        direction: [-0.5, -1, -0.3],
      },
    },
    fog: { color: "#c8e6c8", near: 40, far: 100 },
    particles: [{ type: "fireflies", density: 0.3, color: "#aaff66" }],
    space_shape: "organic",
    path_style: "trails",
    npc_style: {
      default_style: "forest_sage",
      palette_template: {
        body: "#5b8c3e",
        head: "#8bc34a",
        accent: "#ffeb3b",
      },
    },
    pedestal_style: {
      default_block: "mossy_stone",
      default_width: 3,
      default_height: 1,
    },
    skybox: { type: "gradient", top_color: "#87ceeb", bottom_color: "#e0f7e0" },
  },

  cityscape: {
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
      pedestal: [
        { id: "metal_platform", color: [80, 80, 90], texture_url: null },
      ],
    },
    lighting: {
      ambient: { color: "#1a1a2e", intensity: 0.4 },
      directional: {
        color: "#6666aa",
        intensity: 0.5,
        direction: [0, -1, 0],
      },
    },
    fog: { color: "#1a1a2e", near: 30, far: 80 },
    particles: [{ type: "rain", density: 0.5, color: "#aaccff" }],
    space_shape: "geometric",
    path_style: "corridors",
    npc_style: {
      default_style: "cyber_guide",
      palette_template: {
        body: "#333344",
        head: "#aabbcc",
        accent: "#ff44aa",
      },
    },
    pedestal_style: {
      default_block: "metal_platform",
      default_width: 2,
      default_height: 2,
    },
    skybox: { type: "gradient", top_color: "#0a0a1a", bottom_color: "#1a1a3e" },
  },

  space_station: {
    id: "space_station",
    name: "Space Station",
    palette: {
      ground: [
        { id: "hull_panel", color: [180, 185, 190], texture_url: null },
      ],
      walls: [
        { id: "bulkhead", color: [140, 145, 155], texture_url: null },
        { id: "window", color: [20, 20, 40], texture_url: null },
      ],
      paths: [
        { id: "grated_floor", color: [120, 125, 130], texture_url: null },
      ],
      accent: [
        { id: "holo_blue", color: [100, 180, 255], texture_url: null },
        { id: "warning_orange", color: [255, 140, 0], texture_url: null },
      ],
      pedestal: [
        { id: "holo_pedestal", color: [60, 80, 120], texture_url: null },
      ],
    },
    lighting: {
      ambient: { color: "#e0e8ff", intensity: 0.5 },
      directional: {
        color: "#ffffff",
        intensity: 0.6,
        direction: [0, -1, 0.2],
      },
    },
    fog: { color: "#000010", near: 50, far: 120 },
    particles: [{ type: "stars", density: 0.4, color: "#ffffff" }],
    space_shape: "geometric",
    path_style: "corridors",
    npc_style: {
      default_style: "robot",
      palette_template: {
        body: "#88aacc",
        head: "#ccddee",
        accent: "#44aaff",
      },
    },
    pedestal_style: {
      default_block: "holo_pedestal",
      default_width: 2,
      default_height: 1,
    },
    skybox: { type: "color", top_color: "#000005", bottom_color: "#000010" },
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LayoutResult {
  theme: ThemeConfig;
  spaces: Space[];
  paths: Path[];
  artifacts: Artifact[];
  npcs: NPC[];
  spawn_point: WorldPosition;
}

interface SpacePosition {
  conceptId: string;
  cx: number; // center X in world coords
  cz: number; // center Z in world coords
  halfW: number; // half-width
  halfD: number; // half-depth
  zoneId: number;
  concept: Concept;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple seeded PRNG (Mulberry32). */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Map display_size to space dimensions (width = depth). */
function sizeForDisplay(
  displaySize: "large" | "medium" | "small",
): { width: number; depth: number } {
  switch (displaySize) {
    case "large":
      return { width: 16, depth: 16 };
    case "medium":
      return { width: 12, depth: 12 };
    case "small":
      return { width: 8, depth: 8 };
  }
}

/** Map corridor_style to path width. */
function pathWidthForStyle(
  style: "wide" | "narrow" | "bridge",
): number {
  switch (style) {
    case "wide":
      return 4;
    case "narrow":
      return 2;
    case "bridge":
      return 3;
  }
}

/** Check if two axis-aligned bounding boxes overlap in 2D (XZ plane). */
function boxesOverlap(
  a: SpacePosition,
  b: SpacePosition,
  padding: number = 2,
): boolean {
  return (
    Math.abs(a.cx - b.cx) < a.halfW + b.halfW + padding &&
    Math.abs(a.cz - b.cz) < a.halfD + b.halfD + padding
  );
}

/** Push two overlapping boxes apart along the axis of least overlap. */
function separateBoxes(a: SpacePosition, b: SpacePosition, padding: number = 2): void {
  const overlapX = a.halfW + b.halfW + padding - Math.abs(a.cx - b.cx);
  const overlapZ = a.halfD + b.halfD + padding - Math.abs(a.cz - b.cz);

  if (overlapX <= 0 || overlapZ <= 0) return;

  if (overlapX < overlapZ) {
    const shift = overlapX / 2 + 0.5;
    if (a.cx < b.cx) {
      a.cx -= shift;
      b.cx += shift;
    } else {
      a.cx += shift;
      b.cx -= shift;
    }
  } else {
    const shift = overlapZ / 2 + 0.5;
    if (a.cz < b.cz) {
      a.cz -= shift;
      b.cz += shift;
    } else {
      a.cz += shift;
      b.cz -= shift;
    }
  }
}

// ---------------------------------------------------------------------------
// AStar pathfinding on a 2D grid (avoiding space interiors)
// ---------------------------------------------------------------------------

/**
 * Route a path between two spaces using A* on a discrete grid.
 * Falls back to a direct line if A* cannot find a route.
 */
function routePath(
  sourcePos: SpacePosition,
  targetPos: SpacePosition,
  allSpaces: SpacePosition[],
  _pathWidth: number,
): WorldPosition[] {
  // Build an occupancy set for space interiors (excluding source and target)
  const blocked = new Set<string>();
  for (const sp of allSpaces) {
    if (sp.conceptId === sourcePos.conceptId || sp.conceptId === targetPos.conceptId) {
      continue;
    }
    const minX = Math.floor(sp.cx - sp.halfW) - 1;
    const maxX = Math.ceil(sp.cx + sp.halfW) + 1;
    const minZ = Math.floor(sp.cz - sp.halfD) - 1;
    const maxZ = Math.ceil(sp.cz + sp.halfD) + 1;
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        blocked.add(`${x},${z}`);
      }
    }
  }

  // Start / end at space centers
  const startX = Math.round(sourcePos.cx);
  const startZ = Math.round(sourcePos.cz);
  const endX = Math.round(targetPos.cx);
  const endZ = Math.round(targetPos.cz);

  const waypoints = astar(startX, startZ, endX, endZ, blocked);

  if (waypoints) {
    // Simplify path: remove collinear intermediate points
    return simplifyPath(waypoints);
  }

  // Fallback: direct straight line
  return [
    { x: startX, y: 0, z: startZ },
    { x: endX, y: 0, z: endZ },
  ];
}

/**
 * A* pathfinding on a 2D integer grid.
 *
 * Returns an array of WorldPosition waypoints from (sx,sz) to (ex,ez),
 * or null if no path can be found within the iteration budget.
 */
function astar(
  sx: number,
  sz: number,
  ex: number,
  ez: number,
  blocked: Set<string>,
): WorldPosition[] | null {
  interface AStarNode {
    x: number;
    z: number;
    g: number;
    f: number;
    parent: string | null;
  }

  const open = new Map<string, AStarNode>();
  const closed = new Map<string, AStarNode>();

  const h = (x: number, z: number) => Math.abs(x - ex) + Math.abs(z - ez);

  const startKey = `${sx},${sz}`;
  const endKey = `${ex},${ez}`;

  open.set(startKey, { x: sx, z: sz, g: 0, f: h(sx, sz), parent: null });

  const MAX_ITER = 5000;
  let iter = 0;

  const dirs = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ];

  while (open.size > 0 && iter < MAX_ITER) {
    iter++;

    // Pick the node with the lowest f-score
    let bestKey = "";
    let bestF = Infinity;
    for (const [key, node] of open) {
      if (node.f < bestF) {
        bestF = node.f;
        bestKey = key;
      }
    }

    const current = open.get(bestKey)!;
    open.delete(bestKey);
    closed.set(bestKey, current);

    // Reached the goal — reconstruct path
    if (bestKey === endKey) {
      const path: WorldPosition[] = [];
      let traceKey: string | null = bestKey;
      while (traceKey) {
        const node = closed.get(traceKey)!;
        path.unshift({ x: node.x, y: 0, z: node.z });
        traceKey = node.parent;
      }
      return path;
    }

    // Expand neighbors (4-connected)
    for (const [dx, dz] of dirs) {
      const nx = current.x + dx;
      const nz = current.z + dz;
      const nKey = `${nx},${nz}`;

      if (closed.has(nKey)) continue;
      if (blocked.has(nKey)) continue;

      const ng = current.g + 1;
      const existing = open.get(nKey);
      if (existing && ng >= existing.g) continue;

      open.set(nKey, {
        x: nx,
        z: nz,
        g: ng,
        f: ng + h(nx, nz),
        parent: bestKey,
      });
    }
  }

  return null; // no path found within iteration budget
}

/** Remove collinear intermediate points from a path. */
function simplifyPath(points: WorldPosition[]): WorldPosition[] {
  if (points.length <= 2) return points;

  const result: WorldPosition[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    const next = points[i + 1];

    // Keep point if direction changes
    const dx1 = curr.x - prev.x;
    const dz1 = curr.z - prev.z;
    const dx2 = next.x - curr.x;
    const dz2 = next.z - curr.z;

    if (dx1 !== dx2 || dz1 !== dz2) {
      result.push(curr);
    }
  }
  result.push(points[points.length - 1]);
  return result;
}

// ---------------------------------------------------------------------------
// Main layout function
// ---------------------------------------------------------------------------

/**
 * Stage 2: Compute a spatial layout from an enriched concept graph.
 *
 * Steps:
 *   1. Build graphology graph
 *   2. Louvain community detection -> zone_id
 *   3. ForceAtlas2 layout -> 2D positions
 *   4. Scale to world coordinates
 *   5. Overlap removal
 *   6. Path routing via A*
 *   7. Elevation assignment per zone
 *   8. Artifact placement
 *   9. NPC placement
 *  10. Spawn point computation
 */
export function computeLayout(
  graph: ConceptGraph,
  themeId: string,
  entryPoints: string[],
  seed?: number,
): LayoutResult {
  const theme = THEMES[themeId];
  if (!theme) {
    throw new Error(`Unknown theme: ${themeId}`);
  }

  const rng = mulberry32(seed ?? Date.now());
  const actualSeed = seed ?? Math.floor(rng() * 2147483647);

  // Concept lookup
  const conceptMap = new Map<string, Concept>();
  for (const c of graph.concepts) {
    conceptMap.set(c.id, c);
  }

  // ---- Step 1: Build graphology graph ----
  const g = new Graph({ type: "undirected" });

  for (const concept of graph.concepts) {
    g.addNode(concept.id, {
      label: concept.name,
      importance: concept.importance,
    });
  }

  for (const rel of graph.relationships) {
    // Skip edges referencing missing nodes
    if (!g.hasNode(rel.source_id) || !g.hasNode(rel.target_id)) continue;
    // Skip self-loops
    if (rel.source_id === rel.target_id) continue;
    // Skip duplicate edges
    if (g.hasEdge(rel.source_id, rel.target_id)) continue;

    g.addEdge(rel.source_id, rel.target_id, {
      weight: rel.strength,
      corridor_style: rel.corridor_style,
    });
  }

  // ---- Step 2: Louvain community detection ----
  let communities: Record<string, number>;
  try {
    communities = louvain(g, { resolution: 1.0 });
  } catch {
    // Fallback: assign all to zone 0
    communities = {};
    for (const concept of graph.concepts) {
      communities[concept.id] = 0;
    }
  }

  // ---- Step 3: ForceAtlas2 layout ----
  // Assign random initial positions (seeded)
  g.forEachNode((node) => {
    g.setNodeAttribute(node, "x", (rng() - 0.5) * 100);
    g.setNodeAttribute(node, "y", (rng() - 0.5) * 100);
  });

  forceAtlas2.assign(g, {
    iterations: 500,
    settings: {
      gravity: 1.0,
      scalingRatio: 2.0,
      barnesHutOptimize: graph.concepts.length > 20,
      strongGravityMode: false,
      slowDown: 1,
      outboundAttractionDistribution: false,
      adjustSizes: false,
      edgeWeightInfluence: 1,
      linLogMode: false,
    },
  });

  // ---- Step 4: Scale to world coordinates ----
  const SPACING_FACTOR = 30;

  const spacePositions: SpacePosition[] = [];
  for (const concept of graph.concepts) {
    const fa2x = g.getNodeAttribute(concept.id, "x") as number;
    const fa2y = g.getNodeAttribute(concept.id, "y") as number;

    const { width, depth } = sizeForDisplay(concept.display_size);

    spacePositions.push({
      conceptId: concept.id,
      cx: Math.round(fa2x * SPACING_FACTOR),
      cz: Math.round(fa2y * SPACING_FACTOR),
      halfW: width / 2,
      halfD: depth / 2,
      zoneId: communities[concept.id] ?? 0,
      concept,
    });
  }

  // ---- Step 5: Overlap removal ----
  // Iterative: push apart overlapping pairs until stable or max iterations
  const MAX_OVERLAP_PASSES = 50;
  for (let pass = 0; pass < MAX_OVERLAP_PASSES; pass++) {
    let anyOverlap = false;
    for (let i = 0; i < spacePositions.length; i++) {
      for (let j = i + 1; j < spacePositions.length; j++) {
        if (boxesOverlap(spacePositions[i], spacePositions[j])) {
          separateBoxes(spacePositions[i], spacePositions[j]);
          anyOverlap = true;
        }
      }
    }
    if (!anyOverlap) break;
  }

  // Snap to integer coordinates
  for (const sp of spacePositions) {
    sp.cx = Math.round(sp.cx);
    sp.cz = Math.round(sp.cz);
  }

  // ---- Step 7: Assign elevations per zone ----
  const zoneElevations = new Map<number, number>();
  const uniqueZones = [...new Set(spacePositions.map((sp) => sp.zoneId))].sort();
  for (let i = 0; i < uniqueZones.length; i++) {
    // Alternate zones between y=0 and y=4 for slight variation
    zoneElevations.set(uniqueZones[i], i % 2 === 0 ? 0 : 4);
  }

  // Build space position lookup for path routing
  const spaceMap = new Map<string, SpacePosition>();
  for (const sp of spacePositions) {
    spaceMap.set(sp.conceptId, sp);
  }

  // ---- Build Spaces ----
  const SPACE_HEIGHT = 6;
  const spaces: Space[] = spacePositions.map((sp) => {
    const { width, depth } = sizeForDisplay(sp.concept.display_size);
    const floorY = zoneElevations.get(sp.zoneId) ?? 0;

    return {
      id: sp.conceptId,
      concept_id: sp.conceptId,
      position: {
        x: sp.cx - sp.halfW,
        y: floorY,
        z: sp.cz - sp.halfD,
      },
      size: {
        width,
        height: SPACE_HEIGHT,
        depth,
      },
      shape: theme.space_shape === "mixed"
        ? (sp.concept.display_size === "large" ? "circular" : "rectangular")
        : theme.space_shape === "organic"
          ? "organic"
          : "rectangular",
      zone_id: sp.zoneId,
      floor_block: theme.palette.ground[0].id,
      wall_block: theme.palette.walls[0].id,
      ceiling_block: themeId === "space_station"
        ? theme.palette.walls[0].id
        : null,
      has_ceiling: themeId === "space_station",
    };
  });

  // ---- Step 6: Path routing ----
  const paths: Path[] = [];
  const processedPairs = new Set<string>();

  for (const rel of graph.relationships) {
    const sourceSpace = spaceMap.get(rel.source_id);
    const targetSpace = spaceMap.get(rel.target_id);
    if (!sourceSpace || !targetSpace) continue;

    // Avoid duplicate paths (since graph is undirected for layout purposes)
    const pairKey = [rel.source_id, rel.target_id].sort().join("__");
    if (processedPairs.has(pairKey)) continue;
    processedPairs.add(pairKey);

    const width = pathWidthForStyle(rel.corridor_style);
    const waypoints = routePath(
      sourceSpace,
      targetSpace,
      spacePositions,
      width,
    );

    // Assign elevation to waypoints based on source/target zones
    const sourceY = zoneElevations.get(sourceSpace.zoneId) ?? 0;
    const targetY = zoneElevations.get(targetSpace.zoneId) ?? 0;
    const totalWaypoints = waypoints.length;

    for (let i = 0; i < totalWaypoints; i++) {
      // Linearly interpolate elevation along the path
      const t = totalWaypoints > 1 ? i / (totalWaypoints - 1) : 0;
      waypoints[i].y = Math.round(sourceY + (targetY - sourceY) * t);
    }

    // Determine path style based on corridor_style and theme
    let pathStyle: "corridor" | "trail" | "bridge" | "tunnel";
    if (rel.corridor_style === "bridge") {
      pathStyle = "bridge";
    } else if (theme.path_style === "trails") {
      pathStyle = "trail";
    } else if (theme.path_style === "tunnels") {
      pathStyle = "tunnel";
    } else {
      pathStyle = "corridor";
    }

    paths.push({
      id: `${rel.source_id}_to_${rel.target_id}`,
      source_space_id: rel.source_id,
      target_space_id: rel.target_id,
      waypoints,
      width,
      floor_block: theme.palette.paths[0].id,
      wall_block: pathStyle === "corridor" || pathStyle === "tunnel"
        ? theme.palette.walls[0].id
        : null,
      style: pathStyle,
    });
  }

  // ---- Step 8: Place artifacts (center of each space, on pedestal) ----
  const artifacts: Artifact[] = spacePositions.map((sp) => {
    const floorY = zoneElevations.get(sp.zoneId) ?? 0;
    const pedestalHeight = theme.pedestal_style.default_height;

    return {
      id: `${sp.conceptId}_artifact`,
      concept_id: sp.conceptId,
      position: {
        x: sp.cx,
        y: floorY + pedestalHeight + 1, // on top of pedestal
        z: sp.cz,
      },
      glb_url: "/placeholder.glb", // will be replaced by tripo.ts results
      scale: sp.concept.display_size === "large"
        ? 1.5
        : sp.concept.display_size === "medium"
          ? 1.0
          : 0.7,
      rotation_y: rng() * Math.PI * 2,
      pedestal: {
        block: theme.pedestal_style.default_block,
        width: theme.pedestal_style.default_width,
        height: pedestalHeight,
      } as Pedestal,
    };
  });

  // ---- Step 9: Place NPCs (offset 2 blocks from artifact within space) ----
  const npcs: NPC[] = spacePositions.map((sp) => {
    const floorY = zoneElevations.get(sp.zoneId) ?? 0;

    // Place NPC 2 blocks to the right (+x) of the center
    // Ensure it stays within the space bounds
    const npcX = sp.cx + Math.min(2, sp.halfW - 1);
    const npcZ = sp.cz;

    // Find neighbor concepts (1-hop)
    const neighborIds: string[] = [];
    for (const rel of graph.relationships) {
      if (rel.source_id === sp.conceptId && conceptMap.has(rel.target_id)) {
        neighborIds.push(rel.target_id);
      } else if (
        rel.target_id === sp.conceptId &&
        conceptMap.has(rel.source_id)
      ) {
        neighborIds.push(rel.source_id);
      }
    }

    // NPC faces toward center of space (toward the artifact)
    const facingAngle = Math.atan2(sp.cz - npcZ, sp.cx - npcX);

    return {
      id: `${sp.conceptId}_npc`,
      concept_id: sp.conceptId,
      name: sp.concept.name,
      position: {
        x: npcX,
        y: floorY,
        z: npcZ,
      },
      facing: facingAngle,
      voxel_model: {
        style: theme.npc_style.default_style,
        palette: { ...theme.npc_style.palette_template },
        height_blocks: 3,
      },
      dialogue_context: {
        concept_description: sp.concept.description,
        neighbor_ids: neighborIds,
      },
    };
  });

  // ---- Step 10: Compute spawn point ----
  // Use the first entry point concept
  const spawnConceptId = entryPoints[0] ?? graph.concepts[0]?.id;
  const spawnSpace = spaceMap.get(spawnConceptId);

  let spawnPoint: WorldPosition;
  if (spawnSpace) {
    const floorY = zoneElevations.get(spawnSpace.zoneId) ?? 0;
    spawnPoint = {
      x: spawnSpace.cx,
      y: floorY + 2, // player height above floor
      z: spawnSpace.cz - spawnSpace.halfD + 2, // near the entrance
    };
  } else {
    spawnPoint = { x: 0, y: 2, z: 0 };
  }

  return {
    theme,
    spaces,
    paths,
    artifacts,
    npcs,
    spawn_point: spawnPoint,
  };
}

/** Returns the theme config for a given theme ID, or null if invalid. */
export function getTheme(themeId: string): ThemeConfig | null {
  return THEMES[themeId] ?? null;
}

/** Check if a theme ID is valid. */
export function isValidTheme(themeId: string): boolean {
  return themeId in THEMES;
}
