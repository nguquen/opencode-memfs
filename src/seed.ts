/**
 * Default directory structure and starter files for first run.
 *
 * Seeds are split by scope:
 * - Global: persona.md, human.md, projects.md + reference/
 * - Project: project.md, handoff.md + reference/, archive/
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
  {
    path: "system/handoff.md",
    description: [
      "Session continuity — record what you're working on so the next session can pick up where you left off",
      "Update when: beginning work that involves multiple steps — capture the goal, plan, and relevant files",
      "Update when: completing a step or making progress — update what's done and what remains",
      "Update when: key decisions or discoveries are made — preserve context that would be lost between sessions",
      "Update when: work is finished — clear or summarize the outcome",
    ].join("\n"),
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
 * - Project: project.md, handoff.md in system/ + empty reference/, archive/
 *
 * On first run (no .md files), creates all seed files and directories.
 * On subsequent runs, backfills any missing seed files without touching existing ones.
 *
 * @param memoryRoot - Absolute path to the store root directory.
 * @param config     - Plugin configuration (for hotDir, defaultLimit).
 * @param scope      - Which scope this store represents.
 * @returns `true` if any files were created, `false` if everything already existed.
 */
export async function ensureSeed(
  memoryRoot: string,
  config: MemFSConfig,
  scope: MemoryScope = "project",
): Promise<boolean> {
  // Select seed definitions based on scope
  const seedFiles = scope === "global" ? GLOBAL_SEED_FILES : PROJECT_SEED_FILES
  const seedDirs = scope === "global" ? GLOBAL_SEED_DIRS : PROJECT_SEED_DIRS

  // Ensure system/ directory exists
  const systemDir = path.join(memoryRoot, config.hotDir)
  await mkdir(systemDir, { recursive: true })

  // Ensure empty directories with .gitkeep
  for (const dir of seedDirs) {
    const dirPath = path.join(memoryRoot, dir)
    await mkdir(dirPath, { recursive: true })

    const gitkeepPath = path.join(dirPath, ".gitkeep")
    try {
      await access(gitkeepPath)
    } catch {
      await writeFile(gitkeepPath, "", "utf-8")
    }
  }

  // Create seed files — skip any that already exist
  let created = false
  for (const seed of seedFiles) {
    const filePath = path.join(memoryRoot, seed.path)

    try {
      await access(filePath)
      continue // File exists, don't overwrite
    } catch {
      // File doesn't exist, create it
    }

    const fm = defaultFrontmatter(seed.path, {
      description: seed.description,
      limit: config.defaultLimit,
      readonly: seed.readonly,
    })
    const serialized = serializeFrontmatter(fm, seed.content ?? "")
    await writeFile(filePath, serialized, "utf-8")
    created = true
  }

  return created
}
