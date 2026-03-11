/**
 * Filesystem watcher for auto-committing memory changes.
 *
 * Uses fs.watch with a configurable debounce (default 2s) to batch
 * rapid edits. Decoupled from tools — catches all changes regardless
 * of source. Collects changed filenames for descriptive commit messages.
 */

import { watch } from "fs"
import type { FSWatcher } from "fs"

import type { SimpleGit } from "simple-git"

import { commitAll } from "./git"
import type { LockFn } from "./lock"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Handle returned by `startWatcher()` for cleanup. */
export interface WatcherHandle {
  /** Stop the watcher and clean up resources. */
  close(): void
}

// ---------------------------------------------------------------------------
// Watcher
// ---------------------------------------------------------------------------

/**
 * Start watching a memory directory for changes and auto-commit.
 *
 * Uses `fs.watch` in recursive mode. On any file change, collects
 * filenames into a set and debounces. When the debounce timer fires,
 * commits all changes with a message listing the changed files.
 *
 * @param dir         - Absolute path to the memory root directory.
 * @param git         - SimpleGit instance bound to the memory directory.
 * @param debounceMs  - Debounce delay in milliseconds. Default: 2000.
 * @param withGitLock - Git operation lock to serialize commits with rollbacks.
 * @returns A `WatcherHandle` to stop the watcher.
 */
export function startWatcher(
  dir: string,
  git: SimpleGit,
  debounceMs: number = 2000,
  withGitLock?: LockFn,
): WatcherHandle {
  let timer: ReturnType<typeof setTimeout> | null = null
  let changedFiles = new Set<string>()

  const doCommit = async (): Promise<void> => {
    const files = [...changedFiles]
    changedFiles = new Set()

    const commitFn = async (): Promise<void> => {
      const fileList = files
        .filter((f) => !f.startsWith(".git"))
        .slice(0, 5)
        .join(", ")

      const message = fileList.length > 0
        ? `memory: update ${fileList}`
        : "memory: update files"

      await commitAll(git, message)
    }

    try {
      if (withGitLock) {
        await withGitLock(commitFn)
      } else {
        await commitFn()
      }
    } catch {
      // Commit failed — silently ignore (will retry on next change)
    }
  }

  let watcher: FSWatcher

  try {
    watcher = watch(dir, { recursive: true }, (_event, filename) => {
      // Skip .git directory changes
      if (filename && filename.startsWith(".git")) return

      if (filename) {
        changedFiles.add(filename)
      }

      // Reset debounce timer
      if (timer !== null) {
        clearTimeout(timer)
      }
      timer = setTimeout(() => {
        timer = null
        void doCommit()
      }, debounceMs)
    })
  } catch {
    // fs.watch not available or directory doesn't exist
    return { close() {} }
  }

  return {
    close() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      watcher.close()
    },
  }
}
