/**
 * Tool handlers for all 9 custom memory tools.
 *
 * Content tools: memory_read, memory_write, memory_edit, memory_delete
 * Hierarchy tools: memory_promote, memory_demote
 * Git/navigation tools: memory_tree, memory_history, memory_rollback
 *
 * Each function is a factory that takes plugin state and returns a
 * `ToolDefinition` compatible with the plugin SDK's `tool()` helper.
 */

import { access, readFile, unlink, rename, mkdir } from "fs/promises"
import path from "path"

import type { SimpleGit } from "simple-git"

import { tool } from "@opencode-ai/plugin"
import type { ToolDefinition } from "@opencode-ai/plugin"

import type { MemFSConfig, MemoryFrontmatter, MemoryStorePaths, MemoryScopeFilter } from "./types"
import {
  parseFrontmatter,
  defaultFrontmatter,
  serializeFrontmatter,
  writeMemoryFile,
  parseMemoryFile,
} from "./frontmatter"
import { scanAllStores, buildTree, isHot } from "./store"
import { getLog, rollback } from "./git"
import type { FileLockFn, LockFn } from "./lock"

// ---------------------------------------------------------------------------
// Plugin State (shared across all tools)
// ---------------------------------------------------------------------------

/** State shared by all tool handlers. */
export interface MemFSState {
  /** All memory stores (project + optional global). */
  stores: MemoryStorePaths[]
  /** Single git instance (all stores share one repo). */
  git: SimpleGit
  /** Plugin configuration. */
  config: MemFSConfig
  /** Per-file lock for serializing read-modify-write operations. */
  withFileLock: FileLockFn
  /** Git operation lock for serializing commits and rollbacks. */
  withGitLock: LockFn
}

// ---------------------------------------------------------------------------
// Path Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a relative memory path to an absolute path and its store.
 *
 * Tries each store in order. If the file exists in a store, returns that.
 * If creating a new file, defaults to the first (project) store.
 *
 * @returns Object with `absPath`, `store`, and `relativePath`.
 */
async function resolvePath(
  state: MemFSState,
  relPath: string,
): Promise<{ absPath: string; store: MemoryStorePaths; relativePath: string }> {
  // Normalize path separators
  const normalized = relPath.replace(/\\/g, "/")

  // Try to find the file in existing stores
  for (const store of state.stores) {
    const absPath = path.join(store.root, normalized)
    try {
      await access(absPath)
      return { absPath, store, relativePath: normalized }
    } catch {
      // File doesn't exist in this store, try next
    }
  }

  // Default to first store (project scope) for new files
  const store = state.stores[0]
  return {
    absPath: path.join(store.root, normalized),
    store,
    relativePath: normalized,
  }
}

// ---------------------------------------------------------------------------
// memory_read
// ---------------------------------------------------------------------------

/** Create the `memory_read` tool definition. */
export function createMemoryRead(state: MemFSState): ToolDefinition {
  return tool({
    description: "Read a memory file with metadata. Returns path, description, char count, limit, readonly status, and full content.",
    args: {
      path: tool.schema.string().describe("Relative path to the memory file (e.g. 'system/persona.md')"),
    },
    async execute(args) {
      const { absPath, store, relativePath } = await resolvePath(state, args.path)

      const file = await parseMemoryFile(
        absPath,
        relativePath,
        store.scope,
        state.config.defaultLimit,
      )

      const header = [
        `path: ${file.path}`,
        `description: ${file.frontmatter.description}`,
        `chars: ${file.chars} / ${file.frontmatter.limit}`,
        `readonly: ${file.frontmatter.readonly}`,
        `scope: ${file.scope}`,
      ].join("\n")

      return `${header}\n---\n${file.content}`
    },
  })
}

// ---------------------------------------------------------------------------
// memory_write
// ---------------------------------------------------------------------------

/** Create the `memory_write` tool definition. */
export function createMemoryWrite(state: MemFSState): ToolDefinition {
  return tool({
    description: "Create or fully replace a memory file. Auto-generates frontmatter defaults for omitted fields. Validates char limit and readonly status.",
    args: {
      path: tool.schema.string().describe("Relative path to the memory file"),
      content: tool.schema.string().describe("Full content body to write"),
      description: tool.schema.string().optional().describe("File description (auto-generated from filename if omitted)"),
      limit: tool.schema.number().optional().describe("Character limit (defaults to config.defaultLimit)"),
      readonly: tool.schema.boolean().optional().describe("Whether the file is readonly (defaults to false)"),
    },
    async execute(args) {
      const { absPath, store, relativePath } = await resolvePath(state, args.path)

      return state.withFileLock(absPath, async () => {
        // Check if file exists — preserve existing frontmatter on overwrite
        let existingFm: MemoryFrontmatter | undefined
        try {
          const raw = await readFile(absPath, "utf-8")
          const existing = parseFrontmatter(raw, relativePath, state.config.defaultLimit)
          if (existing.frontmatter.readonly) {
            return `Error: ${relativePath} is readonly. Cannot overwrite.`
          }
          existingFm = existing.frontmatter
        } catch {
          // File doesn't exist — creating new file, no readonly check needed
        }

        // Build frontmatter: args override existing, existing overrides auto-generated
        const fm = defaultFrontmatter(relativePath, {
          description: args.description ?? existingFm?.description,
          limit: args.limit ?? existingFm?.limit,
          readonly: args.readonly ?? existingFm?.readonly,
        }, state.config.defaultLimit)

        // Validate content length
        if (args.content.length > fm.limit) {
          return `Error: Content length (${args.content.length}) exceeds limit (${fm.limit}). Reduce content or increase limit.`
        }

        // Write the file atomically
        await writeMemoryFile(absPath, fm, args.content)

        const tier = isHot(relativePath, state.config.hotDir) ? "hot (system)" : "cold"
        return `Wrote ${relativePath} (${args.content.length}/${fm.limit} chars, ${tier}, ${store.scope} scope)`
      })
    },
  })
}

// ---------------------------------------------------------------------------
// memory_edit
// ---------------------------------------------------------------------------

/** Create the `memory_edit` tool definition. */
export function createMemoryEdit(state: MemFSState): ToolDefinition {
  return tool({
    description: "Partial edit of a memory file using exact oldString/newString replacement. Same semantics as the Edit tool.",
    args: {
      path: tool.schema.string().describe("Relative path to the memory file"),
      oldString: tool.schema.string().describe("Exact string to find in the file body"),
      newString: tool.schema.string().describe("Replacement string"),
    },
    async execute(args) {
      const { absPath, store, relativePath } = await resolvePath(state, args.path)

      return state.withFileLock(absPath, async () => {
        // Read and parse
        const file = await parseMemoryFile(
          absPath,
          relativePath,
          store.scope,
          state.config.defaultLimit,
        )

        // Check readonly
        if (file.frontmatter.readonly) {
          return `Error: ${relativePath} is readonly. Cannot edit.`
        }

        // Find and replace — reject if ambiguous (multiple matches)
        if (!file.content.includes(args.oldString)) {
          return `Error: oldString not found in ${relativePath}. Make sure it matches exactly.`
        }

        const matchCount = file.content.split(args.oldString).length - 1
        if (matchCount > 1) {
          return `Error: Found ${matchCount} matches for oldString in ${relativePath}. Provide more surrounding context to identify the correct match.`
        }

        const newContent = file.content.replace(args.oldString, args.newString)

        // Validate new content length
        if (newContent.length > file.frontmatter.limit) {
          return `Error: Edited content (${newContent.length}) would exceed limit (${file.frontmatter.limit}).`
        }

        // Write back
        await writeMemoryFile(absPath, file.frontmatter, newContent)

        return `Edited ${relativePath} (${newContent.length}/${file.frontmatter.limit} chars)`
      })
    },
  })
}

// ---------------------------------------------------------------------------
// memory_delete
// ---------------------------------------------------------------------------

/** Create the `memory_delete` tool definition. */
export function createMemoryDelete(state: MemFSState): ToolDefinition {
  return tool({
    description: "Delete a memory file. Validates that the file exists and is not readonly.",
    args: {
      path: tool.schema.string().describe("Relative path to the memory file to delete"),
    },
    async execute(args) {
      const { absPath, store, relativePath } = await resolvePath(state, args.path)

      return state.withFileLock(absPath, async () => {
        // Read and parse to check readonly
        const file = await parseMemoryFile(
          absPath,
          relativePath,
          store.scope,
          state.config.defaultLimit,
        )

        if (file.frontmatter.readonly) {
          return `Error: ${relativePath} is readonly. Cannot delete.`
        }

        await unlink(absPath)

        return `Deleted ${relativePath} (${store.scope} scope)`
      })
    },
  })
}

// ---------------------------------------------------------------------------
// memory_promote
// ---------------------------------------------------------------------------

/** Create the `memory_promote` tool definition. */
export function createMemoryPromote(state: MemFSState): ToolDefinition {
  return tool({
    description: "Move a cold file into the system/ directory (make it hot). The file will be pinned in the system prompt.",
    args: {
      path: tool.schema.string().describe("Relative path to the cold file to promote"),
    },
    async execute(args) {
      const { absPath, store, relativePath } = await resolvePath(state, args.path)

      return state.withFileLock(absPath, async () => {
        // Check if already hot
        if (isHot(relativePath, state.config.hotDir)) {
          return `Error: ${relativePath} is already in ${state.config.hotDir}/. Nothing to promote.`
        }

        // Compute new path in system/
        const filename = path.basename(relativePath)
        const newRelPath = `${state.config.hotDir}/${filename}`
        const newAbsPath = path.join(store.root, newRelPath)

        // Check for destination conflict
        try {
          await access(newAbsPath)
          return `Error: ${newRelPath} already exists. Rename or delete it before promoting.`
        } catch {
          // Destination doesn't exist — safe to proceed
        }

        // Ensure system/ directory exists
        await mkdir(path.dirname(newAbsPath), { recursive: true })

        // Move the file
        await rename(absPath, newAbsPath)

        return `Promoted ${relativePath} → ${newRelPath} (now hot, pinned in system prompt)`
      })
    },
  })
}

// ---------------------------------------------------------------------------
// memory_demote
// ---------------------------------------------------------------------------

/** Create the `memory_demote` tool definition. */
export function createMemoryDemote(state: MemFSState): ToolDefinition {
  return tool({
    description: "Move a hot file from system/ into reference/ (make it cold). The file will only appear as a tree entry.",
    args: {
      path: tool.schema.string().describe("Relative path to the hot file to demote"),
    },
    async execute(args) {
      const { absPath, store, relativePath } = await resolvePath(state, args.path)

      return state.withFileLock(absPath, async () => {
        // Check if actually hot
        if (!isHot(relativePath, state.config.hotDir)) {
          return `Error: ${relativePath} is not in ${state.config.hotDir}/. Nothing to demote.`
        }

        // Compute new path in reference/
        const filename = path.basename(relativePath)
        const newRelPath = `reference/${filename}`
        const newAbsPath = path.join(store.root, newRelPath)

        // Check for destination conflict
        try {
          await access(newAbsPath)
          return `Error: ${newRelPath} already exists. Rename or delete it before demoting.`
        } catch {
          // Destination doesn't exist — safe to proceed
        }

        // Ensure reference/ directory exists
        await mkdir(path.dirname(newAbsPath), { recursive: true })

        // Move the file
        await rename(absPath, newAbsPath)

        return `Demoted ${relativePath} → ${newRelPath} (now cold, tree-only)`
      })
    },
  })
}

// ---------------------------------------------------------------------------
// memory_tree
// ---------------------------------------------------------------------------

/** Create the `memory_tree` tool definition. */
export function createMemoryTree(state: MemFSState): ToolDefinition {
  return tool({
    description: "Show the memory tree with descriptions and character counts for all files. Optionally filter by scope.",
    args: {
      scope: tool.schema.enum(["all", "project", "global"]).optional().default("all")
        .describe("Which scope to show: 'all', 'project', or 'global'"),
    },
    async execute(args) {
      const scopeFilter = (args.scope ?? "all") as MemoryScopeFilter
      const files = await scanAllStores(
        state.stores,
        scopeFilter,
        state.config.defaultLimit,
        state.config.maxTreeDepth,
      )

      if (files.length === 0) {
        return "(no memory files found)"
      }

      const entries = buildTree(files)
      const lines = entries.map(
        (e) => `${e.path} (${e.chars}/${e.limit}) — ${e.description}`
      )

      return lines.join("\n")
    },
  })
}

// ---------------------------------------------------------------------------
// memory_history
// ---------------------------------------------------------------------------

/** Create the `memory_history` tool definition. */
export function createMemoryHistory(state: MemFSState): ToolDefinition {
  return tool({
    description: "Show git history of memory changes. Returns commit hash, message, and date.",
    args: {
      limit: tool.schema.number().optional().default(10)
        .describe("Maximum number of commits to return (default: 10)"),
    },
    async execute(args) {
      return state.withGitLock(async () => {
        const limit = args.limit ?? 10
        const commits = await getLog(state.git, limit)

        if (commits.length === 0) {
          return "(no history yet)"
        }

        const lines = commits.map(
          (c) => `${c.hash} ${c.message} (${c.date})`
        )

        return lines.join("\n")
      })
    },
  })
}

// ---------------------------------------------------------------------------
// memory_rollback
// ---------------------------------------------------------------------------

/** Create the `memory_rollback` tool definition. */
export function createMemoryRollback(state: MemFSState): ToolDefinition {
  return tool({
    description: "Revert memory to a specific git commit. Creates a new commit recording the rollback (history is preserved).",
    args: {
      commitHash: tool.schema.string().describe("Git commit hash to revert to (from memory_history)"),
    },
    async execute(args) {
      return state.withGitLock(async () => {
        try {
          const newHash = await rollback(state.git, args.commitHash)
          return `Rolled back memory to ${args.commitHash.slice(0, 7)}. New commit: ${newHash}`
        } catch {
          return `Error: Commit ${args.commitHash} not found. Use memory_history to see available commits.`
        }
      })
    },
  })
}

// ---------------------------------------------------------------------------
// Tool Map Builder
// ---------------------------------------------------------------------------

/**
 * Create all 9 memory tool definitions from the plugin state.
 *
 * Returns a record suitable for the `tool` hook in the plugin's `Hooks`.
 */
export function createAllTools(state: MemFSState): Record<string, ToolDefinition> {
  return {
    memory_read: createMemoryRead(state),
    memory_write: createMemoryWrite(state),
    memory_edit: createMemoryEdit(state),
    memory_delete: createMemoryDelete(state),
    memory_promote: createMemoryPromote(state),
    memory_demote: createMemoryDemote(state),
    memory_tree: createMemoryTree(state),
    memory_history: createMemoryHistory(state),
    memory_rollback: createMemoryRollback(state),
  }
}
