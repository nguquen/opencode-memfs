/**
 * Shared test utilities for opencode-memfs tests.
 *
 * Provides temporary directory management, sample fixtures,
 * and helpers for creating test memory stores.
 */

import { mkdtemp, rm, writeFile, mkdir } from "fs/promises"
import { tmpdir } from "os"
import path from "path"

import simpleGit from "simple-git"
import type { SimpleGit } from "simple-git"

import type { MemFSConfig, MemoryStorePaths } from "../types"
import type { MemFSState } from "../tools"
import { ensureRepo } from "../git"
import { createFileLock, createMutex } from "../lock"

// ---------------------------------------------------------------------------
// Temp Directory
// ---------------------------------------------------------------------------

/**
 * Create a temporary directory for test isolation.
 * Returns the absolute path. Caller must clean up with `cleanupTmpDir()`.
 */
export async function createTmpDir(prefix: string = "memfs-test-"): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix))
}

/**
 * Remove a temporary directory and all its contents.
 */
export async function cleanupTmpDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// Default Config
// ---------------------------------------------------------------------------

/** Default test config matching production defaults. */
export const TEST_CONFIG: MemFSConfig = {
  hotDir: "system",
  defaultLimit: 5000,
  autoCommitDebounceMs: 2000,
  maxTreeDepth: 3,
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Sample memory file with full frontmatter. */
export const FIXTURE_FULL = `---
description: "Agent identity and behavior guidelines"
limit: 5000
readonly: false
---

You are a helpful coding assistant.
`

/** Sample memory file with partial frontmatter (missing limit and readonly). */
export const FIXTURE_PARTIAL = `---
description: "User preferences"
---

The user prefers TypeScript.
`

/** Sample memory file with no frontmatter. */
export const FIXTURE_NO_FRONTMATTER = `Just some plain content without any frontmatter.
`

/** Sample readonly memory file. */
export const FIXTURE_READONLY = `---
description: "Protected system rules"
limit: 3000
readonly: true
---

Do not modify these rules.
`

/** Sample memory file with empty body. */
export const FIXTURE_EMPTY_BODY = `---
description: "Empty file for testing"
limit: 5000
readonly: false
---
`

// ---------------------------------------------------------------------------
// Store Setup
// ---------------------------------------------------------------------------

/**
 * Create a test memory store with directory structure and git repo.
 *
 * Sets up system/, reference/, archive/ directories.
 * Returns the store paths and git instance.
 */
export async function createTestStore(
  tmpDir: string,
  scope: "project" | "global" = "project",
): Promise<{ store: MemoryStorePaths; git: SimpleGit }> {
  await mkdir(path.join(tmpDir, "system"), { recursive: true })
  await mkdir(path.join(tmpDir, "reference"), { recursive: true })
  await mkdir(path.join(tmpDir, "archive"), { recursive: true })

  const git = await ensureRepo(tmpDir)
  const store: MemoryStorePaths = { root: tmpDir, scope }

  return { store, git }
}

/**
 * Create a full MemFSState for tool testing.
 *
 * Sets up a single project store with git in a temp directory.
 */
export async function createTestState(
  tmpDir: string,
  configOverrides: Partial<MemFSConfig> = {},
): Promise<MemFSState> {
  const { store, git } = await createTestStore(tmpDir)

  return {
    stores: [store],
    gitInstances: new Map([[tmpDir, git]]),
    config: { ...TEST_CONFIG, ...configOverrides },
    withFileLock: createFileLock(),
    withGitLock: createMutex(),
  }
}

/**
 * Write a sample memory file to a test store.
 */
export async function writeTestFile(
  storeRoot: string,
  relPath: string,
  content: string,
): Promise<string> {
  const absPath = path.join(storeRoot, relPath)
  await mkdir(path.dirname(absPath), { recursive: true })
  await writeFile(absPath, content, "utf-8")
  return absPath
}
