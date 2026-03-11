/**
 * Tests for lock.ts — concurrency primitives.
 *
 * Verifies that createMutex and createFileLock properly serialize
 * concurrent operations and handle errors without deadlocking.
 */

import { describe, it, expect } from "vitest"

import { createMutex, createFileLock } from "../lock"

// ---------------------------------------------------------------------------
// Helper: delay
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ---------------------------------------------------------------------------
// createMutex
// ---------------------------------------------------------------------------

describe("createMutex", () => {
  it("should serialize concurrent operations", async () => {
    const withLock = createMutex()
    const order: number[] = []

    // Launch three operations concurrently — they should run in order
    const p1 = withLock(async () => {
      order.push(1)
      await delay(50)
      order.push(2)
    })
    const p2 = withLock(async () => {
      order.push(3)
      await delay(10)
      order.push(4)
    })
    const p3 = withLock(async () => {
      order.push(5)
      order.push(6)
    })

    await Promise.all([p1, p2, p3])

    // Each operation must complete before the next starts
    expect(order).toEqual([1, 2, 3, 4, 5, 6])
  })

  it("should return the value from fn", async () => {
    const withLock = createMutex()

    const result = await withLock(async () => {
      return 42
    })

    expect(result).toBe(42)
  })

  it("should release lock on error (no deadlock)", async () => {
    const withLock = createMutex()

    // First operation throws
    await expect(withLock(async () => {
      throw new Error("boom")
    })).rejects.toThrow("boom")

    // Second operation should still run (lock was released)
    const result = await withLock(async () => {
      return "ok"
    })

    expect(result).toBe("ok")
  })

  it("should allow sequential non-overlapping calls", async () => {
    const withLock = createMutex()

    const r1 = await withLock(async () => "a")
    const r2 = await withLock(async () => "b")

    expect(r1).toBe("a")
    expect(r2).toBe("b")
  })
})

// ---------------------------------------------------------------------------
// createFileLock
// ---------------------------------------------------------------------------

describe("createFileLock", () => {
  it("should serialize concurrent operations on the same path", async () => {
    const withFileLock = createFileLock()
    const order: number[] = []

    const p1 = withFileLock("/tmp/a.md", async () => {
      order.push(1)
      await delay(50)
      order.push(2)
    })
    const p2 = withFileLock("/tmp/a.md", async () => {
      order.push(3)
      order.push(4)
    })

    await Promise.all([p1, p2])

    // Same path — must be serialized
    expect(order).toEqual([1, 2, 3, 4])
  })

  it("should allow parallel operations on different paths", async () => {
    const withFileLock = createFileLock()
    const order: string[] = []

    const p1 = withFileLock("/tmp/a.md", async () => {
      order.push("a-start")
      await delay(50)
      order.push("a-end")
    })
    const p2 = withFileLock("/tmp/b.md", async () => {
      order.push("b-start")
      await delay(10)
      order.push("b-end")
    })

    await Promise.all([p1, p2])

    // Different paths — should run in parallel
    // b should finish before a since it has a shorter delay
    expect(order.indexOf("a-start")).toBeLessThanOrEqual(1)
    expect(order.indexOf("b-start")).toBeLessThanOrEqual(1)
    expect(order.indexOf("b-end")).toBeLessThan(order.indexOf("a-end"))
  })

  it("should return the value from fn", async () => {
    const withFileLock = createFileLock()

    const result = await withFileLock("/tmp/x.md", async () => {
      return "hello"
    })

    expect(result).toBe("hello")
  })

  it("should release lock on error (no deadlock)", async () => {
    const withFileLock = createFileLock()

    // First operation throws
    await expect(withFileLock("/tmp/a.md", async () => {
      throw new Error("boom")
    })).rejects.toThrow("boom")

    // Second operation should still run (lock was released)
    const result = await withFileLock("/tmp/a.md", async () => {
      return "ok"
    })

    expect(result).toBe("ok")
  })

  it("should clean up map entries when queue drains", async () => {
    const withFileLock = createFileLock()

    // Run and complete — the internal map entry should be cleaned up
    await withFileLock("/tmp/cleanup.md", async () => {
      return "done"
    })

    // Run again on same path — should work (no stale entry)
    const result = await withFileLock("/tmp/cleanup.md", async () => {
      return "second"
    })

    expect(result).toBe("second")
  })

  it("should handle many concurrent operations on the same path", async () => {
    const withFileLock = createFileLock()
    const results: number[] = []

    const promises = Array.from({ length: 10 }, (_, i) =>
      withFileLock("/tmp/heavy.md", async () => {
        results.push(i)
        await delay(5)
      })
    )

    await Promise.all(promises)

    // All 10 should have run in order (0, 1, 2, ..., 9)
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })
})
