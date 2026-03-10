/**
 * Plugin entry point for opencode-memfs.
 *
 * Exports the MemFSPlugin factory conforming to the Plugin type from @opencode-ai/plugin.
 * Registers hooks (experimental.chat.system.transform, tool) and wires up
 * the store, git, watcher, and tool handlers.
 */

import { mkdir } from "fs/promises"
import { homedir } from "os"
import path from "path"

import type { SimpleGit } from "simple-git"

import type { Plugin, Hooks } from "@opencode-ai/plugin"

import type { MemoryStorePaths } from "./types"
import { loadConfig } from "./config"
import { ensureRepo } from "./git"
import { ensureSeed } from "./seed"
import { scanAllStores, buildTree, partitionFiles } from "./store"
import { renderMemFS } from "./prompt"
import { startWatcher } from "./watcher"
import type { WatcherHandle } from "./watcher"
import { createAllTools } from "./tools"
import type { MemFSState } from "./tools"

// ---------------------------------------------------------------------------
// Plugin Factory
// ---------------------------------------------------------------------------

/**
 * MemFS plugin factory.
 *
 * Initializes the memory store(s), git repo(s), filesystem watcher(s),
 * and registers all tools and the system prompt transform hook.
 */
export const MemFSPlugin: Plugin = async (input) => {
  const config = await loadConfig()

  // -----------------------------------------------------------------------
  // Resolve memory store paths
  // -----------------------------------------------------------------------

  const stores: MemoryStorePaths[] = []
  const gitInstances = new Map<string, SimpleGit>()
  const watchers: WatcherHandle[] = []

  // Project memory: <project>/.opencode/memory/
  const projectMemoryRoot = path.join(input.directory, ".opencode", "memory")
  await mkdir(projectMemoryRoot, { recursive: true })
  stores.push({ root: projectMemoryRoot, scope: "project" })

  // Global memory: ~/.config/opencode/memory/
  if (config.globalMemoryEnabled) {
    const globalMemoryRoot = path.join(homedir(), ".config", "opencode", "memory")
    await mkdir(globalMemoryRoot, { recursive: true })
    stores.push({ root: globalMemoryRoot, scope: "global" })
  }

  // -----------------------------------------------------------------------
  // Initialize git repos + seed + watchers
  // -----------------------------------------------------------------------

  for (const store of stores) {
    // Seed default files (no-op if files already exist)
    await ensureSeed(store.root, config)

    // Initialize git repo
    const git = await ensureRepo(store.root)
    gitInstances.set(store.root, git)

    // Start filesystem watcher for auto-commit
    const watcher = startWatcher(store.root, git, config.autoCommitDebounceMs)
    watchers.push(watcher)
  }

  // -----------------------------------------------------------------------
  // Build plugin state
  // -----------------------------------------------------------------------

  const state: MemFSState = {
    stores,
    gitInstances,
    config,
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
        output.system.splice(1, 0, memfsBlock)
      } catch {
        // If scanning fails, don't crash the conversation
        // The agent can still use tools to access memory
      }
    },
  }

  return hooks
}
