/**
 * Unit tests for cacheTtl.ts — parseCacheTtl (TASK-111).
 */

import { describe, it, expect } from "vitest"

import { parseCacheTtl } from "../cacheTtl"

describe("parseCacheTtl", () => {
  it("parses seconds", () => {
    expect(parseCacheTtl("30s")).toBe(30_000)
    expect(parseCacheTtl("1s")).toBe(1_000)
  })

  it("parses minutes", () => {
    expect(parseCacheTtl("5m")).toBe(300_000)
    expect(parseCacheTtl("10m")).toBe(600_000)
  })

  it("parses hours", () => {
    expect(parseCacheTtl("1h")).toBe(3_600_000)
    expect(parseCacheTtl("2h")).toBe(7_200_000)
  })

  it("parses days", () => {
    expect(parseCacheTtl("1d")).toBe(86_400_000)
  })

  it("parses milliseconds with suffix", () => {
    expect(parseCacheTtl("500ms")).toBe(500)
    expect(parseCacheTtl("1500ms")).toBe(1500)
  })

  it("treats a bare number string as milliseconds", () => {
    expect(parseCacheTtl("1000")).toBe(1000)
  })

  it("treats a raw number as milliseconds", () => {
    expect(parseCacheTtl(1000)).toBe(1000)
    expect(parseCacheTtl(0)).toBe(0)
  })

  it("accepts decimal values", () => {
    expect(parseCacheTtl("0.5s")).toBe(500)
    expect(parseCacheTtl("2.5m")).toBe(150_000)
  })

  it("is case-insensitive", () => {
    expect(parseCacheTtl("5M")).toBe(300_000)
    expect(parseCacheTtl("30S")).toBe(30_000)
    expect(parseCacheTtl("500MS")).toBe(500)
  })

  it("tolerates surrounding whitespace", () => {
    expect(parseCacheTtl("  5m  ")).toBe(300_000)
  })

  it("rejects negative numbers", () => {
    expect(() => parseCacheTtl(-1)).toThrow()
    expect(() => parseCacheTtl("-5m")).toThrow()
  })

  it("rejects non-finite numbers", () => {
    expect(() => parseCacheTtl(NaN)).toThrow()
    expect(() => parseCacheTtl(Infinity)).toThrow()
  })

  it("rejects garbage strings", () => {
    expect(() => parseCacheTtl("forever")).toThrow()
    expect(() => parseCacheTtl("5x")).toThrow()
    expect(() => parseCacheTtl("")).toThrow()
  })

  it("rejects wrong-type inputs", () => {
    // @ts-expect-error — deliberately wrong type
    expect(() => parseCacheTtl(null)).toThrow()
    // @ts-expect-error — deliberately wrong type
    expect(() => parseCacheTtl(undefined)).toThrow()
    // @ts-expect-error — deliberately wrong type
    expect(() => parseCacheTtl({})).toThrow()
  })
})
