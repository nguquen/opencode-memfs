/**
 * Concurrency locks for memory operations.
 *
 * Two primitives:
 * - `createFileLock()` — per-path mutex using promise chaining.
 *   Serializes read-modify-write operations on the same file.
 *   Operations on different paths run in parallel.
 *
 * - `createMutex()` — single mutex for serializing all operations.
 *   Used for git operations (commit, rollback) to prevent interleaving.
 *
 * Both use pure promise chaining — no external dependencies.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A function that runs `fn` while holding a lock. */
export type LockFn = <T>(fn: () => Promise<T>) => Promise<T>

/** A function that runs `fn` while holding a lock keyed by path. */
export type FileLockFn = <T>(path: string, fn: () => Promise<T>) => Promise<T>

// ---------------------------------------------------------------------------
// Mutex (single lock)
// ---------------------------------------------------------------------------

/**
 * Create a single mutex.
 *
 * All callers of the returned function are serialized — only one
 * `fn` runs at a time. If `fn` throws, the lock is still released.
 *
 * @returns A `withLock(fn)` function.
 */
export function createMutex(): LockFn {
  let tail: Promise<void> = Promise.resolve()

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    let release: () => void
    const gate = new Promise<void>((r) => { release = r })

    // Chain onto the tail — wait for all prior operations
    const prev = tail
    tail = gate

    await prev

    try {
      return await fn()
    } finally {
      release!()
    }
  }
}

// ---------------------------------------------------------------------------
// File Lock (per-path mutex)
// ---------------------------------------------------------------------------

/**
 * Create a per-path file lock.
 *
 * Operations on the same path are serialized. Operations on different
 * paths run in parallel. Map entries are cleaned up when the queue
 * for a path drains (no memory leak on long-running processes).
 *
 * @returns A `withFileLock(path, fn)` function.
 */
export function createFileLock(): FileLockFn {
  const locks = new Map<string, Promise<void>>()

  return async <T>(filePath: string, fn: () => Promise<T>): Promise<T> => {
    let release: () => void
    const gate = new Promise<void>((r) => { release = r })

    // Chain onto the existing lock for this path (or start fresh)
    const prev = locks.get(filePath) ?? Promise.resolve()
    locks.set(filePath, gate)

    await prev

    try {
      return await fn()
    } finally {
      // Clean up if no one else queued after us
      if (locks.get(filePath) === gate) {
        locks.delete(filePath)
      }
      release!()
    }
  }
}
