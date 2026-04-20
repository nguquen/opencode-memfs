/**
 * Unit tests for sessionMeta.ts — per-session meta + usage percentage (TASK-111).
 */

import { describe, it, expect } from "vitest"

import { SessionMetaStore, computeUsagePercentage } from "../sessionMeta"

describe("SessionMetaStore", () => {
  it("creates a default entry on first access", () => {
    const s = new SessionMetaStore()
    const meta = s.getOrCreate("s1", 123)

    expect(meta.lastResponseTime).toBe(123)
    expect(meta.lastChangeTime).toBe(123)
    expect(meta.modelContextLimit).toBeUndefined()
    expect(meta.lastTokens).toBeUndefined()
  })

  it("returns the same entry on subsequent calls", () => {
    const s = new SessionMetaStore()
    const a = s.getOrCreate("s1")
    const b = s.getOrCreate("s1")
    expect(a).toBe(b)
  })

  it("isolates different sessions", () => {
    const s = new SessionMetaStore()
    const a = s.getOrCreate("s1")
    const b = s.getOrCreate("s2")
    expect(a).not.toBe(b)
  })

  it("get() returns undefined for unknown sessions", () => {
    const s = new SessionMetaStore()
    expect(s.get("missing")).toBeUndefined()
  })

  it("delete() removes the entry", () => {
    const s = new SessionMetaStore()
    s.getOrCreate("s1")
    s.delete("s1")
    expect(s.get("s1")).toBeUndefined()
    expect(s.size()).toBe(0)
  })

  it("values() iterates over all tracked sessions", () => {
    const s = new SessionMetaStore()
    s.getOrCreate("s1")
    s.getOrCreate("s2")
    s.getOrCreate("s3")

    const count = [...s.values()].length
    expect(count).toBe(3)
  })
})

describe("computeUsagePercentage", () => {
  it("returns 0 when modelContextLimit is missing", () => {
    expect(
      computeUsagePercentage({
        lastResponseTime: 0,
        lastChangeTime: 0,
        lastTokens: { input: 100, cacheRead: 100 },
      }),
    ).toBe(0)
  })

  it("returns 0 when lastTokens is missing", () => {
    expect(
      computeUsagePercentage({
        lastResponseTime: 0,
        lastChangeTime: 0,
        modelContextLimit: 200_000,
      }),
    ).toBe(0)
  })

  it("returns 0 when modelContextLimit is zero or negative", () => {
    expect(
      computeUsagePercentage({
        lastResponseTime: 0,
        lastChangeTime: 0,
        modelContextLimit: 0,
        lastTokens: { input: 100, cacheRead: 100 },
      }),
    ).toBe(0)
  })

  it("computes (input + cacheRead) / limit * 100", () => {
    expect(
      computeUsagePercentage({
        lastResponseTime: 0,
        lastChangeTime: 0,
        modelContextLimit: 100,
        lastTokens: { input: 30, cacheRead: 35 },
      }),
    ).toBe(65)
  })

  it("is consistent with thresholding at 65%", () => {
    const pct = computeUsagePercentage({
      lastResponseTime: 0,
      lastChangeTime: 0,
      modelContextLimit: 200_000,
      lastTokens: { input: 50_000, cacheRead: 80_000 },
    })
    // 130k / 200k = 65%
    expect(pct).toBe(65)
    expect(pct >= 65).toBe(true)
  })
})
