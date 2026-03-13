/**
 * Unit tests for tools.ts — all 9 memory tool handlers.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { readFile } from "fs/promises"
import path from "path"

import {
  createMemoryRead,
  createMemoryWrite,
  createMemoryEdit,
  createMemoryDelete,
  createMemoryPromote,
  createMemoryDemote,
  createMemoryTree,
  createMemoryHistory,
  createMemoryRollback,
} from "../tools"
import type { MemFSState } from "../tools"
import { commitAll } from "../git"
import {
  createTmpDir,
  cleanupTmpDir,
  createTestState,
  createDualStoreState,
  writeTestFile,
  FIXTURE_FULL,
  FIXTURE_READONLY,
} from "./helpers"

let tmpDir: string
let state: MemFSState

/** Stub ToolContext — tools only use args, not the context object. */
const stubContext = {
  sessionID: "test",
  messageID: "test",
  agent: "test",
  directory: "/tmp",
  worktree: "/tmp",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

beforeEach(async () => {
  tmpDir = await createTmpDir("memfs-tools-")
  state = await createTestState(tmpDir)
})

afterEach(async () => {
  await cleanupTmpDir(tmpDir)
})

// ---------------------------------------------------------------------------
// memory_read
// ---------------------------------------------------------------------------

describe("memory_read", () => {
  it("should read a file with metadata header", async () => {
    await writeTestFile(tmpDir, "system/persona.md", FIXTURE_FULL)
    const tool = createMemoryRead(state)
    const result = await tool.execute({ path: "system/persona.md", scope: "project" }, stubContext)

    expect(result).toContain("path: system/persona.md")
    expect(result).toContain("description: Agent identity and behavior guidelines")
    expect(result).toContain("readonly: false")
    expect(result).toContain("You are a helpful coding assistant.")
  })

  it("should error on missing file", async () => {
    const tool = createMemoryRead(state)
    await expect(
      tool.execute({ path: "nonexistent.md", scope: "project" }, stubContext),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// memory_write
// ---------------------------------------------------------------------------

describe("memory_write", () => {
  it("should create a new file", async () => {
    const tool = createMemoryWrite(state)
    const result = await tool.execute(
      { path: "system/test.md", scope: "project", content: "Hello world" },
      stubContext,
    )
    expect(result).toContain("Wrote system/test.md")
    expect(result).toContain("11/5000")

    const raw = await readFile(path.join(tmpDir, "system/test.md"), "utf-8")
    expect(raw).toContain("Hello world")
  })

  it("should auto-generate description from filename", async () => {
    const tool = createMemoryWrite(state)
    await tool.execute(
      { path: "reference/debugging-patterns.md", scope: "project", content: "patterns" },
      stubContext,
    )
    const raw = await readFile(path.join(tmpDir, "reference/debugging-patterns.md"), "utf-8")
    expect(raw).toContain("Debugging patterns")
  })

  it("should use explicit description when provided", async () => {
    const tool = createMemoryWrite(state)
    await tool.execute(
      { path: "system/test.md", scope: "project", content: "hello", description: "Custom desc" },
      stubContext,
    )
    const raw = await readFile(path.join(tmpDir, "system/test.md"), "utf-8")
    expect(raw).toContain("Custom desc")
  })

  it("should reject content exceeding limit", async () => {
    const tool = createMemoryWrite(state)
    const result = await tool.execute(
      { path: "system/test.md", scope: "project", content: "a".repeat(6000), limit: 5000 },
      stubContext,
    )
    expect(result).toContain("Error")
    expect(result).toContain("exceeds limit")
  })

  it("should reject overwriting a readonly file", async () => {
    await writeTestFile(tmpDir, "system/rules.md", FIXTURE_READONLY)
    const tool = createMemoryWrite(state)
    const result = await tool.execute(
      { path: "system/rules.md", scope: "project", content: "new content" },
      stubContext,
    )
    expect(result).toContain("Error")
    expect(result).toContain("readonly")
  })

  it("should replace an existing non-readonly file", async () => {
    await writeTestFile(tmpDir, "system/test.md", FIXTURE_FULL)
    const tool = createMemoryWrite(state)
    const result = await tool.execute(
      { path: "system/test.md", scope: "project", content: "replaced content" },
      stubContext,
    )
    expect(result).toContain("Wrote system/test.md")

    const raw = await readFile(path.join(tmpDir, "system/test.md"), "utf-8")
    expect(raw).toContain("replaced content")
  })

  it("should preserve description when canOverrideDescription is false", async () => {
    // Create a file with canOverrideDescription: false (simulating a seed file)
    const protectedContent = `---\ncanOverrideDescription: false\ndescription: "Protected seed description with triggers"\nlimit: 5000\nreadonly: false\n---\n\nOriginal content\n`
    await writeTestFile(tmpDir, "system/protected.md", protectedContent)

    const tool = createMemoryWrite(state)
    const result = await tool.execute(
      {
        path: "system/protected.md",
        scope: "project",
        content: "Updated content",
        description: "Agent wants to replace this description",
      },
      stubContext,
    )
    expect(result).toContain("Wrote system/protected.md")

    const raw = await readFile(path.join(tmpDir, "system/protected.md"), "utf-8")
    // Original description should be preserved
    expect(raw).toContain("Protected seed description with triggers")
    // Agent's description should NOT appear
    expect(raw).not.toContain("Agent wants to replace this description")
    // Content should be updated
    expect(raw).toContain("Updated content")
    // canOverrideDescription should remain false
    expect(raw).toContain("canOverrideDescription: false")
  })

  it("should allow description override when canOverrideDescription is true", async () => {
    // Create a file with canOverrideDescription: true (default behavior)
    const normalContent = `---\ncanOverrideDescription: true\ndescription: "Original description"\nlimit: 5000\nreadonly: false\n---\n\nOriginal content\n`
    await writeTestFile(tmpDir, "system/normal.md", normalContent)

    const tool = createMemoryWrite(state)
    await tool.execute(
      {
        path: "system/normal.md",
        scope: "project",
        content: "Updated content",
        description: "New description from agent",
      },
      stubContext,
    )

    const raw = await readFile(path.join(tmpDir, "system/normal.md"), "utf-8")
    // New description should be applied
    expect(raw).toContain("New description from agent")
    expect(raw).not.toContain("Original description")
  })

  it("should indicate hot vs cold tier", async () => {
    const tool = createMemoryWrite(state)
    const hotResult = await tool.execute(
      { path: "system/hot.md", scope: "project", content: "hot" },
      stubContext,
    )
    expect(hotResult).toContain("hot (system)")

    const coldResult = await tool.execute(
      { path: "reference/cold.md", scope: "project", content: "cold" },
      stubContext,
    )
    expect(coldResult).toContain("cold")
  })
})

// ---------------------------------------------------------------------------
// memory_edit
// ---------------------------------------------------------------------------

describe("memory_edit", () => {
  it("should replace oldString with newString", async () => {
    await writeTestFile(tmpDir, "system/persona.md", FIXTURE_FULL)
    const tool = createMemoryEdit(state)
    const result = await tool.execute(
      {
        path: "system/persona.md",
        scope: "project",
        oldString: "helpful coding assistant",
        newString: "precise engineering assistant",
      },
      stubContext,
    )
    expect(result).toContain("Edited system/persona.md")

    const raw = await readFile(path.join(tmpDir, "system/persona.md"), "utf-8")
    expect(raw).toContain("precise engineering assistant")
    expect(raw).not.toContain("helpful coding assistant")
  })

  it("should reject edit on readonly file", async () => {
    await writeTestFile(tmpDir, "system/rules.md", FIXTURE_READONLY)
    const tool = createMemoryEdit(state)
    const result = await tool.execute(
      { path: "system/rules.md", scope: "project", oldString: "modify", newString: "change" },
      stubContext,
    )
    expect(result).toContain("Error")
    expect(result).toContain("readonly")
  })

  it("should reject when oldString not found", async () => {
    await writeTestFile(tmpDir, "system/persona.md", FIXTURE_FULL)
    const tool = createMemoryEdit(state)
    const result = await tool.execute(
      { path: "system/persona.md", scope: "project", oldString: "nonexistent text", newString: "new" },
      stubContext,
    )
    expect(result).toContain("Error")
    expect(result).toContain("not found")
  })

  it("should reject edit that would exceed limit", async () => {
    // Create a file near its limit with a unique marker for replacement
    const tool = createMemoryWrite(state)
    const content = "a".repeat(4980) + "MARKER_END"
    await tool.execute(
      { path: "system/test.md", scope: "project", content, limit: 5000 },
      stubContext,
    )

    const editTool = createMemoryEdit(state)
    const result = await editTool.execute(
      { path: "system/test.md", scope: "project", oldString: "MARKER_END", newString: "b".repeat(100) },
      stubContext,
    )
    expect(result).toContain("Error")
    expect(result).toContain("exceed limit")
  })

  it("should reject edit when oldString has multiple matches", async () => {
    const tool = createMemoryWrite(state)
    await tool.execute(
      { path: "system/test.md", scope: "project", content: "foo bar foo baz" },
      stubContext,
    )

    const editTool = createMemoryEdit(state)
    const result = await editTool.execute(
      { path: "system/test.md", scope: "project", oldString: "foo", newString: "qux" },
      stubContext,
    )
    expect(result).toContain("Error")
    expect(result).toContain("2 matches")
  })
})

// ---------------------------------------------------------------------------
// memory_delete
// ---------------------------------------------------------------------------

describe("memory_delete", () => {
  it("should delete a file", async () => {
    await writeTestFile(tmpDir, "system/test.md", FIXTURE_FULL)
    const tool = createMemoryDelete(state)
    const result = await tool.execute(
      { path: "system/test.md", scope: "project" },
      stubContext,
    )
    expect(result).toContain("Deleted system/test.md")

    await expect(
      readFile(path.join(tmpDir, "system/test.md")),
    ).rejects.toThrow()
  })

  it("should reject deleting a readonly file", async () => {
    await writeTestFile(tmpDir, "system/rules.md", FIXTURE_READONLY)
    const tool = createMemoryDelete(state)
    const result = await tool.execute(
      { path: "system/rules.md", scope: "project" },
      stubContext,
    )
    expect(result).toContain("Error")
    expect(result).toContain("readonly")
  })

  it("should error on missing file", async () => {
    const tool = createMemoryDelete(state)
    await expect(
      tool.execute({ path: "nonexistent.md", scope: "project" }, stubContext),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// memory_promote
// ---------------------------------------------------------------------------

describe("memory_promote", () => {
  it("should move a cold file to system/", async () => {
    await writeTestFile(tmpDir, "reference/notes.md", FIXTURE_FULL)
    const tool = createMemoryPromote(state)
    const result = await tool.execute(
      { path: "reference/notes.md", scope: "project" },
      stubContext,
    )
    expect(result).toContain("Promoted")
    expect(result).toContain("system/notes.md")

    const raw = await readFile(path.join(tmpDir, "system/notes.md"), "utf-8")
    expect(raw).toContain("helpful coding assistant")
  })

  it("should reject promoting an already-hot file", async () => {
    await writeTestFile(tmpDir, "system/persona.md", FIXTURE_FULL)
    const tool = createMemoryPromote(state)
    const result = await tool.execute(
      { path: "system/persona.md", scope: "project" },
      stubContext,
    )
    expect(result).toContain("Error")
    expect(result).toContain("already in")
  })
})

// ---------------------------------------------------------------------------
// memory_demote
// ---------------------------------------------------------------------------

describe("memory_demote", () => {
  it("should move a hot file to reference/", async () => {
    await writeTestFile(tmpDir, "system/extra.md", FIXTURE_FULL)
    const tool = createMemoryDemote(state)
    const result = await tool.execute(
      { path: "system/extra.md", scope: "project" },
      stubContext,
    )
    expect(result).toContain("Demoted")
    expect(result).toContain("reference/extra.md")

    const raw = await readFile(path.join(tmpDir, "reference/extra.md"), "utf-8")
    expect(raw).toContain("helpful coding assistant")
  })

  it("should reject demoting an already-cold file", async () => {
    await writeTestFile(tmpDir, "reference/notes.md", FIXTURE_FULL)
    const tool = createMemoryDemote(state)
    const result = await tool.execute(
      { path: "reference/notes.md", scope: "project" },
      stubContext,
    )
    expect(result).toContain("Error")
    expect(result).toContain("not in")
  })
})

// ---------------------------------------------------------------------------
// memory_tree
// ---------------------------------------------------------------------------

describe("memory_tree", () => {
  it("should list all files", async () => {
    await writeTestFile(tmpDir, "system/persona.md", FIXTURE_FULL)
    await writeTestFile(tmpDir, "reference/notes.md", FIXTURE_FULL)
    const tool = createMemoryTree(state)
    const result = await tool.execute({ scope: "all" }, stubContext)
    expect(result).toContain("system/persona.md")
    expect(result).toContain("reference/notes.md")
  })

  it("should return empty message when no files", async () => {
    const tool = createMemoryTree(state)
    const result = await tool.execute({ scope: "all" }, stubContext)
    expect(result).toContain("no memory files found")
  })
})

// ---------------------------------------------------------------------------
// memory_history
// ---------------------------------------------------------------------------

describe("memory_history", () => {
  it("should return commit log", async () => {
    // The test state already has a git repo with initial commit
    const tool = createMemoryHistory(state)
    const result = await tool.execute({ limit: 10 }, stubContext)
    expect(result).toContain("initial commit")
  })

  it("should include new commits", async () => {
    await writeTestFile(tmpDir, "system/test.md", FIXTURE_FULL)
    await commitAll(state.git, "test: added file")

    const tool = createMemoryHistory(state)
    const result = await tool.execute({ limit: 10 }, stubContext)
    expect(result).toContain("test: added file")
  })
})

// ---------------------------------------------------------------------------
// memory_rollback
// ---------------------------------------------------------------------------

describe("memory_rollback", () => {
  it("should revert to a previous commit", async () => {
    await writeTestFile(tmpDir, "system/test.md", "v1 content")
    await commitAll(state.git, "v1")

    // Get v1 hash
    const { getLog } = await import("../git")
    const log1 = await getLog(state.git)
    const v1Hash = log1[0].hash

    // Write v2
    await writeTestFile(tmpDir, "system/test.md", "v2 content")
    await commitAll(state.git, "v2")

    const tool = createMemoryRollback(state)
    const result = await tool.execute(
      { commitHash: v1Hash },
      stubContext,
    )
    expect(result).toContain("Rolled back")

    const content = await readFile(path.join(tmpDir, "system/test.md"), "utf-8")
    expect(content).toBe("v1 content")
  })

  it("should return error for invalid hash", async () => {
    const tool = createMemoryRollback(state)
    const result = await tool.execute(
      { commitHash: "0000000" },
      stubContext,
    )
    expect(result).toContain("Error")
    expect(result).toContain("not found")
  })
})

// ---------------------------------------------------------------------------
// Scope Disambiguation (dual-store)
// ---------------------------------------------------------------------------

describe("scope disambiguation", () => {
  let dualTmpDir: string
  let dualState: MemFSState
  let projectRoot: string
  let globalRoot: string

  beforeEach(async () => {
    dualTmpDir = await createTmpDir("memfs-dual-")
    const dual = await createDualStoreState(dualTmpDir)
    dualState = dual.state
    projectRoot = dual.projectRoot
    globalRoot = dual.globalRoot
  })

  afterEach(async () => {
    await cleanupTmpDir(dualTmpDir)
  })

  it("should write to project scope only", async () => {
    const tool = createMemoryWrite(dualState)
    const result = await tool.execute(
      { path: "system/test.md", scope: "project", content: "project content" },
      stubContext,
    )
    expect(result).toContain("project scope")

    const raw = await readFile(path.join(projectRoot, "system/test.md"), "utf-8")
    expect(raw).toContain("project content")

    // Should NOT exist in global store
    await expect(
      readFile(path.join(globalRoot, "system/test.md")),
    ).rejects.toThrow()
  })

  it("should write to global scope only", async () => {
    const tool = createMemoryWrite(dualState)
    const result = await tool.execute(
      { path: "system/test.md", scope: "global", content: "global content" },
      stubContext,
    )
    expect(result).toContain("global scope")

    const raw = await readFile(path.join(globalRoot, "system/test.md"), "utf-8")
    expect(raw).toContain("global content")

    // Should NOT exist in project store
    await expect(
      readFile(path.join(projectRoot, "system/test.md")),
    ).rejects.toThrow()
  })

  it("should read from correct scope when same path exists in both", async () => {
    // Write different content to the same path in both scopes
    await writeTestFile(projectRoot, "system/shared.md", "---\ndescription: \"Project version\"\nlimit: 5000\nreadonly: false\n---\nproject data")
    await writeTestFile(globalRoot, "system/shared.md", "---\ndescription: \"Global version\"\nlimit: 5000\nreadonly: false\n---\nglobal data")

    const tool = createMemoryRead(dualState)

    const projectResult = await tool.execute(
      { path: "system/shared.md", scope: "project" },
      stubContext,
    )
    expect(projectResult).toContain("project data")
    expect(projectResult).not.toContain("global data")

    const globalResult = await tool.execute(
      { path: "system/shared.md", scope: "global" },
      stubContext,
    )
    expect(globalResult).toContain("global data")
    expect(globalResult).not.toContain("project data")
  })

  it("should edit in correct scope when same path exists in both", async () => {
    await writeTestFile(projectRoot, "system/shared.md", "---\ndescription: \"Shared\"\nlimit: 5000\nreadonly: false\n---\nhello world")
    await writeTestFile(globalRoot, "system/shared.md", "---\ndescription: \"Shared\"\nlimit: 5000\nreadonly: false\n---\nhello world")

    const tool = createMemoryEdit(dualState)
    await tool.execute(
      { path: "system/shared.md", scope: "project", oldString: "hello world", newString: "project edited" },
      stubContext,
    )

    // Project file changed
    const projectRaw = await readFile(path.join(projectRoot, "system/shared.md"), "utf-8")
    expect(projectRaw).toContain("project edited")

    // Global file untouched
    const globalRaw = await readFile(path.join(globalRoot, "system/shared.md"), "utf-8")
    expect(globalRaw).toContain("hello world")
  })

  it("should delete from correct scope only", async () => {
    await writeTestFile(projectRoot, "system/deleteme.md", FIXTURE_FULL)
    await writeTestFile(globalRoot, "system/deleteme.md", FIXTURE_FULL)

    const tool = createMemoryDelete(dualState)
    await tool.execute(
      { path: "system/deleteme.md", scope: "project" },
      stubContext,
    )

    // Project file deleted
    await expect(
      readFile(path.join(projectRoot, "system/deleteme.md")),
    ).rejects.toThrow()

    // Global file still exists
    const globalRaw = await readFile(path.join(globalRoot, "system/deleteme.md"), "utf-8")
    expect(globalRaw).toContain("helpful coding assistant")
  })

  it("should promote within correct scope only", async () => {
    await writeTestFile(projectRoot, "reference/notes.md", FIXTURE_FULL)

    const tool = createMemoryPromote(dualState)
    const result = await tool.execute(
      { path: "reference/notes.md", scope: "project" },
      stubContext,
    )
    expect(result).toContain("Promoted")

    // File moved within project store
    const raw = await readFile(path.join(projectRoot, "system/notes.md"), "utf-8")
    expect(raw).toContain("helpful coding assistant")

    // Nothing in global store
    await expect(
      readFile(path.join(globalRoot, "system/notes.md")),
    ).rejects.toThrow()
  })

  it("should demote within correct scope only", async () => {
    await writeTestFile(globalRoot, "system/extra.md", FIXTURE_FULL)

    const tool = createMemoryDemote(dualState)
    const result = await tool.execute(
      { path: "system/extra.md", scope: "global" },
      stubContext,
    )
    expect(result).toContain("Demoted")

    // File moved within global store
    const raw = await readFile(path.join(globalRoot, "reference/extra.md"), "utf-8")
    expect(raw).toContain("helpful coding assistant")

    // Nothing in project store
    await expect(
      readFile(path.join(projectRoot, "reference/extra.md")),
    ).rejects.toThrow()
  })
})
