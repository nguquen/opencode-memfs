/**
 * Unit tests for hash.ts — deterministic SHA-256 over memory state (TASK-111).
 */

import { describe, it, expect } from "vitest"

import { hashMemoryState } from "../hash"
import type { MemoryFile, MemoryTreeEntry } from "../types"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function hotFile(overrides: Partial<MemoryFile> = {}): MemoryFile {
  return {
    path: "system/persona.md",
    scope: "global",
    content: "You are Botbeech.",
    chars: 17,
    frontmatter: {
      canOverrideDescription: true,
      description: "Agent identity",
      limit: 5000,
      readonly: false,
    },
    ...overrides,
  }
}

function treeEntry(overrides: Partial<MemoryTreeEntry> = {}): MemoryTreeEntry {
  return {
    path: "system/persona.md",
    scope: "global",
    description: "Agent identity",
    chars: 17,
    limit: 5000,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("hashMemoryState", () => {
  it("produces a stable hex SHA-256 (64 chars)", () => {
    const h = hashMemoryState([hotFile()], [treeEntry()])
    expect(h).toMatch(/^[a-f0-9]{64}$/)
  })

  it("returns identical hashes for identical state", () => {
    const h1 = hashMemoryState([hotFile()], [treeEntry()])
    const h2 = hashMemoryState([hotFile()], [treeEntry()])
    expect(h1).toBe(h2)
  })

  it("is invariant to input order (hot files)", () => {
    const a = hotFile({ path: "system/a.md", content: "aaa" })
    const b = hotFile({ path: "system/b.md", content: "bbb" })

    const h1 = hashMemoryState([a, b], [])
    const h2 = hashMemoryState([b, a], [])
    expect(h1).toBe(h2)
  })

  it("is invariant to input order (tree entries)", () => {
    const a = treeEntry({ path: "reference/a.md" })
    const b = treeEntry({ path: "reference/b.md" })

    const h1 = hashMemoryState([], [a, b])
    const h2 = hashMemoryState([], [b, a])
    expect(h1).toBe(h2)
  })

  it("changes when hot file content changes", () => {
    const h1 = hashMemoryState([hotFile({ content: "old" })], [])
    const h2 = hashMemoryState([hotFile({ content: "new" })], [])
    expect(h1).not.toBe(h2)
  })

  it("changes when hot file description changes", () => {
    const h1 = hashMemoryState(
      [hotFile({ frontmatter: { canOverrideDescription: true, description: "old", limit: 5000, readonly: false } })],
      [],
    )
    const h2 = hashMemoryState(
      [hotFile({ frontmatter: { canOverrideDescription: true, description: "new", limit: 5000, readonly: false } })],
      [],
    )
    expect(h1).not.toBe(h2)
  })

  it("changes when hot file readonly flips", () => {
    const h1 = hashMemoryState(
      [hotFile({ frontmatter: { canOverrideDescription: true, description: "d", limit: 5000, readonly: false } })],
      [],
    )
    const h2 = hashMemoryState(
      [hotFile({ frontmatter: { canOverrideDescription: true, description: "d", limit: 5000, readonly: true } })],
      [],
    )
    expect(h1).not.toBe(h2)
  })

  it("changes when a cold tree entry's description changes", () => {
    const h1 = hashMemoryState([], [treeEntry({ path: "reference/x.md", description: "old" })])
    const h2 = hashMemoryState([], [treeEntry({ path: "reference/x.md", description: "new" })])
    expect(h1).not.toBe(h2)
  })

  it("changes when a cold tree entry's char count changes", () => {
    const h1 = hashMemoryState([], [treeEntry({ path: "reference/x.md", chars: 100 })])
    const h2 = hashMemoryState([], [treeEntry({ path: "reference/x.md", chars: 200 })])
    expect(h1).not.toBe(h2)
  })

  it("distinguishes same path in different scopes", () => {
    const g = treeEntry({ scope: "global", path: "system/persona.md" })
    const p = treeEntry({ scope: "project", path: "system/persona.md" })

    const h1 = hashMemoryState([], [g])
    const h2 = hashMemoryState([], [p])
    expect(h1).not.toBe(h2)
  })

  it("empty state produces a consistent hash", () => {
    const h1 = hashMemoryState([], [])
    const h2 = hashMemoryState([], [])
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[a-f0-9]{64}$/)
  })
})
