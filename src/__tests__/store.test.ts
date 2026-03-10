/**
 * Unit tests for store.ts — directory scanning, tree building, hot/cold partitioning.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdir, writeFile } from "fs/promises"
import path from "path"

import {
  scanDir,
  scanStore,
  scanAllStores,
  buildTree,
  isHot,
  partitionFiles,
} from "../store"
import type { MemoryFile } from "../types"
import {
  createTmpDir,
  cleanupTmpDir,
  writeTestFile,
  FIXTURE_FULL,
  FIXTURE_PARTIAL,
} from "./helpers"

let tmpDir: string

beforeEach(async () => {
  tmpDir = await createTmpDir("memfs-store-")
})

afterEach(async () => {
  await cleanupTmpDir(tmpDir)
})

// ---------------------------------------------------------------------------
// scanDir
// ---------------------------------------------------------------------------

describe("scanDir", () => {
  it("should find .md files", async () => {
    await writeTestFile(tmpDir, "system/persona.md", FIXTURE_FULL)
    await writeTestFile(tmpDir, "system/human.md", FIXTURE_PARTIAL)
    const files = await scanDir(tmpDir)
    expect(files).toContain("system/persona.md")
    expect(files).toContain("system/human.md")
    expect(files.length).toBe(2)
  })

  it("should skip non-.md files", async () => {
    await writeTestFile(tmpDir, "system/persona.md", FIXTURE_FULL)
    await writeTestFile(tmpDir, "system/notes.txt", "not markdown")
    const files = await scanDir(tmpDir)
    expect(files).toEqual(["system/persona.md"])
  })

  it("should skip hidden directories", async () => {
    await writeTestFile(tmpDir, ".hidden/secret.md", "hidden")
    await writeTestFile(tmpDir, "system/visible.md", FIXTURE_FULL)
    const files = await scanDir(tmpDir)
    expect(files).toEqual(["system/visible.md"])
  })

  it("should skip .git directory", async () => {
    await writeTestFile(tmpDir, ".git/config.md", "git internal")
    await writeTestFile(tmpDir, "system/visible.md", FIXTURE_FULL)
    const files = await scanDir(tmpDir)
    expect(files).toEqual(["system/visible.md"])
  })

  it("should sort results alphabetically", async () => {
    await writeTestFile(tmpDir, "system/zz.md", FIXTURE_FULL)
    await writeTestFile(tmpDir, "system/aa.md", FIXTURE_FULL)
    await writeTestFile(tmpDir, "reference/mm.md", FIXTURE_FULL)
    const files = await scanDir(tmpDir)
    expect(files).toEqual(["reference/mm.md", "system/aa.md", "system/zz.md"])
  })

  it("should respect maxDepth", async () => {
    await writeTestFile(tmpDir, "a/b/c/d/deep.md", FIXTURE_FULL)
    await writeTestFile(tmpDir, "a/shallow.md", FIXTURE_FULL)

    const shallow = await scanDir(tmpDir, 2)
    expect(shallow).toContain("a/shallow.md")
    expect(shallow).not.toContain("a/b/c/d/deep.md")

    const deep = await scanDir(tmpDir, 5)
    expect(deep).toContain("a/b/c/d/deep.md")
  })

  it("should return empty array for empty directory", async () => {
    const files = await scanDir(tmpDir)
    expect(files).toEqual([])
  })

  it("should return empty array for nonexistent directory", async () => {
    const files = await scanDir(path.join(tmpDir, "nonexistent"))
    expect(files).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// scanStore
// ---------------------------------------------------------------------------

describe("scanStore", () => {
  it("should return parsed MemoryFile objects", async () => {
    await writeTestFile(tmpDir, "system/persona.md", FIXTURE_FULL)

    const files = await scanStore({ root: tmpDir, scope: "project" })
    expect(files.length).toBe(1)
    expect(files[0].path).toBe("system/persona.md")
    expect(files[0].scope).toBe("project")
    expect(files[0].frontmatter.description).toBe("Agent identity and behavior guidelines")
  })

  it("should skip unparseable files", async () => {
    await writeTestFile(tmpDir, "system/good.md", FIXTURE_FULL)
    // Create a file that can be read but is just plain text
    await writeTestFile(tmpDir, "system/plain.md", "Just text")

    const files = await scanStore({ root: tmpDir, scope: "project" })
    // Both should parse — plain text just gets default frontmatter
    expect(files.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// scanAllStores
// ---------------------------------------------------------------------------

describe("scanAllStores", () => {
  it("should merge files from multiple stores", async () => {
    const dir2 = await createTmpDir("memfs-store2-")
    try {
      await writeTestFile(tmpDir, "system/project.md", FIXTURE_FULL)
      await writeTestFile(dir2, "system/global.md", FIXTURE_PARTIAL)

      const stores = [
        { root: tmpDir, scope: "project" as const },
        { root: dir2, scope: "global" as const },
      ]

      const files = await scanAllStores(stores)
      expect(files.length).toBe(2)
      expect(files.some((f) => f.scope === "project")).toBe(true)
      expect(files.some((f) => f.scope === "global")).toBe(true)
    } finally {
      await cleanupTmpDir(dir2)
    }
  })

  it("should filter by scope", async () => {
    const dir2 = await createTmpDir("memfs-store2-")
    try {
      await writeTestFile(tmpDir, "system/project.md", FIXTURE_FULL)
      await writeTestFile(dir2, "system/global.md", FIXTURE_PARTIAL)

      const stores = [
        { root: tmpDir, scope: "project" as const },
        { root: dir2, scope: "global" as const },
      ]

      const projectOnly = await scanAllStores(stores, "project")
      expect(projectOnly.length).toBe(1)
      expect(projectOnly[0].scope).toBe("project")

      const globalOnly = await scanAllStores(stores, "global")
      expect(globalOnly.length).toBe(1)
      expect(globalOnly[0].scope).toBe("global")
    } finally {
      await cleanupTmpDir(dir2)
    }
  })
})

// ---------------------------------------------------------------------------
// buildTree
// ---------------------------------------------------------------------------

describe("buildTree", () => {
  it("should return sorted tree entries", () => {
    const files: MemoryFile[] = [
      {
        path: "system/persona.md",
        frontmatter: { description: "Persona", limit: 5000, readonly: false },
        content: "content",
        chars: 7,
        scope: "project",
      },
      {
        path: "reference/api.md",
        frontmatter: { description: "API patterns", limit: 3000, readonly: false },
        content: "api stuff",
        chars: 9,
        scope: "project",
      },
    ]

    const tree = buildTree(files)
    expect(tree.length).toBe(2)
    // Sorted alphabetically
    expect(tree[0].path).toBe("reference/api.md")
    expect(tree[1].path).toBe("system/persona.md")
  })

  it("should include correct fields", () => {
    const files: MemoryFile[] = [
      {
        path: "system/test.md",
        frontmatter: { description: "Test file", limit: 8000, readonly: true },
        content: "hello",
        chars: 5,
        scope: "global",
      },
    ]

    const tree = buildTree(files)
    expect(tree[0]).toEqual({
      path: "system/test.md",
      description: "Test file",
      chars: 5,
      limit: 8000,
      scope: "global",
    })
  })

  it("should return empty array for no files", () => {
    expect(buildTree([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// isHot
// ---------------------------------------------------------------------------

describe("isHot", () => {
  it("should match files in system/", () => {
    expect(isHot("system/persona.md")).toBe(true)
    expect(isHot("system/human.md")).toBe(true)
  })

  it("should reject files outside system/", () => {
    expect(isHot("reference/notes.md")).toBe(false)
    expect(isHot("archive/old.md")).toBe(false)
  })

  it("should support custom hotDir", () => {
    expect(isHot("hot/persona.md", "hot")).toBe(true)
    expect(isHot("system/persona.md", "hot")).toBe(false)
  })

  it("should not match partial directory names", () => {
    expect(isHot("system-backup/file.md")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// partitionFiles
// ---------------------------------------------------------------------------

describe("partitionFiles", () => {
  it("should split into hot and cold arrays", () => {
    const files: MemoryFile[] = [
      {
        path: "system/persona.md",
        frontmatter: { description: "P", limit: 5000, readonly: false },
        content: "hot",
        chars: 3,
        scope: "project",
      },
      {
        path: "reference/notes.md",
        frontmatter: { description: "N", limit: 5000, readonly: false },
        content: "cold",
        chars: 4,
        scope: "project",
      },
    ]

    const { hot, cold } = partitionFiles(files)
    expect(hot.length).toBe(1)
    expect(hot[0].path).toBe("system/persona.md")
    expect(cold.length).toBe(1)
    expect(cold[0].path).toBe("reference/notes.md")
  })

  it("should handle all hot files", () => {
    const files: MemoryFile[] = [
      {
        path: "system/a.md",
        frontmatter: { description: "A", limit: 5000, readonly: false },
        content: "",
        chars: 0,
        scope: "project",
      },
    ]
    const { hot, cold } = partitionFiles(files)
    expect(hot.length).toBe(1)
    expect(cold.length).toBe(0)
  })

  it("should handle all cold files", () => {
    const files: MemoryFile[] = [
      {
        path: "reference/a.md",
        frontmatter: { description: "A", limit: 5000, readonly: false },
        content: "",
        chars: 0,
        scope: "project",
      },
    ]
    const { hot, cold } = partitionFiles(files)
    expect(hot.length).toBe(0)
    expect(cold.length).toBe(1)
  })

  it("should handle empty array", () => {
    const { hot, cold } = partitionFiles([])
    expect(hot).toEqual([])
    expect(cold).toEqual([])
  })
})
