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
    const result = await tool.execute({ path: "system/persona.md" }, stubContext)

    expect(result).toContain("path: system/persona.md")
    expect(result).toContain("description: Agent identity and behavior guidelines")
    expect(result).toContain("readonly: false")
    expect(result).toContain("You are a helpful coding assistant.")
  })

  it("should error on missing file", async () => {
    const tool = createMemoryRead(state)
    await expect(
      tool.execute({ path: "nonexistent.md" }, stubContext),
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
      { path: "system/test.md", content: "Hello world" },
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
      { path: "reference/debugging-patterns.md", content: "patterns" },
      stubContext,
    )
    const raw = await readFile(path.join(tmpDir, "reference/debugging-patterns.md"), "utf-8")
    expect(raw).toContain("Debugging patterns")
  })

  it("should use explicit description when provided", async () => {
    const tool = createMemoryWrite(state)
    await tool.execute(
      { path: "system/test.md", content: "hello", description: "Custom desc" },
      stubContext,
    )
    const raw = await readFile(path.join(tmpDir, "system/test.md"), "utf-8")
    expect(raw).toContain("Custom desc")
  })

  it("should reject content exceeding limit", async () => {
    const tool = createMemoryWrite(state)
    const result = await tool.execute(
      { path: "system/test.md", content: "a".repeat(6000), limit: 5000 },
      stubContext,
    )
    expect(result).toContain("Error")
    expect(result).toContain("exceeds limit")
  })

  it("should reject overwriting a readonly file", async () => {
    await writeTestFile(tmpDir, "system/rules.md", FIXTURE_READONLY)
    const tool = createMemoryWrite(state)
    const result = await tool.execute(
      { path: "system/rules.md", content: "new content" },
      stubContext,
    )
    expect(result).toContain("Error")
    expect(result).toContain("readonly")
  })

  it("should replace an existing non-readonly file", async () => {
    await writeTestFile(tmpDir, "system/test.md", FIXTURE_FULL)
    const tool = createMemoryWrite(state)
    const result = await tool.execute(
      { path: "system/test.md", content: "replaced content" },
      stubContext,
    )
    expect(result).toContain("Wrote system/test.md")

    const raw = await readFile(path.join(tmpDir, "system/test.md"), "utf-8")
    expect(raw).toContain("replaced content")
  })

  it("should indicate hot vs cold tier", async () => {
    const tool = createMemoryWrite(state)
    const hotResult = await tool.execute(
      { path: "system/hot.md", content: "hot" },
      stubContext,
    )
    expect(hotResult).toContain("hot (system)")

    const coldResult = await tool.execute(
      { path: "reference/cold.md", content: "cold" },
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
      { path: "system/rules.md", oldString: "modify", newString: "change" },
      stubContext,
    )
    expect(result).toContain("Error")
    expect(result).toContain("readonly")
  })

  it("should reject when oldString not found", async () => {
    await writeTestFile(tmpDir, "system/persona.md", FIXTURE_FULL)
    const tool = createMemoryEdit(state)
    const result = await tool.execute(
      { path: "system/persona.md", oldString: "nonexistent text", newString: "new" },
      stubContext,
    )
    expect(result).toContain("Error")
    expect(result).toContain("not found")
  })

  it("should reject edit that would exceed limit", async () => {
    // Create a file near its limit
    const tool = createMemoryWrite(state)
    await tool.execute(
      { path: "system/test.md", content: "a".repeat(4990), limit: 5000 },
      stubContext,
    )

    const editTool = createMemoryEdit(state)
    const result = await editTool.execute(
      { path: "system/test.md", oldString: "a", newString: "a".repeat(20) },
      stubContext,
    )
    expect(result).toContain("Error")
    expect(result).toContain("exceed limit")
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
      { path: "system/test.md" },
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
      { path: "system/rules.md" },
      stubContext,
    )
    expect(result).toContain("Error")
    expect(result).toContain("readonly")
  })

  it("should error on missing file", async () => {
    const tool = createMemoryDelete(state)
    await expect(
      tool.execute({ path: "nonexistent.md" }, stubContext),
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
      { path: "reference/notes.md" },
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
      { path: "system/persona.md" },
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
      { path: "system/extra.md" },
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
      { path: "reference/notes.md" },
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
    const git = state.gitInstances.get(tmpDir)!
    await commitAll(git, "test: added file")

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
    const git = state.gitInstances.get(tmpDir)!
    await commitAll(git, "v1")

    // Get v1 hash
    const { getLog } = await import("../git")
    const log1 = await getLog(git)
    const v1Hash = log1[0].hash

    // Write v2
    await writeTestFile(tmpDir, "system/test.md", "v2 content")
    await commitAll(git, "v2")

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
