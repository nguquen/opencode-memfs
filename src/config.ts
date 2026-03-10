/**
 * Configuration schema and loading for opencode-memfs.
 *
 * Reads from ~/.config/opencode/memfs.json with Zod validation.
 * All fields have sensible defaults — the config file is optional.
 */

import { readFile } from "fs/promises"
import { homedir } from "os"
import path from "path"

import { z } from "zod"

import type { MemFSConfig } from "./types"

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** Zod schema for the plugin configuration file. */
export const MemFSConfigSchema = z.object({
  /** Directory name for hot (pinned) files. Default: "system". */
  hotDir: z.string().default("system"),

  /** Default character limit for new files. Default: 5000. */
  defaultLimit: z.number().int().positive().default(5000),

  /** Debounce delay (ms) before auto-committing changes. Default: 2000. */
  autoCommitDebounceMs: z.number().int().nonnegative().default(2000),

  /** Maximum directory depth shown in tree listing. Default: 3. */
  maxTreeDepth: z.number().int().positive().default(3),

  /** Whether to enable global memory (~/.config/opencode/memory/). Default: true. */
  globalMemoryEnabled: z.boolean().default(true),
})

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default configuration values (matches schema defaults). */
export const DEFAULT_CONFIG: MemFSConfig = {
  hotDir: "system",
  defaultLimit: 5000,
  autoCommitDebounceMs: 2000,
  maxTreeDepth: 3,
  globalMemoryEnabled: true,
}

// ---------------------------------------------------------------------------
// Config Path
// ---------------------------------------------------------------------------

/** Resolve the config file path: ~/.config/opencode/memfs.json */
export function configPath(): string {
  return path.join(homedir(), ".config", "opencode", "memfs.json")
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load and validate plugin configuration.
 *
 * Reads from `~/.config/opencode/memfs.json`. If the file doesn't exist,
 * returns all defaults. If the file exists but contains invalid JSON or
 * fails validation, throws a descriptive error.
 *
 * @returns Validated and defaulted `MemFSConfig`.
 */
export async function loadConfig(): Promise<MemFSConfig> {
  const filePath = configPath()

  let raw: string
  try {
    raw = await readFile(filePath, "utf-8")
  } catch (err: unknown) {
    // File doesn't exist — return all defaults
    if (isNodeError(err) && err.code === "ENOENT") {
      return { ...DEFAULT_CONFIG }
    }
    throw new Error(`Failed to read config file at ${filePath}: ${String(err)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(
      `Invalid JSON in config file at ${filePath}. ` +
      `Fix the syntax or delete the file to use defaults.`
    )
  }

  const result = MemFSConfigSchema.safeParse(parsed)

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n")
    throw new Error(
      `Invalid config in ${filePath}:\n${issues}\n` +
      `Fix the values or delete the file to use defaults.`
    )
  }

  return result.data
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Type guard for Node.js errors with a `code` property. */
function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err
}
