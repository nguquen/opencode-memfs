/**
 * Unit tests for prompt.ts — system prompt XML block rendering.
 */

import { describe, it, expect } from "vitest"

import {
  renderTree,
  renderInstructions,
  renderHotFiles,
  renderMemFS,
} from "../prompt"
import type { MemoryFile, MemoryTreeEntry } from "../types"

// ---------------------------------------------------------------------------
// renderTree
// ---------------------------------------------------------------------------

describe("renderTree", () => {
  it("should render empty tree message", () => {
    const result = renderTree([])
    expect(result).toBe("<tree>\n(no memory files yet)\n</tree>")
  })

  it("should render single entry with scope", () => {
    const entries: MemoryTreeEntry[] = [
      { path: "system/persona.md", description: "Persona", chars: 100, limit: 5000, scope: "project" },
    ]
    const result = renderTree(entries)
    expect(result).toContain("system/persona.md (100/5000) — Persona")
    expect(result).toContain('<tree scope="project">')
    expect(result.endsWith("</tree>")).toBe(true)
  })

  it("should render multiple entries in same scope", () => {
    const entries: MemoryTreeEntry[] = [
      { path: "system/persona.md", description: "Persona", chars: 100, limit: 5000, scope: "project" },
      { path: "reference/api.md", description: "API patterns", chars: 890, limit: 5000, scope: "project" },
    ]
    const result = renderTree(entries)
    const lines = result.split("\n")
    // <tree scope="project"> + 2 entries + </tree>
    expect(lines.length).toBe(4)
    expect(result).toContain('<tree scope="project">')
  })

  it("should render separate tree blocks for different scopes", () => {
    const entries: MemoryTreeEntry[] = [
      { path: "system/persona.md", description: "Persona", chars: 100, limit: 5000, scope: "project" },
      { path: "system/human.md", description: "Human prefs", chars: 200, limit: 5000, scope: "global" },
    ]
    const result = renderTree(entries)
    expect(result).toContain('<tree scope="global">')
    expect(result).toContain('<tree scope="project">')
    // Global block comes first
    const globalIdx = result.indexOf('<tree scope="global">')
    const projectIdx = result.indexOf('<tree scope="project">')
    expect(globalIdx).toBeLessThan(projectIdx)
  })
})

// ---------------------------------------------------------------------------
// renderInstructions
// ---------------------------------------------------------------------------

describe("renderInstructions", () => {
  it("should return the static instructions block", () => {
    const result = renderInstructions()
    expect(result.startsWith("<instructions>")).toBe(true)
    expect(result.endsWith("</instructions>")).toBe(true)
  })

  it("should mention memory tools", () => {
    const result = renderInstructions()
    expect(result).toContain("memory_read")
    expect(result).toContain("memory_write")
    expect(result).toContain("memory_edit")
    expect(result).toContain("memory_delete")
    expect(result).toContain("memory_promote")
    expect(result).toContain("memory_demote")
    expect(result).toContain("memory_history")
    expect(result).toContain("memory_rollback")
  })

  it("should explain hot vs cold", () => {
    const result = renderInstructions()
    expect(result).toContain("system/")
    expect(result).toContain("pinned")
  })

  it("should explain scopes", () => {
    const result = renderInstructions()
    expect(result).toContain("project")
    expect(result).toContain("global")
    expect(result).toContain("scope")
  })
})

// ---------------------------------------------------------------------------
// renderHotFiles
// ---------------------------------------------------------------------------

describe("renderHotFiles", () => {
  it("should return empty string for no hot files", () => {
    expect(renderHotFiles([])).toBe("")
  })

  it("should render a file with content", () => {
    const files: MemoryFile[] = [
      {
        path: "system/persona.md",
        frontmatter: { description: "Persona", limit: 5000, readonly: false },
        content: "You are helpful.",
        chars: 16,
        scope: "project",
      },
    ]
    const result = renderHotFiles(files)
    expect(result).toContain('<system path="system/persona.md" chars="16" limit="5000" scope="project">')
    expect(result).toContain("You are helpful.")
    expect(result).toContain("</system>")
  })

  it("should render a file with empty body as (empty)", () => {
    const files: MemoryFile[] = [
      {
        path: "system/project.md",
        frontmatter: { description: "Project", limit: 5000, readonly: false },
        content: "",
        chars: 0,
        scope: "project",
      },
    ]
    const result = renderHotFiles(files)
    expect(result).toContain("(empty)")
  })

  it("should render multiple files separated by blank lines", () => {
    const files: MemoryFile[] = [
      {
        path: "system/a.md",
        frontmatter: { description: "A", limit: 5000, readonly: false },
        content: "aaa",
        chars: 3,
        scope: "project",
      },
      {
        path: "system/b.md",
        frontmatter: { description: "B", limit: 5000, readonly: false },
        content: "bbb",
        chars: 3,
        scope: "project",
      },
    ]
    const result = renderHotFiles(files)
    expect(result).toContain("</system>\n\n<system")
  })
})

// ---------------------------------------------------------------------------
// renderMemFS
// ---------------------------------------------------------------------------

describe("renderMemFS", () => {
  it("should wrap everything in <memfs> tags", () => {
    const result = renderMemFS([], [])
    expect(result.startsWith("<memfs>")).toBe(true)
    expect(result.endsWith("</memfs>")).toBe(true)
  })

  it("should include tree, instructions, and hot files", () => {
    const entries: MemoryTreeEntry[] = [
      { path: "system/persona.md", description: "Persona", chars: 16, limit: 5000, scope: "project" },
    ]
    const hotFiles: MemoryFile[] = [
      {
        path: "system/persona.md",
        frontmatter: { description: "Persona", limit: 5000, readonly: false },
        content: "You are helpful.",
        chars: 16,
        scope: "project",
      },
    ]
    const result = renderMemFS(entries, hotFiles)
    expect(result).toContain('<tree scope="project">')
    expect(result).toContain("<instructions>")
    expect(result).toContain("<system ")
    expect(result).toContain("You are helpful.")
  })

  it("should work with no hot files", () => {
    const entries: MemoryTreeEntry[] = [
      { path: "reference/notes.md", description: "Notes", chars: 50, limit: 5000, scope: "project" },
    ]
    const result = renderMemFS(entries, [])
    expect(result).toContain('<tree scope="project">')
    expect(result).toContain("<instructions>")
    expect(result).not.toContain("<system ")
  })
})
