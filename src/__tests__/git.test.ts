/**
 * Unit tests for git.ts — init, commit, log, rollback.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { writeFile, readFile, mkdir } from "fs/promises"
import path from "path"

import { ensureRepo, commitAll, getLog, rollback } from "../git"
import { createTmpDir, cleanupTmpDir } from "./helpers"

let tmpDir: string

beforeEach(async () => {
  tmpDir = await createTmpDir("memfs-git-")
})

afterEach(async () => {
  await cleanupTmpDir(tmpDir)
})

// ---------------------------------------------------------------------------
// ensureRepo
// ---------------------------------------------------------------------------

describe("ensureRepo", () => {
  it("should create a .git directory on first call", async () => {
    const git = await ensureRepo(tmpDir)
    const status = await git.status()
    expect(status).toBeDefined()
  })

  it("should be idempotent (no-op on second call)", async () => {
    await ensureRepo(tmpDir)
    const git = await ensureRepo(tmpDir)
    const log = await git.log()
    // Should still only have the initial commit
    expect(log.total).toBe(1)
  })

  it("should create an initial commit", async () => {
    const git = await ensureRepo(tmpDir)
    const log = await git.log()
    expect(log.total).toBe(1)
    expect(log.latest?.message).toBe("memory: initial commit")
  })
})

// ---------------------------------------------------------------------------
// commitAll
// ---------------------------------------------------------------------------

describe("commitAll", () => {
  it("should commit staged changes", async () => {
    const git = await ensureRepo(tmpDir)
    await writeFile(path.join(tmpDir, "test.md"), "hello")
    const committed = await commitAll(git, "test: add file")
    expect(committed).toBe(true)

    const log = await git.log()
    expect(log.latest?.message).toBe("test: add file")
  })

  it("should return false when nothing to commit", async () => {
    const git = await ensureRepo(tmpDir)
    const committed = await commitAll(git, "test: nothing")
    expect(committed).toBe(false)
  })

  it("should batch multiple file changes into one commit", async () => {
    const git = await ensureRepo(tmpDir)
    await writeFile(path.join(tmpDir, "a.md"), "aaa")
    await writeFile(path.join(tmpDir, "b.md"), "bbb")
    const committed = await commitAll(git, "test: batch")
    expect(committed).toBe(true)

    const log = await git.log()
    expect(log.latest?.message).toBe("test: batch")
  })
})

// ---------------------------------------------------------------------------
// getLog
// ---------------------------------------------------------------------------

describe("getLog", () => {
  it("should return commit history", async () => {
    const git = await ensureRepo(tmpDir)
    await writeFile(path.join(tmpDir, "file.md"), "v1")
    await commitAll(git, "commit 1")
    await writeFile(path.join(tmpDir, "file.md"), "v2")
    await commitAll(git, "commit 2")

    const commits = await getLog(git)
    expect(commits.length).toBe(3) // initial + 2 commits
    expect(commits[0].message).toBe("commit 2")
    expect(commits[1].message).toBe("commit 1")
  })

  it("should return abbreviated hashes (7 chars)", async () => {
    const git = await ensureRepo(tmpDir)
    const commits = await getLog(git)
    expect(commits[0].hash.length).toBe(7)
  })

  it("should respect the limit parameter", async () => {
    const git = await ensureRepo(tmpDir)
    for (let i = 0; i < 5; i++) {
      await writeFile(path.join(tmpDir, `file${i}.md`), `content ${i}`)
      await commitAll(git, `commit ${i}`)
    }
    const commits = await getLog(git, 3)
    expect(commits.length).toBe(3)
  })

  it("should include date field", async () => {
    const git = await ensureRepo(tmpDir)
    const commits = await getLog(git)
    expect(commits[0].date).toBeDefined()
    expect(commits[0].date.length).toBeGreaterThan(0)
  })

  it("should return empty array for repo with no commits", async () => {
    // getLog catches errors and returns [] — test with a non-git dir
    const { default: simpleGit } = await import("simple-git")
    const git = simpleGit(tmpDir)
    const commits = await getLog(git)
    expect(commits).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// rollback
// ---------------------------------------------------------------------------

describe("rollback", () => {
  it("should restore files to the target commit state", async () => {
    const git = await ensureRepo(tmpDir)

    // Commit v1
    await writeFile(path.join(tmpDir, "file.md"), "version 1")
    await commitAll(git, "v1")

    // Get the hash of v1
    const logAfterV1 = await getLog(git)
    const v1Hash = logAfterV1[0].hash

    // Commit v2
    await writeFile(path.join(tmpDir, "file.md"), "version 2")
    await commitAll(git, "v2")

    // Rollback to v1
    await rollback(git, v1Hash)

    // File should be back to v1 content
    const content = await readFile(path.join(tmpDir, "file.md"), "utf-8")
    expect(content).toBe("version 1")
  })

  it("should create a rollback commit", async () => {
    const git = await ensureRepo(tmpDir)
    await writeFile(path.join(tmpDir, "file.md"), "v1")
    await commitAll(git, "v1")
    const log1 = await getLog(git)

    await writeFile(path.join(tmpDir, "file.md"), "v2")
    await commitAll(git, "v2")

    await rollback(git, log1[0].hash)

    const log = await getLog(git)
    expect(log[0].message).toContain("rollback to")
  })

  it("should return the new commit hash", async () => {
    const git = await ensureRepo(tmpDir)
    await writeFile(path.join(tmpDir, "file.md"), "v1")
    await commitAll(git, "v1")
    const log1 = await getLog(git)

    await writeFile(path.join(tmpDir, "file.md"), "v2")
    await commitAll(git, "v2")

    const newHash = await rollback(git, log1[0].hash)
    expect(newHash.length).toBe(7)
  })
})
