/**
 * Default directory structure and starter files for first run.
 *
 * Creates system/, reference/, archive/ directories with
 * default persona.md, human.md, project.md starter files.
 * Only seeds if the memory directory is empty (no .md files).
 */

import { mkdir, writeFile, access } from "fs/promises"
import path from "path"

import type { MemFSConfig } from "./types"
import { serializeFrontmatter, defaultFrontmatter } from "./frontmatter"
import { scanDir } from "./store"

// ---------------------------------------------------------------------------
// Seed Definitions
// ---------------------------------------------------------------------------

/** A starter file definition. */
interface SeedFile {
  /** Relative path within the memory directory. */
  path: string
  /** Description for frontmatter. */
  description: string
}

/** Default starter files in system/. */
const SEED_FILES: SeedFile[] = [
  {
    path: "system/persona.md",
    description: "Agent identity, behavior guidelines, communication style",
  },
  {
    path: "system/human.md",
    description: "User preferences, habits, constraints, working style",
  },
  {
    path: "system/project.md",
    description: "Build commands, architecture, conventions, gotchas",
  },
]

/** Empty directories to create with .gitkeep files. */
const SEED_DIRS = ["reference", "archive"]

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/**
 * Seed a memory directory with the default structure.
 *
 * Creates system/ with persona.md, human.md, project.md,
 * and empty reference/ + archive/ directories with .gitkeep.
 *
 * Only seeds if no .md files exist in the directory yet.
 *
 * @param memoryRoot - Absolute path to the memory root directory.
 * @param config     - Plugin configuration (for defaultLimit).
 * @returns `true` if seeding was performed, `false` if skipped.
 */
export async function ensureSeed(
  memoryRoot: string,
  config: MemFSConfig,
): Promise<boolean> {
  // Check if the directory already has memory files
  const existing = await scanDir(memoryRoot)
  if (existing.length > 0) {
    return false
  }

  // Create system/ directory and seed files
  const systemDir = path.join(memoryRoot, config.hotDir)
  await mkdir(systemDir, { recursive: true })

  for (const seed of SEED_FILES) {
    const filePath = path.join(memoryRoot, seed.path)
    const fm = defaultFrontmatter(seed.path, {
      description: seed.description,
      limit: config.defaultLimit,
    })
    const content = serializeFrontmatter(fm, "")
    await writeFile(filePath, content, "utf-8")
  }

  // Create empty reference/ and archive/ with .gitkeep
  for (const dir of SEED_DIRS) {
    const dirPath = path.join(memoryRoot, dir)
    await mkdir(dirPath, { recursive: true })

    const gitkeepPath = path.join(dirPath, ".gitkeep")
    // Only create .gitkeep if it doesn't exist
    try {
      await access(gitkeepPath)
    } catch {
      await writeFile(gitkeepPath, "", "utf-8")
    }
  }

  return true
}
