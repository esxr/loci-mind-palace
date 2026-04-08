# Obsidian Plugin Development Guide

Comprehensive research on building an Obsidian plugin that reads vault notes, traverses the note graph, extracts concepts/relationships, communicates with an external web app, and provides a settings UI.

---

## 1. Plugin Architecture & Lifecycle

### Core Concept

An Obsidian plugin is a TypeScript/JavaScript module that extends the `Plugin` class. Obsidian loads the compiled `main.js` file along with a `manifest.json` descriptor. The plugin has two lifecycle hooks:

- **`onload()`** -- Called when the plugin is enabled. Register all commands, views, settings tabs, event listeners, and ribbon icons here.
- **`onunload()`** -- Called when the plugin is disabled. Clean up any resources not managed by Obsidian's helper methods (`registerEvent`, `registerInterval`, `registerDomEvent` auto-clean).

### Key App Objects

| Object | Access | Purpose |
|--------|--------|---------|
| `this.app.vault` | File I/O | Read/write/list files in the vault |
| `this.app.metadataCache` | Metadata | Parsed frontmatter, links, tags, headings (cached) |
| `this.app.workspace` | UI | Manage leaves, views, panels, active editor |
| `this.app.fileManager` | File ops | Higher-level file operations (rename, move with link updates) |

---

## 2. Project Structure & Tech Stack

### File Layout (Official Template)

```
my-obsidian-plugin/
├── src/
│   ├── main.ts              # Plugin entry point (extends Plugin)
│   └── settings.ts          # Settings interface + PluginSettingTab
├── manifest.json            # Plugin metadata (id, name, version, minAppVersion)
├── package.json             # Dependencies and scripts
├── tsconfig.json            # TypeScript configuration
├── esbuild.config.mjs       # Build configuration
├── eslint.config.mts        # Linting rules
├── styles.css               # Plugin CSS
└── versions.json            # Version-to-minAppVersion mapping
```

### manifest.json

```json
{
  "id": "my-plugin-id",
  "name": "My Plugin",
  "version": "1.0.0",
  "minAppVersion": "0.15.0",
  "description": "What the plugin does.",
  "author": "Your Name",
  "authorUrl": "https://yoursite.com",
  "isDesktopOnly": false
}
```

- `id` must be unique across all community plugins and match the directory name.
- `isDesktopOnly: true` if you use Node.js or Electron APIs.

### package.json (Key Parts)

```json
{
  "type": "module",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production",
    "lint": "eslint ."
  },
  "dependencies": {
    "obsidian": "latest"
  },
  "devDependencies": {
    "esbuild": "0.25.5",
    "typescript": "^5.8.3",
    "@types/node": "^16.11.6",
    "tslib": "2.4.0"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "baseUrl": "src",
    "inlineSourceMap": true,
    "inlineSources": true,
    "module": "ESNext",
    "target": "ES6",
    "allowJs": true,
    "noImplicitAny": true,
    "noImplicitThis": true,
    "noImplicitReturns": true,
    "moduleResolution": "node",
    "importHelpers": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "strictNullChecks": true,
    "strictBindCallApply": true,
    "allowSyntheticDefaultImports": true,
    "useUnknownInCatchVariables": true,
    "lib": ["DOM", "ES5", "ES6", "ES7"]
  },
  "include": ["src/**/*.ts"]
}
```

### esbuild.config.mjs

```javascript
import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "node:module";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
```

Key: `obsidian`, `electron`, and all CodeMirror packages are marked `external` because Obsidian provides them at runtime.

### Build & Dev Commands

```bash
npm install          # Install dependencies
npm run dev          # Watch mode (auto-recompile on save)
npm run build        # Production build (type-check + minify)
npm run lint         # ESLint analysis
```

### Hot Reload During Development

1. Install the [Hot Reload plugin](https://github.com/pjeby/hot-reload) in your dev vault.
2. Create a `.hotreload` file in your plugin directory, OR ensure it has a `.git` subdirectory.
3. Run `npm run dev` -- esbuild watches for changes and rewrites `main.js`.
4. Hot Reload detects the file change and automatically disables/re-enables your plugin (~750ms debounce).

Symlink approach for convenience:
```bash
ln -s /path/to/your/plugin/repo /path/to/vault/.obsidian/plugins/my-plugin-id
```

---

## 3. Accessing Vault Files & Content

### Listing Files

```typescript
// All markdown files in the vault
const allFiles: TFile[] = this.app.vault.getMarkdownFiles();

// Get a specific file by path
const file = this.app.vault.getAbstractFileByPath("folder/note.md");
if (file instanceof TFile) {
  // It's a file
}

// Get all files (including non-markdown)
const everything: TAbstractFile[] = this.app.vault.getAllLoadedFiles();
```

### Reading File Content

```typescript
// For display only (uses cache, faster, no disk re-read)
const content: string = await this.app.vault.cachedRead(file);

// For read-modify-write (always reads from disk)
const content: string = await this.app.vault.read(file);
```

**Rule of thumb**: Use `cachedRead()` when you only need to display or analyze content. Use `read()` when you plan to modify and write back.

### Writing Files

```typescript
// Overwrite entire file
await this.app.vault.modify(file, newContent);

// Create new file
const newFile = await this.app.vault.create("path/to/new-note.md", content);

// Append to file
await this.app.vault.append(file, "\n\nAppended text");
```

### Vault Events

```typescript
// React to file changes
this.registerEvent(this.app.vault.on("modify", (file) => {
  if (file instanceof TFile) {
    console.log(`Modified: ${file.path}`);
  }
}));

this.registerEvent(this.app.vault.on("create", (file) => { /* ... */ }));
this.registerEvent(this.app.vault.on("delete", (file) => { /* ... */ }));
this.registerEvent(this.app.vault.on("rename", (file, oldPath) => { /* ... */ }));
```

---

## 4. MetadataCache -- Traversing the Note Graph

The MetadataCache is the primary mechanism for reading parsed metadata without re-parsing markdown files.

### CachedMetadata Interface

When you call `getFileCache(file)`, you get a `CachedMetadata` object with these properties:

| Property | Type | Description |
|----------|------|-------------|
| `links` | `LinkCache[]` | Internal `[[wikilinks]]` with position data |
| `embeds` | `EmbedCache[]` | Embedded content `![[...]]` references |
| `headings` | `HeadingCache[]` | Headings with level (1-6) |
| `tags` | `TagCache[]` | Inline `#tags` with positions |
| `frontmatter` | `FrontMatterCache` | Parsed YAML frontmatter object |
| `frontmatterLinks` | `FrontmatterLinkCache[]` | Links found in frontmatter |
| `sections` | `SectionCache[]` | Document structural sections |
| `listItems` | `ListItemCache[]` | Parsed list items |
| `blocks` | `Record<string, BlockCache>` | Block references `^block-id` |

### Reading Links from a Note

```typescript
const cache = this.app.metadataCache.getFileCache(file);

if (cache?.links) {
  for (const link of cache.links) {
    console.log("Link target:", link.link);           // e.g. "Other Note"
    console.log("Display text:", link.displayText);    // e.g. "my alias"
    console.log("Original:", link.original);           // e.g. "[[Other Note|my alias]]"
  }
}

if (cache?.embeds) {
  for (const embed of cache.embeds) {
    console.log("Embedded:", embed.link);  // e.g. "image.png" or "Other Note"
  }
}
```

### Resolving Links to Actual Files

```typescript
// Resolve a link string to a TFile
const linkedFile: TFile | null = this.app.metadataCache.getFirstLinkpathDest(
  "Other Note",     // link text
  file.path         // source file path (for relative resolution)
);

// Parse a complex link like "Note#Heading|Display"
import { parseLinktext, getLinkpath } from "obsidian";
const { path, subpath } = parseLinktext("Note#Heading|Display");
// path = "Note#Heading", subpath = ...
const linkPath = getLinkpath("Note#Heading|Display");
// linkPath = "Note"
```

### The resolvedLinks Map -- Full Graph Access

```typescript
// resolvedLinks: Record<string, Record<string, number>>
// Maps: sourcePath -> { destPath: occurrenceCount }
const resolved = this.app.metadataCache.resolvedLinks;

// Get all outgoing links from a specific file
const outgoing = resolved[file.path];
// outgoing = { "folder/note-b.md": 2, "note-c.md": 1 }

// Find all incoming links (backlinks) to a file
function getBacklinks(targetPath: string): string[] {
  const backlinks: string[] = [];
  const resolved = this.app.metadataCache.resolvedLinks;
  for (const [sourcePath, links] of Object.entries(resolved)) {
    if (targetPath in links) {
      backlinks.push(sourcePath);
    }
  }
  return backlinks;
}

// Unresolved (broken) links
const unresolved = this.app.metadataCache.unresolvedLinks;
// Same structure but for links that don't resolve to files
```

### Spider / Crawl Through Linked Notes (BFS)

```typescript
async function spiderFromNote(
  app: App,
  startFile: TFile,
  maxDepth: number = 3
): Promise<Map<string, { file: TFile; depth: number; content: string }>> {
  const visited = new Map<string, { file: TFile; depth: number; content: string }>();
  const queue: Array<{ file: TFile; depth: number }> = [{ file: startFile, depth: 0 }];

  while (queue.length > 0) {
    const { file, depth } = queue.shift()!;

    if (visited.has(file.path) || depth > maxDepth) continue;

    const content = await app.vault.cachedRead(file);
    visited.set(file.path, { file, depth, content });

    // Get outgoing links
    const cache = app.metadataCache.getFileCache(file);
    if (cache?.links) {
      for (const link of cache.links) {
        const linkedFile = app.metadataCache.getFirstLinkpathDest(link.link, file.path);
        if (linkedFile && !visited.has(linkedFile.path)) {
          queue.push({ file: linkedFile, depth: depth + 1 });
        }
      }
    }

    // Also follow embeds
    if (cache?.embeds) {
      for (const embed of cache.embeds) {
        const embeddedFile = app.metadataCache.getFirstLinkpathDest(embed.link, file.path);
        if (embeddedFile && embeddedFile.extension === "md" && !visited.has(embeddedFile.path)) {
          queue.push({ file: embeddedFile, depth: depth + 1 });
        }
      }
    }
  }

  return visited;
}
```

### Reading Frontmatter / Tags / Headings

```typescript
const cache = this.app.metadataCache.getFileCache(file);

// Frontmatter (YAML)
if (cache?.frontmatter) {
  const title = cache.frontmatter["title"];
  const tags = cache.frontmatter["tags"];       // array of strings
  const customField = cache.frontmatter["my-field"];
}

// Inline tags
if (cache?.tags) {
  for (const tag of cache.tags) {
    console.log(tag.tag);  // e.g. "#concept" (includes the #)
  }
}

// Combined tags (frontmatter + inline) using utility
import { getAllTags } from "obsidian";
const allTags: string[] | null = getAllTags(cache);

// Headings
if (cache?.headings) {
  for (const heading of cache.headings) {
    console.log(`H${heading.level}: ${heading.heading}`);
  }
}
```

### MetadataCache Events

```typescript
// Fires when a specific file's metadata changes
this.registerEvent(
  this.app.metadataCache.on("changed", (file: TFile, data: string, cache: CachedMetadata) => {
    // file = the changed file
    // data = raw file content
    // cache = new parsed metadata
  })
);

// Fires once when ALL vault links have been resolved (good for initial graph build)
this.registerEvent(
  this.app.metadataCache.on("resolved", () => {
    console.log("All vault metadata resolved -- safe to build full graph");
  })
);

// Fires when a file is deleted (provides previous cache for cleanup)
this.registerEvent(
  this.app.metadataCache.on("deleted", (file: TFile, prevCache: CachedMetadata | null) => {
    // Clean up references to this file
  })
);
```

---

## 5. Extracting Wikilinks with Regex (Supplementary)

While `metadataCache` is preferred, you can also regex-extract links from raw content:

```typescript
// Match [[target]] and [[target|display]]
const WIKILINK_REGEX = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

function extractWikilinks(content: string): Array<{ target: string; display?: string }> {
  const links: Array<{ target: string; display?: string }> = [];
  let match;
  while ((match = WIKILINK_REGEX.exec(content)) !== null) {
    links.push({
      target: match[1].trim(),
      display: match[2]?.trim(),
    });
  }
  return links;
}

// Match #tags (but not in code blocks or frontmatter)
const TAG_REGEX = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_/-]*)/g;
```

---

## 6. UI Components

### Ribbon Icons

```typescript
// Add an icon to the left sidebar ribbon
this.addRibbonIcon("brain-circuit", "Sync to Knowledge Graph", async () => {
  await this.syncToExternalApp();
});
```

Icons use [Lucide icon names](https://lucide.dev/). Obsidian bundles Lucide icons.

### Commands

```typescript
// Simple command (always available)
this.addCommand({
  id: "sync-vault",
  name: "Sync vault to external app",
  callback: async () => {
    await this.syncToExternalApp();
  },
});

// Editor command (only when editor is active)
this.addCommand({
  id: "sync-current-note",
  name: "Sync current note",
  editorCallback: async (editor: Editor, view: MarkdownView) => {
    const file = view.file;
    if (file) await this.syncNote(file);
  },
});

// Conditional command (show only when condition is met)
this.addCommand({
  id: "open-graph-view",
  name: "Open 3D graph view",
  checkCallback: (checking: boolean) => {
    if (this.settings.apiUrl) {
      if (!checking) {
        this.activateView();
      }
      return true;
    }
    return false;
  },
});
```

### Custom Views (Side Panels)

```typescript
// --- view.ts ---
import { ItemView, WorkspaceLeaf } from "obsidian";

export const VIEW_TYPE_KNOWLEDGE_GRAPH = "knowledge-graph-view";

export class KnowledgeGraphView extends ItemView {
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_KNOWLEDGE_GRAPH;
  }

  getDisplayText(): string {
    return "Knowledge Graph";
  }

  getIcon(): string {
    return "brain-circuit";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();

    // Option A: Build UI with DOM APIs
    container.createEl("h4", { text: "Knowledge Graph" });
    const syncBtn = container.createEl("button", { text: "Sync Now" });
    syncBtn.addEventListener("click", () => this.syncGraph());

    // Option B: Embed an iframe for a 3D visualization
    const iframe = container.createEl("iframe");
    iframe.src = "https://your-external-app.com/3d-view";
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "none";
  }

  async onClose(): Promise<void> {
    // Clean up resources
  }

  private async syncGraph(): Promise<void> {
    // Implementation
  }
}

// --- main.ts ---
import { KnowledgeGraphView, VIEW_TYPE_KNOWLEDGE_GRAPH } from "./view";

export default class MyPlugin extends Plugin {
  async onload() {
    this.registerView(
      VIEW_TYPE_KNOWLEDGE_GRAPH,
      (leaf) => new KnowledgeGraphView(leaf)
    );

    this.addCommand({
      id: "open-knowledge-graph",
      name: "Open Knowledge Graph",
      callback: () => this.activateView(),
    });

    this.addRibbonIcon("brain-circuit", "Knowledge Graph", () => {
      this.activateView();
    });
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_KNOWLEDGE_GRAPH);
  }

  async activateView() {
    const { workspace } = this.app;
    workspace.detachLeavesOfType(VIEW_TYPE_KNOWLEDGE_GRAPH);

    const leaf = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({
        type: VIEW_TYPE_KNOWLEDGE_GRAPH,
        active: true,
      });
      workspace.revealLeaf(
        workspace.getLeavesOfType(VIEW_TYPE_KNOWLEDGE_GRAPH)[0]
      );
    }
  }
}
```

### Modals

```typescript
import { App, Modal, Setting } from "obsidian";

class ConfirmSyncModal extends Modal {
  result: boolean = false;
  onSubmit: (result: boolean) => void;

  constructor(app: App, onSubmit: (result: boolean) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Confirm Sync" });
    contentEl.createEl("p", { text: "Send vault data to the external app?" });

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("Sync").setCta().onClick(() => {
          this.result = true;
          this.close();
        })
      )
      .addButton((btn) =>
        btn.setButtonText("Cancel").onClick(() => {
          this.close();
        })
      );
  }

  onClose() {
    this.onSubmit(this.result);
    this.contentEl.empty();
  }
}
```

### Status Bar

```typescript
const statusBar = this.addStatusBarItem();
statusBar.setText("KG: Ready");
// Update later:
statusBar.setText("KG: Syncing...");
```

---

## 7. Settings UI

### Settings Interface & Defaults

```typescript
// --- settings.ts ---
import { App, PluginSettingTab, Setting } from "obsidian";
import MyPlugin from "./main";

export interface PluginSettings {
  apiUrl: string;
  apiKey: string;
  syncOnStartup: boolean;
  maxDepth: number;
  excludeFolders: string;
  includeTagsInSync: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  apiUrl: "http://localhost:3000/api",
  apiKey: "",
  syncOnStartup: false,
  maxDepth: 3,
  excludeFolders: "",
  includeTagsInSync: true,
};
```

### Settings Tab

```typescript
export class PluginSettingsTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Knowledge Graph Settings" });

    // Text input: API URL
    new Setting(containerEl)
      .setName("API URL")
      .setDesc("The URL of the external web application API endpoint.")
      .addText((text) =>
        text
          .setPlaceholder("http://localhost:3000/api")
          .setValue(this.plugin.settings.apiUrl)
          .onChange(async (value) => {
            this.plugin.settings.apiUrl = value;
            await this.plugin.saveSettings();
          })
      );

    // Password/secret input: API Key
    new Setting(containerEl)
      .setName("API Key")
      .setDesc("Authentication key for the external app.")
      .addText((text) => {
        text
          .setPlaceholder("Enter API key")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";  // Mask the input
      });

    // Toggle
    new Setting(containerEl)
      .setName("Sync on startup")
      .setDesc("Automatically sync vault data when Obsidian starts.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncOnStartup)
          .onChange(async (value) => {
            this.plugin.settings.syncOnStartup = value;
            await this.plugin.saveSettings();
          })
      );

    // Slider
    new Setting(containerEl)
      .setName("Link traversal depth")
      .setDesc("How many levels of linked notes to follow (1-10).")
      .addSlider((slider) =>
        slider
          .setLimits(1, 10, 1)
          .setValue(this.plugin.settings.maxDepth)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.maxDepth = value;
            await this.plugin.saveSettings();
          })
      );

    // Text area for comma-separated folders
    new Setting(containerEl)
      .setName("Exclude folders")
      .setDesc("Comma-separated list of folders to exclude from sync.")
      .addTextArea((text) =>
        text
          .setPlaceholder("templates, archive, daily-notes")
          .setValue(this.plugin.settings.excludeFolders)
          .onChange(async (value) => {
            this.plugin.settings.excludeFolders = value;
            await this.plugin.saveSettings();
          })
      );

    // Toggle
    new Setting(containerEl)
      .setName("Include tags")
      .setDesc("Send tag information along with note content.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeTagsInSync)
          .onChange(async (value) => {
            this.plugin.settings.includeTagsInSync = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
```

### Loading & Saving Settings in main.ts

```typescript
export default class MyPlugin extends Plugin {
  settings: PluginSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new PluginSettingsTab(this.app, this));
    // ... rest of onload
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
```

Settings are stored as JSON in `.obsidian/plugins/<plugin-id>/data.json`.

---

## 8. Communication with External Web App

### Making HTTP Requests (requestUrl)

Obsidian provides `requestUrl` which bypasses CORS restrictions -- this is the recommended approach over `fetch`:

```typescript
import { requestUrl, RequestUrlParam, RequestUrlResponse } from "obsidian";

// POST data to external app
async function sendToExternalApp(
  apiUrl: string,
  apiKey: string,
  data: any
): Promise<RequestUrlResponse> {
  const response = await requestUrl({
    url: `${apiUrl}/ingest`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(data),
  });

  return response;
}

// GET data from external app
async function fetchFromExternalApp(
  apiUrl: string,
  apiKey: string,
  endpoint: string
): Promise<any> {
  const response = await requestUrl({
    url: `${apiUrl}/${endpoint}`,
    method: "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
    },
  });

  return response.json;
}
```

### Why requestUrl over fetch

- `fetch()` in Obsidian (an Electron app) is subject to CORS restrictions because it uses Chromium's networking stack.
- `requestUrl()` uses Node.js networking under the hood, bypassing CORS entirely.
- Works on both desktop and mobile.

### Opening an External URL in the Browser

```typescript
// Opens URL in the user's default browser
window.open("https://your-app.com/dashboard");
```

### Embedding an iframe (3D View)

You can embed external web apps inside an Obsidian view using iframes:

```typescript
async onOpen() {
  const container = this.containerEl.children[1];
  container.empty();
  container.addClass("knowledge-graph-container");

  const iframe = document.createElement("iframe");
  iframe.src = `${this.plugin.settings.apiUrl}/3d-view`;
  iframe.setAttribute("style", "width:100%; height:100%; border:none;");
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
  container.appendChild(iframe);

  // Communicate with iframe via postMessage
  window.addEventListener("message", (event) => {
    if (event.origin === new URL(this.plugin.settings.apiUrl).origin) {
      // Handle messages from the 3D view
      if (event.data.type === "node-clicked") {
        // Open the corresponding note
        const file = this.app.vault.getAbstractFileByPath(event.data.path);
        if (file instanceof TFile) {
          this.app.workspace.getLeaf().openFile(file);
        }
      }
    }
  });

  // Send data to iframe
  iframe.addEventListener("load", () => {
    iframe.contentWindow?.postMessage(
      { type: "graph-data", nodes: [...], edges: [...] },
      this.plugin.settings.apiUrl
    );
  });
}
```

**iframe limitations**: Some external sites block being embedded. For your own web app, ensure the server sets `X-Frame-Options: SAMEORIGIN` or uses appropriate CSP headers allowing Obsidian's origin.

The [Custom Frames plugin](https://github.com/Ellpeck/ObsidianCustomFrames) is a good reference for advanced iframe embedding patterns including custom CSS injection.

---

## 9. Building the Full Sync Pipeline

Here is a pattern for extracting concepts/relationships and sending them to an external app:

```typescript
interface NoteData {
  path: string;
  title: string;
  content: string;
  frontmatter: Record<string, any>;
  tags: string[];
  headings: Array<{ level: number; text: string }>;
  outgoingLinks: string[];    // paths of linked notes
  incomingLinks: string[];    // paths of notes linking to this one
}

interface GraphPayload {
  nodes: NoteData[];
  edges: Array<{ source: string; target: string; type: string }>;
}

async function buildGraphPayload(app: App, settings: PluginSettings): Promise<GraphPayload> {
  const files = app.vault.getMarkdownFiles();
  const excludedFolders = settings.excludeFolders
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);

  const nodes: NoteData[] = [];
  const edges: Array<{ source: string; target: string; type: string }> = [];

  for (const file of files) {
    // Skip excluded folders
    if (excludedFolders.some((folder) => file.path.startsWith(folder + "/"))) {
      continue;
    }

    const content = await app.vault.cachedRead(file);
    const cache = app.metadataCache.getFileCache(file);

    // Build node
    const node: NoteData = {
      path: file.path,
      title: cache?.frontmatter?.["title"] || file.basename,
      content: content,
      frontmatter: cache?.frontmatter ? { ...cache.frontmatter } : {},
      tags: getAllTags(cache) || [],
      headings: (cache?.headings || []).map((h) => ({
        level: h.level,
        text: h.heading,
      })),
      outgoingLinks: [],
      incomingLinks: [],
    };

    // Build edges from links
    if (cache?.links) {
      for (const link of cache.links) {
        const dest = app.metadataCache.getFirstLinkpathDest(link.link, file.path);
        if (dest) {
          node.outgoingLinks.push(dest.path);
          edges.push({
            source: file.path,
            target: dest.path,
            type: "link",
          });
        }
      }
    }

    // Build edges from embeds
    if (cache?.embeds) {
      for (const embed of cache.embeds) {
        const dest = app.metadataCache.getFirstLinkpathDest(embed.link, file.path);
        if (dest) {
          edges.push({
            source: file.path,
            target: dest.path,
            type: "embed",
          });
        }
      }
    }

    nodes.push(node);
  }

  // Compute incoming links
  for (const edge of edges) {
    const targetNode = nodes.find((n) => n.path === edge.target);
    if (targetNode) {
      targetNode.incomingLinks.push(edge.source);
    }
  }

  return { nodes, edges };
}
```

---

## 10. Similar Plugins for Reference

### 3D Graph Visualization

| Plugin | Description | Tech |
|--------|-------------|------|
| [3D Graph](https://github.com/AlexW00/obsidian-3d-graph) | 3D force-directed graph of vault notes | TypeScript + D3.js |
| [New 3D Graph](https://www.obsidianstats.com/plugins/new-3d-graph) | Highly customizable 3D graph with filtering, physics tuning | TypeScript + D3.js |

Both use D3.js (specifically d3-force-3d) rather than Three.js for the 3D rendering. They read the vault graph via `metadataCache.resolvedLinks`.

### Graph Export

| Plugin | Description |
|--------|-------------|
| [Export Graph View](https://www.obsidianstats.com/plugins/export-graph-view) | Export vault graph as `.mmd` (Mermaid) or `.dot` (GraphViz) |

### External App Integration

| Plugin | Description |
|--------|-------------|
| [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) | Exposes vault as a REST API for external tools |
| [Custom Frames](https://github.com/Ellpeck/ObsidianCustomFrames) | Embed any web app in Obsidian panes via iframes |
| [API Request](https://github.com/Rooyca/obsidian-api-request) | Make HTTP requests from within notes |

### Key Architectural Lessons from These Plugins

1. **3D Graph** uses `app.metadataCache.resolvedLinks` to build the entire node/edge graph in one pass rather than individually parsing each file.
2. **Custom Frames** demonstrates robust iframe embedding with custom CSS injection, sandboxing, and handling frame communication.
3. **Local REST API** shows how to run a local HTTP server from within an Obsidian plugin (useful if you want bi-directional communication).

---

## 11. Publishing to Community Plugins

### Checklist

1. Create a GitHub repository for your plugin.
2. Ensure `manifest.json`, `main.js`, and `styles.css` are in the root or released as GitHub release assets.
3. Tag a release (e.g., `1.0.0` -- no `v` prefix).
4. Attach `manifest.json`, `main.js`, and `styles.css` as binary assets to the release.
5. Maintain a `versions.json` mapping versions to minimum Obsidian versions.
6. Include a `README.md` in the repo root.
7. Submit a PR to [obsidian-releases](https://github.com/obsidianmd/obsidian-releases) adding your plugin to `community-plugins.json`.

### community-plugins.json entry

```json
{
  "id": "your-plugin-id",
  "name": "Your Plugin Name",
  "author": "Your Name",
  "description": "Brief description",
  "repo": "your-github-username/your-repo-name",
  "branch": "main"
}
```

### Review Guidelines

- No `eval()` or `Function()` constructors.
- No minified code in the repository (only in release assets).
- No network requests without user consent.
- Settings must be persisted correctly via `loadData`/`saveData`.
- Plugin must be fully functional from the community plugin browser (no manual setup required beyond settings).

---

## 12. Recommendations for This Project

### Architecture Recommendation

```
obsidian-plugin/
├── src/
│   ├── main.ts                 # Plugin entry, lifecycle, commands, ribbon
│   ├── settings.ts             # Settings interface + PluginSettingTab
│   ├── graph/
│   │   ├── crawler.ts          # BFS/DFS spider through linked notes
│   │   ├── extractor.ts        # Extract concepts, relationships, metadata
│   │   └── types.ts            # NoteData, Edge, GraphPayload interfaces
│   ├── api/
│   │   ├── client.ts           # requestUrl wrapper for external app
│   │   └── types.ts            # API request/response types
│   └── views/
│       └── graph-view.ts       # ItemView with iframe for 3D visualization
├── manifest.json
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── styles.css
└── versions.json
```

### Key Design Decisions

1. **Use `metadataCache` over regex parsing.** The cache is maintained by Obsidian, is fast, handles edge cases, and is always up to date.

2. **Use `requestUrl` for all HTTP calls.** It bypasses CORS and works on mobile.

3. **Embed the external 3D view via iframe in an ItemView.** Use `postMessage` for bidirectional communication between the plugin and the web app. When a user clicks a node in the 3D view, send a message back to Obsidian to open that note.

4. **Use the `resolved` event for initial sync.** Wait for all metadata to be resolved before building the full graph payload:
   ```typescript
   this.registerEvent(
     this.app.metadataCache.on("resolved", () => {
       if (this.settings.syncOnStartup) {
         this.syncToExternalApp();
       }
     })
   );
   ```

5. **Debounce incremental updates.** Listen to `metadataCache.on("changed")` but debounce to avoid sending too many API calls:
   ```typescript
   import { debounce } from "obsidian";

   const debouncedSync = debounce(
     async (file: TFile) => { await this.syncNote(file); },
     2000,
     true
   );

   this.registerEvent(
     this.app.metadataCache.on("changed", (file) => {
       debouncedSync(file);
     })
   );
   ```

6. **Batch large vault syncs.** For large vaults (1000+ notes), send data in batches to avoid memory issues and request timeouts. Consider a chunked upload protocol with the external API.

---

## Sources

- [Obsidian Sample Plugin (Official Template)](https://github.com/obsidianmd/obsidian-sample-plugin)
- [Obsidian API Type Definitions](https://github.com/obsidianmd/obsidian-api)
- [Obsidian Developer Documentation](https://docs.obsidian.md/Home)
- [Plugin API Reference](https://docs.obsidian.md/Reference/TypeScript+API/Plugin)
- [PluginSettingTab Reference](https://docs.obsidian.md/Reference/TypeScript+API/PluginSettingTab)
- [MetadataCache and Link Resolution (DeepWiki)](https://deepwiki.com/obsidianmd/obsidian-api/2.4-metadatacache-and-link-resolution)
- [resolvedLinks API](https://docs.obsidian.md/Reference/TypeScript+API/MetadataCache/resolvedLinks)
- [Obsidian Plugin Developer Docs (Marcus Olsson)](https://marcusolsson.github.io/obsidian-plugin-docs/)
- [Views Guide](https://marcusolsson.github.io/obsidian-plugin-docs/user-interface/views)
- [Hot Reload Plugin](https://github.com/pjeby/hot-reload)
- [esbuild-plugin-obsidian](https://github.com/eth-p/esbuild-plugin-obsidian)
- [Obsidian 3D Graph Plugin](https://github.com/AlexW00/obsidian-3d-graph)
- [New 3D Graph Plugin](https://www.obsidianstats.com/plugins/new-3d-graph)
- [Custom Frames Plugin (iframe embedding)](https://github.com/Ellpeck/ObsidianCustomFrames)
- [Local REST API Plugin](https://github.com/coddingtonbear/obsidian-local-rest-api)
- [Export Graph View Plugin](https://www.obsidianstats.com/plugins/export-graph-view)
- [Obsidian Typings (Undocumented APIs)](https://github.com/Fevol/obsidian-typings)
- [Backlinks Forum Discussion](https://forum.obsidian.md/t/how-to-get-backlinks-for-a-file/45314)
- [HTTP Requests Forum Discussion](https://forum.obsidian.md/t/make-http-requests-from-plugins/15461)
- [Submit Your Plugin Guide](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)
- [Plugin Guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
- [obsidian-releases Repository](https://github.com/obsidianmd/obsidian-releases)
