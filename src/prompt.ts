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

import type { MemoryFile, MemoryScope, MemoryTreeEntry } from "./types"

// ---------------------------------------------------------------------------
// Tree Rendering
// ---------------------------------------------------------------------------

/**
 * Render scoped `<tree>` blocks for memory files.
 *
 * Partitions entries by scope and renders a separate `<tree scope="...">` block
 * for each scope that has entries. This makes scope visually clear in the system
 * prompt without prefixing every line.
 *
 * @param entries - Tree entries from `buildTree()`.
 * @returns The rendered `<tree>` blocks joined by newlines.
 */
export function renderTree(entries: MemoryTreeEntry[]): string {
  if (entries.length === 0) {
    return "<tree>\n(no memory files yet)\n</tree>"
  }

  // Group entries by scope
  const byScope = new Map<MemoryScope, MemoryTreeEntry[]>()
  for (const entry of entries) {
    const group = byScope.get(entry.scope) ?? []
    group.push(entry)
    byScope.set(entry.scope, group)
  }

  // Render each scope's tree block (global first for consistency)
  const scopeOrder: MemoryScope[] = ["global", "project"]
  const blocks: string[] = []

  for (const scope of scopeOrder) {
    const group = byScope.get(scope)
    if (!group || group.length === 0) continue

    const lines = group.map(
      (e) => `${e.path} (${e.chars}/${e.limit}) — ${e.description}`
    )
    blocks.push(`<tree scope="${scope}">\n${lines.join("\n")}\n</tree>`)
  }

  return blocks.join("\n\n")
}

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

/** Static instructions block for the agent. */
const INSTRUCTIONS = `<instructions>
Your persistent memory is stored as markdown files.
Files in system/ are pinned — you always see their full contents below.
Other files are listed in the tree with descriptions only.

Memory has two scopes: project (local to this project) and global (shared across all projects).
All memory tools require a scope parameter — check the tree to see which scope a file is in.

To read a cold file: memory_read
To update memory: memory_write (full replace) or memory_edit (partial)
To create new memory: memory_write with a new path
To delete memory: memory_delete
To reorganize: memory_promote / memory_demote
To view history: memory_history
To undo changes: memory_rollback

IMPORTANT: You MUST proactively maintain your memory. Do NOT wait to be asked.

Before responding to the user:
1. Check if your memory contains relevant context — use memory_read for cold files if needed
2. Consider whether past sessions inform your approach

After providing your response, proactively update the relevant system/ files (see tree for each file's purpose).
For longer-form context — decision rationale, investigation results, solution write-ups — create reference/ files with descriptive names (e.g., reference/auth-migration.md, not reference/notes.md).
Use archive/ for files no longer actively relevant.

Guidelines:
- Check existing content before writing — update in place, don't append duplicates
- Use bullet points. Start entries with context (what/why).
- Keep entries concise and actionable — memory is for future you, not a log.
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
      const attrs = `path="${file.path}" chars="${file.chars}" limit="${file.frontmatter.limit}" scope="${file.scope}"`
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
