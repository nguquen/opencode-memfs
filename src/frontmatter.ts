/**
 * YAML frontmatter parsing, serialization, and atomic file writes.
 *
 * Handles the description/limit/readonly contract.
 * Auto-generates defaults for omitted fields.
 * Uses tmp+rename for atomic writes to prevent corruption.
 */

import { readFile, writeFile, rename, mkdir } from "fs/promises"
import path from "path"
import { randomUUID } from "crypto"

import yaml from "js-yaml"

import type { MemoryFrontmatter, MemoryFile, MemoryScope } from "./types"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Regex matching the YAML frontmatter block (--- delimited). */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/** Default character limit for new files. */
const DEFAULT_LIMIT = 5000

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Generate a human-readable description from a file path.
 *
 * Strips directory prefix and extension, replaces hyphens/underscores
 * with spaces, then capitalizes the first letter.
 *
 * @example
 *   humanizeFilename("system/persona.md") => "Persona"
 *   humanizeFilename("reference/debugging-patterns.md") => "Debugging patterns"
 */
export function humanizeFilename(filePath: string): string {
  const ext = path.extname(filePath)
  let base = path.basename(filePath, ext)
  // path.basename treats ".md" as a dotfile (no ext), not an extension
  if (base.startsWith(".") && ext === "") {
    base = base.slice(1)
  }
  const spaced = base.replace(/[-_]+/g, " ").trim()
  if (spaced.length === 0) return "Untitled"
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * Build a complete `MemoryFrontmatter` object, filling in defaults
 * for any fields not provided.
 *
 * @param filePath - Relative path within the memory directory (used to derive description).
 * @param partial  - Partial frontmatter fields from the user or parsed YAML.
 * @param defaultLimit - Default limit override (from config). Falls back to 5000.
 */
export function defaultFrontmatter(
  filePath: string,
  partial: Partial<MemoryFrontmatter> = {},
  defaultLimit: number = DEFAULT_LIMIT,
): MemoryFrontmatter {
  return {
    canOverrideDescription: partial.canOverrideDescription ?? true,
    description: partial.description ?? humanizeFilename(filePath),
    limit: partial.limit ?? defaultLimit,
    readonly: partial.readonly ?? false,
  }
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/**
 * Result of parsing a raw markdown string into frontmatter + body.
 */
export interface ParseResult {
  /** Parsed frontmatter (with defaults applied for missing fields). */
  frontmatter: MemoryFrontmatter
  /** Markdown body content (everything after the frontmatter block). */
  body: string
}

/**
 * Parse YAML frontmatter from a raw markdown string.
 *
 * If no frontmatter block is found, defaults are generated from the filename.
 * Missing individual fields within existing frontmatter are also defaulted.
 *
 * @param raw      - Raw file content.
 * @param filePath - Relative path (for default generation).
 * @param defaultLimit - Default limit override.
 */
export function parseFrontmatter(
  raw: string,
  filePath: string,
  defaultLimit: number = DEFAULT_LIMIT,
): ParseResult {
  const match = raw.match(FRONTMATTER_RE)

  if (!match) {
    return {
      frontmatter: defaultFrontmatter(filePath, {}, defaultLimit),
      body: raw.trim(),
    }
  }

  const yamlStr = match[1]
  let parsed: Record<string, unknown> = {}

  try {
    const result = yaml.load(yamlStr)
    if (result && typeof result === "object" && !Array.isArray(result)) {
      parsed = result as Record<string, unknown>
    }
  } catch {
    // Invalid YAML — fall through with empty parsed
  }

  const partial: Partial<MemoryFrontmatter> = {}

  if (typeof parsed.description === "string") {
    partial.description = parsed.description
  }
  if (typeof parsed.limit === "number" && Number.isFinite(parsed.limit)) {
    partial.limit = parsed.limit
  }
  if (typeof parsed.readonly === "boolean") {
    partial.readonly = parsed.readonly
  }
  if (typeof parsed.canOverrideDescription === "boolean") {
    partial.canOverrideDescription = parsed.canOverrideDescription
  }

  const body = raw.slice(match[0].length).trim()

  return {
    frontmatter: defaultFrontmatter(filePath, partial, defaultLimit),
    body,
  }
}

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

/**
 * Serialize frontmatter and body back into a markdown string.
 *
 * YAML keys are sorted alphabetically for deterministic diffs.
 * The body is separated from frontmatter by a blank line.
 *
 * @param frontmatter - The frontmatter to serialize.
 * @param body        - The markdown body content.
 */
export function serializeFrontmatter(
  frontmatter: MemoryFrontmatter,
  body: string,
): string {
  // Sort keys alphabetically for deterministic output
  const sorted: Record<string, unknown> = {}
  const keys = Object.keys(frontmatter).sort()
  for (const key of keys) {
    sorted[key] = frontmatter[key as keyof MemoryFrontmatter]
  }

  const yamlStr = yaml.dump(sorted, {
    lineWidth: -1,    // No line wrapping
    quotingType: '"', // Use double quotes
    forceQuotes: false,
  }).trimEnd()

  const trimmedBody = body.trim()
  if (trimmedBody.length === 0) {
    return `---\n${yamlStr}\n---\n`
  }
  return `---\n${yamlStr}\n---\n\n${trimmedBody}\n`
}

// ---------------------------------------------------------------------------
// Atomic Write
// ---------------------------------------------------------------------------

/**
 * Atomically write content to a file using tmp+rename.
 *
 * Writes to a temporary file in the same directory, then renames it
 * to the target path. This prevents corruption from partial writes.
 *
 * Parent directories are created if they don't exist.
 *
 * @param filePath - Absolute path to the target file.
 * @param content  - Full file content to write.
 */
export async function atomicWrite(
  filePath: string,
  content: string,
): Promise<void> {
  const dir = path.dirname(filePath)
  await mkdir(dir, { recursive: true })

  const tmpPath = path.join(dir, `.tmp-${randomUUID()}`)

  try {
    await writeFile(tmpPath, content, "utf-8")
    await rename(tmpPath, filePath)
  } catch (err) {
    // Clean up temp file on failure (best-effort)
    try {
      const { unlink } = await import("fs/promises")
      await unlink(tmpPath)
    } catch {
      // Ignore cleanup errors
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// High-Level: Write Memory File
// ---------------------------------------------------------------------------

/**
 * Write a memory file with frontmatter to disk atomically.
 *
 * Serializes the frontmatter and body, then performs an atomic write.
 *
 * @param filePath    - Absolute path to the target file.
 * @param frontmatter - Frontmatter to write.
 * @param body        - Markdown body content.
 */
export async function writeMemoryFile(
  filePath: string,
  frontmatter: MemoryFrontmatter,
  body: string,
): Promise<void> {
  const content = serializeFrontmatter(frontmatter, body)
  await atomicWrite(filePath, content)
}

// ---------------------------------------------------------------------------
// High-Level: Parse Memory File
// ---------------------------------------------------------------------------

/**
 * Read and parse a memory file from disk into a `MemoryFile`.
 *
 * @param absPath      - Absolute path to the file on disk.
 * @param relativePath - Relative path within the memory directory (e.g. "system/persona.md").
 * @param scope        - Which scope this file belongs to.
 * @param defaultLimit - Default limit override.
 */
export async function parseMemoryFile(
  absPath: string,
  relativePath: string,
  scope: MemoryScope,
  defaultLimit: number = DEFAULT_LIMIT,
): Promise<MemoryFile> {
  const raw = await readFile(absPath, "utf-8")
  const { frontmatter, body } = parseFrontmatter(raw, relativePath, defaultLimit)

  return {
    path: relativePath,
    frontmatter,
    content: body,
    chars: body.length,
    scope,
  }
}
