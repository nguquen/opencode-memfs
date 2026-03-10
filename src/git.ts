/**
 * Git operations for memory versioning.
 *
 * Uses simple-git for init, add, commit, log, and checkout (rollback).
 * A single git repo at ~/.config/opencode/memory/ covers all stores.
 */

import { access } from "fs/promises"
import path from "path"

import simpleGit from "simple-git"
import type { SimpleGit } from "simple-git"

import type { MemoryCommit } from "./types"

// ---------------------------------------------------------------------------
// Repo Initialization
// ---------------------------------------------------------------------------

/**
 * Ensure a git repo exists at the given directory.
 *
 * If `.git/` doesn't exist, runs `git init` and creates an initial commit.
 * Returns the `SimpleGit` instance bound to that directory.
 *
 * @param dir - Absolute path to the memory directory.
 */
export async function ensureRepo(dir: string): Promise<SimpleGit> {
  const git = simpleGit(dir)
  const gitDir = path.join(dir, ".git")

  let exists = true
  try {
    await access(gitDir)
  } catch {
    exists = false
  }

  if (!exists) {
    await git.init()
    // Configure local identity for the memory repo
    await git.addConfig("user.name", "opencode-memfs")
    await git.addConfig("user.email", "memfs@local")
    // Create initial commit so the repo has a HEAD
    await git.add(".")
    await git.commit("memory: initial commit", { "--allow-empty": null })
  }

  return git
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

/**
 * Stage all changes and create a commit.
 *
 * Stages everything with `git add .` then commits. If there are no
 * changes to commit, this is a no-op (returns `false`).
 *
 * @param git     - SimpleGit instance bound to the memory directory.
 * @param message - Commit message.
 * @returns `true` if a commit was created, `false` if nothing to commit.
 */
export async function commitAll(
  git: SimpleGit,
  message: string,
): Promise<boolean> {
  await git.add(".")

  const status = await git.status()
  if (status.isClean()) {
    return false
  }

  await git.commit(message)
  return true
}

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

/**
 * Retrieve recent commits from the memory repo.
 *
 * @param git   - SimpleGit instance bound to the memory directory.
 * @param limit - Maximum number of commits to return. Default: 10.
 * @returns Array of `MemoryCommit` objects (hash, message, date).
 */
export async function getLog(
  git: SimpleGit,
  limit: number = 10,
): Promise<MemoryCommit[]> {
  try {
    const log = await git.log({ maxCount: limit })
    return log.all.map((entry) => ({
      hash: entry.hash.slice(0, 7),
      message: entry.message,
      date: entry.date,
    }))
  } catch {
    // No commits yet — return empty
    return []
  }
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

/**
 * Roll back the memory directory to a specific commit.
 *
 * Uses `git checkout <hash> -- .` to restore all files to the state
 * at that commit, then creates a new commit recording the rollback.
 * This preserves history (no force reset).
 *
 * @param git        - SimpleGit instance bound to the memory directory.
 * @param commitHash - The commit hash to revert to (short or full).
 * @returns The hash of the new rollback commit.
 */
export async function rollback(
  git: SimpleGit,
  commitHash: string,
): Promise<string> {
  // Checkout all files from the target commit
  await git.checkout([commitHash, "--", "."])

  // Stage the restored state
  await git.add(".")

  // Commit the rollback
  const shortHash = commitHash.slice(0, 7)
  const message = `memory: rollback to ${shortHash}`
  await git.commit(message)

  // Return the new commit hash
  const log = await git.log({ maxCount: 1 })
  return log.latest?.hash.slice(0, 7) ?? shortHash
}
