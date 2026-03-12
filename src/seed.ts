/**
 * Default directory structure and starter files for first run.
 *
 * Seeds are split by scope:
 * - Global: persona.md, human.md, projects.md + reference/
 * - Project: project.md + reference/, archive/
 *
 * Only seeds if the memory directory is empty (no .md files).
 */

import { mkdir, writeFile, access } from "fs/promises"
import path from "path"

import type { MemFSConfig, MemoryScope } from "./types"
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
  /** Whether the file should be readonly. */
  readonly?: boolean
  /** Optional body content for first-run hints. */
  content?: string
}

/** Starter files for the global store. */
const GLOBAL_SEED_FILES: SeedFile[] = [
  {
    path: "system/persona.md",
    description: [
      "Agent identity, behavior guidelines, communication style",
      `Update when: user names you or customizes your identity ("call yourself...", "you are...")`,
      `Update when: user tells you how to behave ("be more concise", "ask before doing X")`,
      "Update when: you learn what tone, verbosity, or proactivity level works for this user",
    ].join("\n"),
  },
  {
    path: "system/human.md",
    description: [
      "User preferences, habits, constraints, working style",
      `Update when: user states a preference or constraint ("I prefer...", "don't...", "always...")`,
      "Update when: user corrects you — record what they wanted instead",
      "Update when: you observe a pattern across interactions (e.g., consistently asks for concise answers)",
    ].join("\n"),
  },
  {
    path: "system/projects.md",
    description: "Registry of all known projects with their paths",
    readonly: true,
  },
]

/** Discovery hint for new projects — self-erasing once the agent populates the file. */
const PROJECT_DISCOVERY_HINT =
  "(New project — explore the project and replace this: check README, directory structure, config files, and key artifacts. If the directory is empty, leave as-is — memory fills in as the project takes shape.)"

/** Starter files for project stores. */
const PROJECT_SEED_FILES: SeedFile[] = [
  {
    path: "system/project.md",
    description: [
      "Key context, decisions, current state, conventions — scannable cheat sheet",
      "Update when: you learn what the project is about, its purpose, or current state",
      "Update when: key decisions or conventions are established",
      "Update when: you discover build commands, architecture, or important paths",
      "Not limited to code — research topics, document structures, and workflows count",
    ].join("\n"),
    content: PROJECT_DISCOVERY_HINT,
  },
]

/** Empty directories for the global store. */
const GLOBAL_SEED_DIRS = ["reference"]

/** Empty directories for project stores. */
const PROJECT_SEED_DIRS = ["reference", "archive"]

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/**
 * Seed a memory directory with the default structure.
 *
 * Seeds are split by scope:
 * - Global: persona.md, human.md, projects.md in system/ + empty reference/
 * - Project: project.md in system/ + empty reference/, archive/
 *
 * Only seeds if no .md files exist in the directory yet.
 *
 * @param memoryRoot - Absolute path to the store root directory.
 * @param config     - Plugin configuration (for hotDir, defaultLimit).
 * @param scope      - Which scope this store represents.
 * @returns `true` if seeding was performed, `false` if skipped.
 */
export async function ensureSeed(
  memoryRoot: string,
  config: MemFSConfig,
  scope: MemoryScope = "project",
): Promise<boolean> {
  // Check if the directory already has memory files
  const existing = await scanDir(memoryRoot)
  if (existing.length > 0) {
    return false
  }

  // Select seed definitions based on scope
  const seedFiles = scope === "global" ? GLOBAL_SEED_FILES : PROJECT_SEED_FILES
  const seedDirs = scope === "global" ? GLOBAL_SEED_DIRS : PROJECT_SEED_DIRS

  // Create system/ directory and seed files
  const systemDir = path.join(memoryRoot, config.hotDir)
  await mkdir(systemDir, { recursive: true })

  for (const seed of seedFiles) {
    const filePath = path.join(memoryRoot, seed.path)
    const fm = defaultFrontmatter(seed.path, {
      description: seed.description,
      limit: config.defaultLimit,
      readonly: seed.readonly,
    })
    const serialized = serializeFrontmatter(fm, seed.content ?? "")
    await writeFile(filePath, serialized, "utf-8")
  }

  // Create empty directories with .gitkeep
  for (const dir of seedDirs) {
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
