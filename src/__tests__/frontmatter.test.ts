/**
 * Unit tests for frontmatter.ts — YAML parse/serialize + atomic writes.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { readFile } from "fs/promises"
import path from "path"

import {
  humanizeFilename,
  defaultFrontmatter,
  parseFrontmatter,
  serializeFrontmatter,
  atomicWrite,
  writeMemoryFile,
  parseMemoryFile,
} from "../frontmatter"
import {
  createTmpDir,
  cleanupTmpDir,
  writeTestFile,
  FIXTURE_FULL,
  FIXTURE_PARTIAL,
  FIXTURE_NO_FRONTMATTER,
  FIXTURE_READONLY,
  FIXTURE_EMPTY_BODY,
} from "./helpers"

// ---------------------------------------------------------------------------
// humanizeFilename
// ---------------------------------------------------------------------------

describe("humanizeFilename", () => {
  it("should strip directory and extension", () => {
    expect(humanizeFilename("system/persona.md")).toBe("Persona")
  })

  it("should replace hyphens with spaces", () => {
    expect(humanizeFilename("reference/debugging-patterns.md")).toBe("Debugging patterns")
  })

  it("should replace underscores with spaces", () => {
    expect(humanizeFilename("reference/api_conventions.md")).toBe("Api conventions")
  })

  it("should handle deeply nested paths", () => {
    expect(humanizeFilename("archive/2026/03/session-notes.md")).toBe("Session notes")
  })

  it("should handle filenames with no extension", () => {
    expect(humanizeFilename("README")).toBe("README")
  })

  it("should handle dotfile-like names", () => {
    // ".md" is treated as a dotfile by Node — basename is ".md", no ext
    // After stripping the leading dot, it becomes "Md"
    expect(humanizeFilename(".md")).toBe("Md")
  })

  it("should return 'Untitled' for truly empty names", () => {
    expect(humanizeFilename("")).toBe("Untitled")
  })
})

// ---------------------------------------------------------------------------
// defaultFrontmatter
// ---------------------------------------------------------------------------

describe("defaultFrontmatter", () => {
  it("should generate all defaults from filename", () => {
    const fm = defaultFrontmatter("system/persona.md")
    expect(fm.canOverrideDescription).toBe(true)
    expect(fm.description).toBe("Persona")
    expect(fm.limit).toBe(5000)
    expect(fm.readonly).toBe(false)
  })

  it("should respect partial overrides", () => {
    const fm = defaultFrontmatter("system/persona.md", {
      description: "Custom description",
      readonly: true,
    })
    expect(fm.description).toBe("Custom description")
    expect(fm.limit).toBe(5000)
    expect(fm.readonly).toBe(true)
  })

  it("should respect canOverrideDescription override", () => {
    const fm = defaultFrontmatter("system/persona.md", {
      canOverrideDescription: false,
    })
    expect(fm.canOverrideDescription).toBe(false)
  })

  it("should use custom defaultLimit", () => {
    const fm = defaultFrontmatter("test.md", {}, 10000)
    expect(fm.limit).toBe(10000)
  })

  it("should prefer explicit limit over defaultLimit", () => {
    const fm = defaultFrontmatter("test.md", { limit: 3000 }, 10000)
    expect(fm.limit).toBe(3000)
  })
})

// ---------------------------------------------------------------------------
// parseFrontmatter
// ---------------------------------------------------------------------------

describe("parseFrontmatter", () => {
  it("should parse full frontmatter", () => {
    const { frontmatter, body } = parseFrontmatter(FIXTURE_FULL, "system/persona.md")
    expect(frontmatter.description).toBe("Agent identity and behavior guidelines")
    expect(frontmatter.limit).toBe(5000)
    expect(frontmatter.readonly).toBe(false)
    expect(body).toBe("You are a helpful coding assistant.")
  })

  it("should fill defaults for missing fields", () => {
    const { frontmatter, body } = parseFrontmatter(FIXTURE_PARTIAL, "system/human.md")
    expect(frontmatter.description).toBe("User preferences")
    expect(frontmatter.limit).toBe(5000) // default
    expect(frontmatter.readonly).toBe(false) // default
    expect(body).toBe("The user prefers TypeScript.")
  })

  it("should handle no frontmatter at all", () => {
    const { frontmatter, body } = parseFrontmatter(
      FIXTURE_NO_FRONTMATTER,
      "reference/notes.md",
    )
    expect(frontmatter.description).toBe("Notes")
    expect(frontmatter.limit).toBe(5000)
    expect(frontmatter.readonly).toBe(false)
    expect(body).toBe("Just some plain content without any frontmatter.")
  })

  it("should handle invalid YAML gracefully", () => {
    const raw = "---\n: invalid: yaml: [[\n---\nSome content"
    const { frontmatter, body } = parseFrontmatter(raw, "test.md")
    // Falls back to defaults
    expect(frontmatter.description).toBe("Test")
    expect(body).toBe("Some content")
  })

  it("should parse readonly files", () => {
    const { frontmatter } = parseFrontmatter(FIXTURE_READONLY, "rules.md")
    expect(frontmatter.readonly).toBe(true)
    expect(frontmatter.limit).toBe(3000)
  })

  it("should handle empty body", () => {
    const { frontmatter, body } = parseFrontmatter(FIXTURE_EMPTY_BODY, "empty.md")
    expect(frontmatter.description).toBe("Empty file for testing")
    expect(body).toBe("")
  })

  it("should use custom defaultLimit", () => {
    const { frontmatter } = parseFrontmatter(FIXTURE_NO_FRONTMATTER, "test.md", 8000)
    expect(frontmatter.limit).toBe(8000)
  })

  it("should ignore non-object YAML", () => {
    const raw = "---\njust a string\n---\ncontent"
    const { frontmatter } = parseFrontmatter(raw, "test.md")
    expect(frontmatter.description).toBe("Test")
  })

  it("should ignore array YAML", () => {
    const raw = "---\n- item1\n- item2\n---\ncontent"
    const { frontmatter } = parseFrontmatter(raw, "test.md")
    expect(frontmatter.description).toBe("Test")
  })

  it("should ignore non-string description", () => {
    const raw = '---\ndescription: 42\nlimit: 5000\nreadonly: false\n---\ncontent'
    const { frontmatter } = parseFrontmatter(raw, "test.md")
    expect(frontmatter.description).toBe("Test") // falls back to filename
  })

  it("should ignore non-number limit", () => {
    const raw = '---\ndescription: "OK"\nlimit: "big"\nreadonly: false\n---\ncontent'
    const { frontmatter } = parseFrontmatter(raw, "test.md")
    expect(frontmatter.limit).toBe(5000) // falls back to default
  })

  it("should ignore non-boolean readonly", () => {
    const raw = '---\ndescription: "OK"\nlimit: 5000\nreadonly: "yes"\n---\ncontent'
    const { frontmatter } = parseFrontmatter(raw, "test.md")
    expect(frontmatter.readonly).toBe(false) // falls back to default
  })

  it("should parse canOverrideDescription when present", () => {
    const raw = '---\ncanOverrideDescription: false\ndescription: "Protected"\nlimit: 5000\nreadonly: false\n---\ncontent'
    const { frontmatter } = parseFrontmatter(raw, "test.md")
    expect(frontmatter.canOverrideDescription).toBe(false)
  })

  it("should default canOverrideDescription to true when absent", () => {
    const raw = '---\ndescription: "Normal"\nlimit: 5000\nreadonly: false\n---\ncontent'
    const { frontmatter } = parseFrontmatter(raw, "test.md")
    expect(frontmatter.canOverrideDescription).toBe(true)
  })

  it("should ignore non-boolean canOverrideDescription", () => {
    const raw = '---\ncanOverrideDescription: "nope"\ndescription: "OK"\nlimit: 5000\nreadonly: false\n---\ncontent'
    const { frontmatter } = parseFrontmatter(raw, "test.md")
    expect(frontmatter.canOverrideDescription).toBe(true) // falls back to default
  })
})

// ---------------------------------------------------------------------------
// serializeFrontmatter
// ---------------------------------------------------------------------------

describe("serializeFrontmatter", () => {
  it("should produce sorted YAML keys", () => {
    const result = serializeFrontmatter(
      { canOverrideDescription: true, description: "Test", limit: 5000, readonly: false },
      "content",
    )
    const lines = result.split("\n")
    // Keys should be alphabetically sorted: canOverrideDescription, description, limit, readonly
    expect(lines[1]).toMatch(/^canOverrideDescription:/)
    expect(lines[2]).toMatch(/^description:/)
    expect(lines[3]).toMatch(/^limit:/)
    expect(lines[4]).toMatch(/^readonly:/)
  })

  it("should wrap with --- delimiters", () => {
    const result = serializeFrontmatter(
      { canOverrideDescription: true, description: "Test", limit: 5000, readonly: false },
      "hello",
    )
    expect(result.startsWith("---\n")).toBe(true)
    expect(result).toContain("\n---\n")
  })

  it("should include body after frontmatter", () => {
    const result = serializeFrontmatter(
      { canOverrideDescription: true, description: "Test", limit: 5000, readonly: false },
      "hello world",
    )
    expect(result).toContain("hello world")
    expect(result.endsWith("\n")).toBe(true)
  })

  it("should handle empty body", () => {
    const result = serializeFrontmatter(
      { canOverrideDescription: true, description: "Test", limit: 5000, readonly: false },
      "",
    )
    expect(result).toMatch(/^---\n[\s\S]+\n---\n$/)
    // Should not have extra blank lines for empty body
    expect(result.endsWith("---\n")).toBe(true)
  })

  it("should trim body whitespace", () => {
    const result = serializeFrontmatter(
      { canOverrideDescription: true, description: "Test", limit: 5000, readonly: false },
      "  content with spaces  ",
    )
    expect(result).toContain("content with spaces")
  })
})

// ---------------------------------------------------------------------------
// atomicWrite
// ---------------------------------------------------------------------------

describe("atomicWrite", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await createTmpDir()
  })

  afterEach(async () => {
    await cleanupTmpDir(tmpDir)
  })

  it("should create a new file", async () => {
    const filePath = path.join(tmpDir, "test.md")
    await atomicWrite(filePath, "hello world")
    const content = await readFile(filePath, "utf-8")
    expect(content).toBe("hello world")
  })

  it("should overwrite an existing file", async () => {
    const filePath = path.join(tmpDir, "test.md")
    await atomicWrite(filePath, "first")
    await atomicWrite(filePath, "second")
    const content = await readFile(filePath, "utf-8")
    expect(content).toBe("second")
  })

  it("should create parent directories", async () => {
    const filePath = path.join(tmpDir, "nested", "deep", "test.md")
    await atomicWrite(filePath, "nested content")
    const content = await readFile(filePath, "utf-8")
    expect(content).toBe("nested content")
  })
})

// ---------------------------------------------------------------------------
// writeMemoryFile + parseMemoryFile roundtrip
// ---------------------------------------------------------------------------

describe("writeMemoryFile + parseMemoryFile roundtrip", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await createTmpDir()
  })

  afterEach(async () => {
    await cleanupTmpDir(tmpDir)
  })

  it("should roundtrip write and read", async () => {
    const absPath = path.join(tmpDir, "system", "persona.md")
    const fm = { canOverrideDescription: true, description: "Test persona", limit: 5000, readonly: false }
    const body = "You are helpful."

    await writeMemoryFile(absPath, fm, body)
    const file = await parseMemoryFile(absPath, "system/persona.md", "project")

    expect(file.path).toBe("system/persona.md")
    expect(file.frontmatter.description).toBe("Test persona")
    expect(file.frontmatter.limit).toBe(5000)
    expect(file.frontmatter.readonly).toBe(false)
    expect(file.content).toBe("You are helpful.")
    expect(file.chars).toBe(16)
    expect(file.scope).toBe("project")
  })

  it("should roundtrip with empty body", async () => {
    const absPath = path.join(tmpDir, "empty.md")
    const fm = { canOverrideDescription: true, description: "Empty", limit: 3000, readonly: true }

    await writeMemoryFile(absPath, fm, "")
    const file = await parseMemoryFile(absPath, "empty.md", "global")

    expect(file.content).toBe("")
    expect(file.chars).toBe(0)
    expect(file.frontmatter.readonly).toBe(true)
    expect(file.scope).toBe("global")
  })
})
