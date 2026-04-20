/**
 * Content hash of memory state for injection-cache invalidation (TASK-111).
 *
 * `hashMemoryState()` produces a deterministic SHA-256 over every input that
 * affects the rendered `<memfs>` block:
 *
 * - For each hot file:   scope, path, chars, limit, readonly, description, body
 * - For each cold entry: scope, path, chars, limit, description
 *
 * Cold file *contents* are excluded because they are not inlined in the render.
 * Timestamps, access counters, and any non-render input are excluded — if the
 * hash is stable between two renders, the bytes will be byte-identical.
 *
 * Hot files and tree entries are sorted by (scope, path) before hashing so the
 * input order does not affect the output.
 */

import { createHash } from "crypto"

import type { MemoryFile, MemoryTreeEntry } from "./types"

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/** Separator used between fields in the canonical hash input. */
const FIELD_SEP = "\x1f" // ASCII Unit Separator — unlikely to appear in content
/** Separator used between records in the canonical hash input. */
const RECORD_SEP = "\x1e" // ASCII Record Separator

/**
 * Compute a deterministic SHA-256 hex digest of the current memory state that
 * affects the rendered `<memfs>` block.
 *
 * @param hotFiles    - All hot files (their bodies are inlined in the render).
 * @param treeEntries - All tree entries (both hot and cold — bodies of cold
 *                      files are excluded, but their path/desc/chars/limit are
 *                      in the tree listing and therefore part of the render).
 * @returns           - Hex-encoded SHA-256 hash.
 */
export function hashMemoryState(
  hotFiles: MemoryFile[],
  treeEntries: MemoryTreeEntry[],
): string {
  const hash = createHash("sha256")

  // ---- Hot files (contents inlined in render) -----------------------------
  const sortedHot = [...hotFiles].sort((a, b) => {
    const byScope = a.scope.localeCompare(b.scope)
    if (byScope !== 0) return byScope
    return a.path.localeCompare(b.path)
  })

  hash.update("HOT" + RECORD_SEP)
  for (const f of sortedHot) {
    const parts = [
      f.scope,
      f.path,
      String(f.chars),
      String(f.frontmatter.limit),
      String(f.frontmatter.readonly),
      f.frontmatter.description,
      f.content,
    ]
    hash.update(parts.join(FIELD_SEP))
    hash.update(RECORD_SEP)
  }

  // ---- Tree entries (path + meta only — no cold content) ------------------
  const sortedTree = [...treeEntries].sort((a, b) => {
    const byScope = a.scope.localeCompare(b.scope)
    if (byScope !== 0) return byScope
    return a.path.localeCompare(b.path)
  })

  hash.update("TREE" + RECORD_SEP)
  for (const e of sortedTree) {
    const parts = [
      e.scope,
      e.path,
      String(e.chars),
      String(e.limit),
      e.description,
    ]
    hash.update(parts.join(FIELD_SEP))
    hash.update(RECORD_SEP)
  }

  return hash.digest("hex")
}
