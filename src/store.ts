/**
 * Memory filesystem operations.
 *
 * Scan directories, read files with frontmatter, list tree with
 * descriptions and char counts. Supports both project and global scopes.
 */

import { readdir, stat } from "fs/promises"
import path from "path"

import type { MemoryFile, MemoryScope, MemoryScopeFilter, MemoryStorePaths, MemoryTreeEntry } from "./types"
import { parseMemoryFile } from "./frontmatter"

// ---------------------------------------------------------------------------
// Directory Scanning
// ---------------------------------------------------------------------------

/**
 * Recursively scan a directory for `.md` files.
 *
 * Returns relative paths (relative to `root`) sorted alphabetically.
 * Skips `.git/`, hidden directories, and non-`.md` files.
 * Respects `maxDepth` to avoid traversing too deep.
 *
 * @param root     - Absolute path to the memory root directory.
 * @param maxDepth - Maximum directory depth to scan. Default: 3.
 * @returns Array of relative paths (e.g. "system/persona.md").
 */
export async function scanDir(
  root: string,
  maxDepth: number = 3,
): Promise<string[]> {
  const results: string[] = []
  await scanRecursive(root, root, 0, maxDepth, results)
  return results.sort()
}

/** Internal recursive scanner. */
async function scanRecursive(
  root: string,
  dir: string,
  depth: number,
  maxDepth: number,
  results: string[],
): Promise<void> {
  if (depth > maxDepth) return

  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return // Directory doesn't exist or isn't readable
  }

  for (const entry of entries) {
    // Skip hidden files/directories and .git
    if (entry.startsWith(".")) continue

    const absPath = path.join(dir, entry)

    let stats
    try {
      stats = await stat(absPath)
    } catch {
      continue // File disappeared or isn't accessible
    }

    if (stats.isDirectory()) {
      await scanRecursive(root, absPath, depth + 1, maxDepth, results)
    } else if (stats.isFile() && entry.endsWith(".md")) {
      const relPath = path.relative(root, absPath)
      results.push(relPath)
    }
  }
}

// ---------------------------------------------------------------------------
// Store Scanning
// ---------------------------------------------------------------------------

/**
 * Scan a memory store and return all parsed memory files.
 *
 * @param store        - The memory store paths (root + scope).
 * @param defaultLimit - Default character limit for files without explicit limit.
 * @param maxDepth     - Maximum directory depth to scan.
 * @returns Array of parsed `MemoryFile` objects.
 */
export async function scanStore(
  store: MemoryStorePaths,
  defaultLimit: number = 5000,
  maxDepth: number = 3,
): Promise<MemoryFile[]> {
  const relativePaths = await scanDir(store.root, maxDepth)
  const files: MemoryFile[] = []

  for (const relPath of relativePaths) {
    try {
      const absPath = path.join(store.root, relPath)
      const file = await parseMemoryFile(absPath, relPath, store.scope, defaultLimit)
      files.push(file)
    } catch {
      // Skip files that fail to parse — don't crash the scan
    }
  }

  return files
}

// ---------------------------------------------------------------------------
// Multi-Store Scanning
// ---------------------------------------------------------------------------

/**
 * Scan multiple memory stores and return all files, optionally filtered by scope.
 *
 * @param stores       - Array of memory stores to scan.
 * @param scopeFilter  - Filter by scope ("project", "global", or "all").
 * @param defaultLimit - Default character limit.
 * @param maxDepth     - Maximum directory depth.
 * @returns Array of parsed `MemoryFile` objects across all matching stores.
 */
export async function scanAllStores(
  stores: MemoryStorePaths[],
  scopeFilter: MemoryScopeFilter = "all",
  defaultLimit: number = 5000,
  maxDepth: number = 3,
): Promise<MemoryFile[]> {
  const filtered = scopeFilter === "all"
    ? stores
    : stores.filter((s) => s.scope === scopeFilter)

  const results = await Promise.all(
    filtered.map((store) => scanStore(store, defaultLimit, maxDepth))
  )

  return results.flat()
}

// ---------------------------------------------------------------------------
// Tree Building
// ---------------------------------------------------------------------------

/**
 * Build a tree listing from parsed memory files.
 *
 * Returns `MemoryTreeEntry` objects with path, description, char count,
 * limit, and scope — suitable for rendering in the system prompt.
 *
 * @param files - Array of parsed memory files.
 * @returns Array of tree entries sorted by path.
 */
export function buildTree(files: MemoryFile[]): MemoryTreeEntry[] {
  return files
    .map((file) => ({
      path: file.path,
      description: file.frontmatter.description,
      chars: file.chars,
      limit: file.frontmatter.limit,
      scope: file.scope,
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a relative path is in the hot directory.
 *
 * @param relPath - Relative path (e.g. "system/persona.md").
 * @param hotDir  - Name of the hot directory (default: "system").
 * @returns `true` if the file is in the hot tier.
 */
export function isHot(relPath: string, hotDir: string = "system"): boolean {
  return relPath.startsWith(hotDir + "/") || relPath === hotDir
}

/**
 * Partition files into hot and cold lists.
 *
 * @param files  - All parsed memory files.
 * @param hotDir - Name of the hot directory.
 * @returns Object with `hot` and `cold` arrays.
 */
export function partitionFiles(
  files: MemoryFile[],
  hotDir: string = "system",
): { hot: MemoryFile[]; cold: MemoryFile[] } {
  const hot: MemoryFile[] = []
  const cold: MemoryFile[] = []

  for (const file of files) {
    if (isHot(file.path, hotDir)) {
      hot.push(file)
    } else {
      cold.push(file)
    }
  }

  return { hot, cold }
}
