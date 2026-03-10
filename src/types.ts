/**
 * Core type definitions for opencode-memfs.
 *
 * Defines shared interfaces for memory files, frontmatter,
 * tree entries, tool inputs/outputs, and config.
 */

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

/** Memory scope — project-local or global (cross-project). */
export type MemoryScope = "project" | "global"

/** Scope filter for read operations — includes "all" to query both. */
export type MemoryScopeFilter = MemoryScope | "all"

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

/** YAML frontmatter fields stored at the top of each memory file. */
export interface MemoryFrontmatter {
  /** Human-readable description — visible in tree listing for cold files. */
  description: string
  /** Maximum character count for the file body. */
  limit: number
  /** When true, the agent cannot modify this file. */
  readonly: boolean
}

// ---------------------------------------------------------------------------
// Memory File
// ---------------------------------------------------------------------------

/** A parsed memory file (frontmatter + body + metadata). */
export interface MemoryFile {
  /** Relative path within the memory directory (e.g. "system/persona.md"). */
  path: string
  /** Parsed YAML frontmatter. */
  frontmatter: MemoryFrontmatter
  /** Markdown body content (everything after the frontmatter block). */
  content: string
  /** Current character count of the body content. */
  chars: number
  /** Which scope this file belongs to. */
  scope: MemoryScope
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

/** A single entry in the memory tree listing. */
export interface MemoryTreeEntry {
  /** Relative path within the memory directory. */
  path: string
  /** Description from frontmatter. */
  description: string
  /** Current character count of the body. */
  chars: number
  /** Character limit from frontmatter. */
  limit: number
  /** Which scope this file belongs to. */
  scope: MemoryScope
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

/** A single entry from the git history log. */
export interface MemoryCommit {
  /** Abbreviated commit hash. */
  hash: string
  /** Commit message. */
  message: string
  /** ISO 8601 timestamp. */
  date: string
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Plugin configuration loaded from ~/.config/opencode/memfs.json. */
export interface MemFSConfig {
  /** Directory name for hot (pinned) files. Default: "system". */
  hotDir: string
  /** Default character limit for new files. Default: 5000. */
  defaultLimit: number
  /** Debounce delay (ms) before auto-committing changes. Default: 2000. */
  autoCommitDebounceMs: number
  /** Maximum directory depth shown in tree listing. Default: 3. */
  maxTreeDepth: number
}

// ---------------------------------------------------------------------------
// Projects Registry
// ---------------------------------------------------------------------------

/** An entry in the projects registry (global/system/projects.md). */
export interface ProjectRegistryEntry {
  /** Derived project name (basename or basename-hash on collision). */
  name: string
  /** Absolute path to the project directory. */
  path: string
  /** ISO 8601 date string of last plugin init for this project. */
  lastSeen: string
}

// ---------------------------------------------------------------------------
// Tool Inputs
// ---------------------------------------------------------------------------

/** Input args for memory_read. */
export interface ReadInput {
  /** Relative path to the memory file. */
  path: string
}

/** Input args for memory_write. */
export interface WriteInput {
  /** Relative path to the memory file. */
  path: string
  /** Full content body to write. */
  content: string
  /** Optional description (auto-generated from filename if omitted). */
  description?: string
  /** Optional character limit (defaults to config.defaultLimit). */
  limit?: number
  /** Optional readonly flag (defaults to false). */
  readonly?: boolean
}

/** Input args for memory_edit. */
export interface EditInput {
  /** Relative path to the memory file. */
  path: string
  /** Exact string to find in the file body. */
  oldString: string
  /** Replacement string. */
  newString: string
}

/** Input args for memory_delete. */
export interface DeleteInput {
  /** Relative path to the memory file. */
  path: string
}

/** Input args for memory_promote. */
export interface PromoteInput {
  /** Relative path to the cold file to move into system/. */
  path: string
}

/** Input args for memory_demote. */
export interface DemoteInput {
  /** Relative path to the hot file to move into reference/. */
  path: string
}

/** Input args for memory_tree. */
export interface TreeInput {
  /** Which scope to show. Default: "all". */
  scope?: MemoryScopeFilter
}

/** Input args for memory_history. */
export interface HistoryInput {
  /** Maximum number of commits to return. Default: 10. */
  limit?: number
}

/** Input args for memory_rollback. */
export interface RollbackInput {
  /** Git commit hash to revert memory to. */
  commitHash: string
}

// ---------------------------------------------------------------------------
// Plugin Context
// ---------------------------------------------------------------------------

/** Resolved paths for a single memory store (project or global). */
export interface MemoryStorePaths {
  /** Absolute path to the memory root directory. */
  root: string
  /** Which scope this store represents. */
  scope: MemoryScope
}
