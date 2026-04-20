/**
 * Unit tests for renderCache.ts — decision ladder + cache store (TASK-111).
 */

import { describe, it, expect } from "vitest"

import { RenderCache, shouldRefreshNow } from "../renderCache"
import type { CacheEntry, ShouldRefreshArgs } from "../renderCache"

// ---------------------------------------------------------------------------
// shouldRefreshNow — ladder branches
// ---------------------------------------------------------------------------

function baseArgs(overrides: Partial<ShouldRefreshArgs> = {}): ShouldRefreshArgs {
  const now = 1_000_000
  const cached: CacheEntry = {
    hash: "h1",
    block: "<memfs>…</memfs>",
    renderedAt: now - 1_000,
    bustGenSeen: 0,
  }
  return {
    cached,
    currentHash: "h1",
    forceBustGeneration: 0,
    usagePercentage: 10,
    refreshThresholdPercentage: 65,
    lastResponseTime: now - 1_000,
    cacheTtlMs: 5 * 60 * 1000,
    now,
    ...overrides,
  }
}

describe("shouldRefreshNow", () => {
  it("returns 'first' when there is no cached entry", () => {
    const args = baseArgs({ cached: undefined })
    expect(shouldRefreshNow(args)).toBe("first")
  })

  it("returns null when hash is unchanged and nothing forces a bust", () => {
    const args = baseArgs() // hashes match, no force, no pressure, within TTL
    expect(shouldRefreshNow(args)).toBeNull()
  })

  it("returns 'forced' when forceBustGeneration advances past cached entry", () => {
    const args = baseArgs({ forceBustGeneration: 1, currentHash: "h2" })
    expect(shouldRefreshNow(args)).toBe("forced")
  })

  it("returns 'forced' even when hash is unchanged (tier change wants publish)", () => {
    // Same hash, but force-bust advanced — must still refresh.
    const args = baseArgs({ forceBustGeneration: 1, currentHash: "h1" })
    expect(shouldRefreshNow(args)).toBe("forced")
  })

  it("returns 'pressure' when usage exceeds threshold and hash differs", () => {
    const args = baseArgs({ currentHash: "h2", usagePercentage: 70 })
    expect(shouldRefreshNow(args)).toBe("pressure")
  })

  it("returns 'pressure' exactly at the threshold", () => {
    const args = baseArgs({ currentHash: "h2", usagePercentage: 65 })
    expect(shouldRefreshNow(args)).toBe("pressure")
  })

  it("returns 'ttl' when TTL elapsed and hash differs", () => {
    const args = baseArgs({
      currentHash: "h2",
      lastResponseTime: 0,        // very old
      now: 10 * 60 * 1000,        // 10 minutes later
      cacheTtlMs: 5 * 60 * 1000,  // 5 minute TTL
    })
    expect(shouldRefreshNow(args)).toBe("ttl")
  })

  it("serves stale when hash differs but no bust condition applies", () => {
    const args = baseArgs({ currentHash: "h2" }) // hash diff, low pressure, within TTL
    expect(shouldRefreshNow(args)).toBeNull()
  })

  it("pressure takes precedence over TTL in the ladder", () => {
    const args = baseArgs({
      currentHash: "h2",
      usagePercentage: 80,
      lastResponseTime: 0,
      now: 1 * 60 * 1000, // 1 minute — TTL not elapsed
    })
    expect(shouldRefreshNow(args)).toBe("pressure")
  })

  it("forced takes precedence over pressure", () => {
    const args = baseArgs({
      currentHash: "h2",
      forceBustGeneration: 2,
      usagePercentage: 90,
    })
    expect(shouldRefreshNow(args)).toBe("forced")
  })
})

// ---------------------------------------------------------------------------
// RenderCache
// ---------------------------------------------------------------------------

describe("RenderCache", () => {
  it("round-trips set/get for a session", () => {
    const c = new RenderCache()
    const entry: CacheEntry = { hash: "h", block: "b", renderedAt: 1, bustGenSeen: 0 }

    c.set("s1", entry)
    expect(c.get("s1")).toEqual(entry)
  })

  it("returns undefined for unknown session", () => {
    const c = new RenderCache()
    expect(c.get("missing")).toBeUndefined()
  })

  it("isolates sessions", () => {
    const c = new RenderCache()
    c.set("s1", { hash: "h1", block: "b1", renderedAt: 1, bustGenSeen: 0 })
    c.set("s2", { hash: "h2", block: "b2", renderedAt: 2, bustGenSeen: 0 })

    expect(c.get("s1")?.block).toBe("b1")
    expect(c.get("s2")?.block).toBe("b2")
  })

  it("invalidate() with sessionID drops that entry only", () => {
    const c = new RenderCache()
    c.set("s1", { hash: "h1", block: "b1", renderedAt: 1, bustGenSeen: 0 })
    c.set("s2", { hash: "h2", block: "b2", renderedAt: 2, bustGenSeen: 0 })

    c.invalidate("s1")
    expect(c.get("s1")).toBeUndefined()
    expect(c.get("s2")).toBeDefined()
  })

  it("invalidate() with no argument clears everything", () => {
    const c = new RenderCache()
    c.set("s1", { hash: "h1", block: "b1", renderedAt: 1, bustGenSeen: 0 })
    c.set("s2", { hash: "h2", block: "b2", renderedAt: 2, bustGenSeen: 0 })

    c.invalidate()
    expect(c.size()).toBe(0)
  })
})
