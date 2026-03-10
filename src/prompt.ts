/**
 * System prompt rendering for opencode-memfs.
 *
 * Renders the <memfs> XML block injected into the system prompt:
 * - <tree> with descriptions and char counts for all files
 * - <instructions> with tool usage guidance
 * - <system> blocks with full content for hot (system/) files
 *
 * Hook: experimental.chat.system.transform — inserts at position 1.
 */

import type { MemoryFile, MemoryTreeEntry } from "./types"

// ---------------------------------------------------------------------------
// Tree Rendering
// ---------------------------------------------------------------------------

/**
 * Render the `<tree>` section listing all memory files.
 *
 * Each line shows: `path (chars/limit) — description`
 *
 * @param entries - Tree entries from `buildTree()`.
 * @returns The rendered `<tree>` block.
 */
export function renderTree(entries: MemoryTreeEntry[]): string {
  if (entries.length === 0) {
    return "<tree>\n(no memory files yet)\n</tree>"
  }

  const lines = entries.map(
    (e) => `${e.path} (${e.chars}/${e.limit}) — ${e.description}`
  )

  return `<tree>\n${lines.join("\n")}\n</tree>`
}

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

/** Static instructions block for the agent. */
const INSTRUCTIONS = `<instructions>
Your persistent memory is stored as markdown files.
Files in system/ are pinned — you always see their full contents below.
Other files are listed in the tree with descriptions only.

To read a cold file: memory_read
To update memory: memory_write (full replace) or memory_edit (partial)
To create new memory: memory_write with a new path
To delete memory: memory_delete
To reorganize: memory_promote / memory_demote
To view history: memory_history
To undo changes: memory_rollback
</instructions>`

/**
 * Render the `<instructions>` section.
 *
 * @returns The static instructions block.
 */
export function renderInstructions(): string {
  return INSTRUCTIONS
}

// ---------------------------------------------------------------------------
// Hot File Content
// ---------------------------------------------------------------------------

/**
 * Render `<system>` blocks for each hot file.
 *
 * Each block includes the path, char count, and limit as attributes,
 * with the full body content inside.
 *
 * @param hotFiles - Parsed hot memory files (system/ tier).
 * @returns Rendered `<system>` blocks joined by newlines.
 */
export function renderHotFiles(hotFiles: MemoryFile[]): string {
  if (hotFiles.length === 0) return ""

  return hotFiles
    .map((file) => {
      const attrs = `path="${file.path}" chars="${file.chars}" limit="${file.frontmatter.limit}"`
      const body = file.content.trim()
      if (body.length === 0) {
        return `<system ${attrs}>\n(empty)\n</system>`
      }
      return `<system ${attrs}>\n${body}\n</system>`
    })
    .join("\n\n")
}

// ---------------------------------------------------------------------------
// Full Block
// ---------------------------------------------------------------------------

/**
 * Compose the full `<memfs>` block for system prompt injection.
 *
 * Combines tree listing, instructions, and hot file contents.
 *
 * @param treeEntries - All tree entries (hot + cold).
 * @param hotFiles    - Parsed hot memory files with content.
 * @returns The complete `<memfs>` XML block.
 */
export function renderMemFS(
  treeEntries: MemoryTreeEntry[],
  hotFiles: MemoryFile[],
): string {
  const parts = [
    renderTree(treeEntries),
    "",
    renderInstructions(),
  ]

  const hotContent = renderHotFiles(hotFiles)
  if (hotContent.length > 0) {
    parts.push("")
    parts.push(hotContent)
  }

  return `<memfs>\n${parts.join("\n")}\n</memfs>`
}
