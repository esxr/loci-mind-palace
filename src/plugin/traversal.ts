import { Vault, TFile } from "obsidian";
import type { NoteContent } from "../../shared/types";

const WIKILINK_REGEX = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

/**
 * Collects notes from the vault using BFS traversal over wikilinks.
 *
 * Starting from `selectedTitles`, reads each note's content and follows
 * [[wikilinks]] up to `depth` hops, collecting all reachable notes.
 */
export async function collectNotes(
  vault: Vault,
  selectedTitles: string[],
  depth: number
): Promise<NoteContent[]> {
  const collected = new Map<string, NoteContent>();
  const queue: Array<{ title: string; currentDepth: number }> =
    selectedTitles.map((t) => ({ title: t, currentDepth: 0 }));

  while (queue.length > 0) {
    const { title, currentDepth } = queue.shift()!;

    if (collected.has(title) || currentDepth > depth) continue;

    const file = vault.getAbstractFileByPath(`${title}.md`);
    if (!file || !(file instanceof TFile)) continue;

    const content = await vault.read(file);
    collected.set(title, { title, content });

    if (currentDepth < depth) {
      const wikilinks = content.match(WIKILINK_REGEX) || [];
      const linkedTitles = wikilinks.map((link) =>
        link.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/, "$1")
      );
      for (const lt of linkedTitles) {
        queue.push({ title: lt, currentDepth: currentDepth + 1 });
      }
    }
  }

  return Array.from(collected.values());
}
