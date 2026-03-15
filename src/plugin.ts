/**
 * Plugin entry point for opencode-memfs.
 *
 * Exports the MemFSPlugin factory conforming to the Plugin type from @opencode-ai/plugin.
 * Registers hooks (experimental.chat.system.transform, tool) and wires up
 * the store, git, watcher, and tool handlers.
 *
 * All memory is centralized under ~/.config/opencode/memory/:
 * - global/       — shared across all projects
 * - projects/<n>/ — per-project memory (named by project directory basename)
 *
 * Single git repo and single filesystem watcher at the memory root.
 */

import { mkdir, readFile } from "fs/promises"
import { createHash } from "crypto"
import { homedir } from "os"
import path from "path"

import type { SimpleGit } from "simple-git"

import type { Plugin, Hooks } from "@opencode-ai/plugin"

import type { MemoryStorePaths, MemFSConfig, ProjectRegistryEntry } from "./types"
import { loadConfig } from "./config"
import {
  parseFrontmatter,
  serializeFrontmatter,
  defaultFrontmatter,
  atomicWrite,
} from "./frontmatter"
import { ensureRepo } from "./git"
import { ensureSeed } from "./seed"
import { scanAllStores, buildTree, partitionFiles } from "./store"
import { renderMemFS } from "./prompt"
import { startWatcher } from "./watcher"
import type { WatcherHandle } from "./watcher"
import { createAllTools } from "./tools"
import type { MemFSState } from "./tools"
import { createFileLock, createMutex } from "./lock"

// ---------------------------------------------------------------------------
// Projects Registry
// ---------------------------------------------------------------------------

/** Regex matching a single row in the projects table. */
const TABLE_ROW_RE = /^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/

/**
 * Parse the projects registry from the body of projects.md.
 *
 * Expects a markdown table with columns: Project | Path | Last Seen.
 * Skips the header row and separator row.
 */
export function parseProjectsRegistry(body: string): ProjectRegistryEntry[] {
  const entries: ProjectRegistryEntry[] = []
  const lines = body.split("\n")

  let headerSeen = false
  for (const line of lines) {
    const match = line.match(TABLE_ROW_RE)
    if (!match) continue

    // Skip header row (contains "Project")
    if (!headerSeen && match[1].trim().toLowerCase() === "project") {
      headerSeen = true
      continue
    }

    // Skip separator row (contains only dashes)
    if (/^[-\s|]+$/.test(line)) continue

    entries.push({
      name: match[1].trim(),
      path: match[2].trim(),
      lastSeen: match[3].trim(),
    })
  }

  return entries
}

/**
 * Serialize the projects registry into a markdown table body.
 */
export function serializeProjectsTable(entries: ProjectRegistryEntry[]): string {
  if (entries.length === 0) {
    return "| Project | Path | Last Seen |\n|---|---|---|"
  }

  const header = "| Project | Path | Last Seen |\n|---|---|---|"
  const rows = entries.map(
    (e) => `| ${e.name} | ${e.path} | ${e.lastSeen} |`
  )

  return `${header}\n${rows.join("\n")}`
}

/**
 * Read the projects registry from projects.md.
 *
 * Returns an empty array if the file doesn't exist yet.
 */
export async function readRegistry(
  registryPath: string,
  defaultLimit: number,
): Promise<ProjectRegistryEntry[]> {
  try {
    const raw = await readFile(registryPath, "utf-8")
    const { body } = parseFrontmatter(raw, "system/projects.md", defaultLimit)
    return parseProjectsRegistry(body)
  } catch {
    return []
  }
}

/**
 * Write the projects registry to projects.md.
 */
export async function writeRegistry(
  registryPath: string,
  entries: ProjectRegistryEntry[],
  defaultLimit: number,
): Promise<void> {
  const fm = defaultFrontmatter("system/projects.md", {
    description: "Registry of all known projects with their paths",
    limit: defaultLimit,
    readonly: true,
  })

  const tableBody = serializeProjectsTable(entries)
  const content = serializeFrontmatter(fm, tableBody)

  await atomicWrite(registryPath, content)
}

/**
 * Check whether a project directory basename looks like a real project name.
 *
 * Rejects names that appear to be internal/encoded IDs, such as:
 * - Base64-encoded paths (strings that decode to an absolute path starting with `/`)
 * - Names longer than 64 characters (unlikely for real project dirs)
 */
export function isValidProjectName(name: string): boolean {
  // Reject empty names
  if (!name || name.length === 0) return false

  // Reject names that are too long to be real project directories
  if (name.length > 64) return false

  // Reject names that are base64-encoded absolute paths.
  // Only test strings that consist entirely of base64 characters.
  if (/^[A-Za-z0-9+/=]+$/.test(name)) {
    try {
      const decoded = Buffer.from(name, "base64").toString("utf-8")
      if (decoded.startsWith("/")) return false
    } catch {
      // Not valid base64, that's fine
    }
  }

  return true
}

/**
 * Resolve the project name for the current project directory.
 *
 * Uses `path.basename()` as the default name. If the basename is already
 * registered to a different project path (collision), appends a short hash
 * of the full path as a suffix (e.g. "myapp-a3f2").
 *
 * Registers or updates the project entry in the registry.
 *
 * @returns The resolved project name.
 */
export async function resolveProjectName(
  registryPath: string,
  projectDir: string,
  config: MemFSConfig,
): Promise<string> {
  const entries = await readRegistry(registryPath, config.defaultLimit)
  const today = new Date().toISOString().slice(0, 10)

  // Check if this project directory is already registered
  const existing = entries.find((e) => e.path === projectDir)
  if (existing) {
    existing.lastSeen = today
    await writeRegistry(registryPath, entries, config.defaultLimit)
    return existing.name
  }

  // Derive name from basename
  const basename = path.basename(projectDir)

  // Check for basename collision
  const collision = entries.find((e) => e.name === basename)
  let name = basename
  if (collision) {
    const hash = createHash("sha256")
      .update(projectDir)
      .digest("hex")
      .slice(0, 4)
    name = `${basename}-${hash}`
  }

  // Register new project
  entries.push({ name, path: projectDir, lastSeen: today })
  await writeRegistry(registryPath, entries, config.defaultLimit)

  return name
}

// ---------------------------------------------------------------------------
// Plugin Factory
// ---------------------------------------------------------------------------

/**
 * MemFS plugin factory.
 *
 * Initializes the centralized memory store under ~/.config/opencode/memory/,
 * with global/ and projects/<name>/ subdirectories. Uses a single git repo
 * and a single filesystem watcher at the memory root.
 */
export const MemFSPlugin: Plugin = async (input) => {
  // Skip initialization entirely for invalid directory names (e.g. base64-encoded
  // internal IDs). OpenCode calls the plugin factory once per project instance,
  // so garbled directories get a no-op plugin — no stores, no git, no watcher.
  const basename = path.basename(input.directory)
  if (!isValidProjectName(basename)) {
    return {}
  }

  const config = await loadConfig()

  // -----------------------------------------------------------------------
  // Resolve memory paths
  // -----------------------------------------------------------------------

  const memoryRoot = path.join(homedir(), ".config", "opencode", "memory")
  await mkdir(memoryRoot, { recursive: true })

  // Global store: ~/.config/opencode/memory/global/
  const globalRoot = path.join(memoryRoot, "global")
  await mkdir(globalRoot, { recursive: true })

  // Seed global store first (before resolveProjectName writes projects.md,
  // which would cause scanDir to see existing files and skip seeding)
  await ensureSeed(globalRoot, config, "global")

  // Resolve project name and register in projects.md
  const registryPath = path.join(globalRoot, config.hotDir, "projects.md")
  const projectName = await resolveProjectName(
    registryPath,
    input.directory,
    config,
  )

  // -----------------------------------------------------------------------
  // Build stores array
  // -----------------------------------------------------------------------

  // Project store: ~/.config/opencode/memory/projects/<name>/
  const projectRoot = path.join(memoryRoot, "projects", projectName)
  await mkdir(projectRoot, { recursive: true })
  await ensureSeed(projectRoot, config, "project")

  const stores: MemoryStorePaths[] = [
    { root: projectRoot, scope: "project" },
    { root: globalRoot, scope: "global" },
  ]

  // -----------------------------------------------------------------------
  // Concurrency locks
  // -----------------------------------------------------------------------

  const withFileLock = createFileLock()
  const withGitLock = createMutex()

  // -----------------------------------------------------------------------
  // Git + watcher
  // -----------------------------------------------------------------------

  // Single git repo at the memory root
  const git: SimpleGit = await ensureRepo(memoryRoot)



  // Single watcher at the memory root (uses git lock to serialize commits)
  const watcher: WatcherHandle = startWatcher(
    memoryRoot,
    git,
    config.autoCommitDebounceMs,
    withGitLock,
  )

  // -----------------------------------------------------------------------
  // Build plugin state
  // -----------------------------------------------------------------------

  const state: MemFSState = {
    stores,
    git,
    config,
    withFileLock,
    withGitLock,
    readFiles: new Map(),
  }

  // -----------------------------------------------------------------------
  // Build hooks
  // -----------------------------------------------------------------------

  const hooks: Hooks = {
    // Register all 9 memory tools
    tool: createAllTools(state),

    // Inject <memfs> block into system prompt at position 1
    "experimental.chat.system.transform": async (_input, output) => {
      try {
        const files = await scanAllStores(
          stores,
          "all",
          config.defaultLimit,
          config.maxTreeDepth,
        )

        const treeEntries = buildTree(files)
        const { hot } = partitionFiles(files, config.hotDir)

        const memfsBlock = renderMemFS(treeEntries, hot)
        // Insert after the first system message if possible, otherwise append
        const insertAt = Math.min(1, output.system.length)
        output.system.splice(insertAt, 0, memfsBlock)
      } catch {
        // If scanning fails, don't crash the conversation
        // The agent can still use tools to access memory
      }
    },
  }

  return hooks
}
