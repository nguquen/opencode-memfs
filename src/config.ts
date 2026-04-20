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

import { parseCacheTtl } from "./cacheTtl"
import type { MemFSConfig } from "./types"

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Zod schema for the plugin configuration file.
 *
 * Cache-related fields accept user-friendly shapes (`cacheTtl: "5m"`) and are
 * normalized into their runtime equivalents (`cacheTtlMs: number`) by the
 * schema's `.transform()` step. The parsed output therefore already matches
 * the `MemFSConfig` runtime shape.
 */
export const MemFSConfigSchema = z
  .object({
    /** Directory name for hot (pinned) files. Default: "system". */
    hotDir: z.string().default("system"),

    /** Default character limit for new files. Default: 5000. */
    defaultLimit: z.number().int().positive().default(5000),

    /** Debounce delay (ms) before auto-committing changes. Default: 2000. */
    autoCommitDebounceMs: z.number().int().nonnegative().default(2000),

    /** Maximum directory depth shown in tree listing. Default: 3. */
    maxTreeDepth: z.number().int().positive().default(3),

    /**
     * Injection-cache TTL (`"5m"`, `"30s"`, `"1h"`, `"500ms"`, or raw ms number).
     * Default: `"5m"` — matches Anthropic's default prompt-cache window.
     */
    cacheTtl: z.union([z.string(), z.number()]).default("5m"),

    /**
     * Context-usage percentage (0-100) at which pressure forces a refresh of
     * the `<memfs>` block regardless of TTL. Default: 65.
     */
    refreshThresholdPercentage: z.number().min(0).max(100).default(65),

    /**
     * When true, `memory_promote` and `memory_demote` force-bust the injection
     * cache on their next transform pass. Default: true.
     */
    refreshOnPromoteDemote: z.boolean().default(true),
  })
  .transform((raw, ctx): MemFSConfig => {
    let cacheTtlMs: number
    try {
      cacheTtlMs = parseCacheTtl(raw.cacheTtl)
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cacheTtl"],
        message: (err as Error).message,
      })
      return z.NEVER as never
    }

    return {
      hotDir: raw.hotDir,
      defaultLimit: raw.defaultLimit,
      autoCommitDebounceMs: raw.autoCommitDebounceMs,
      maxTreeDepth: raw.maxTreeDepth,
      cacheTtlMs,
      refreshThresholdPercentage: raw.refreshThresholdPercentage,
      refreshOnPromoteDemote: raw.refreshOnPromoteDemote,
    }
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
  cacheTtlMs: 5 * 60 * 1000,
  refreshThresholdPercentage: 65,
  refreshOnPromoteDemote: true,
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
