/**
 * Unit tests for config.ts — Zod schema + config loading.
 */

import { describe, it, expect } from "vitest"

import { MemFSConfigSchema, DEFAULT_CONFIG } from "../config"

// ---------------------------------------------------------------------------
// MemFSConfigSchema
// ---------------------------------------------------------------------------

describe("MemFSConfigSchema", () => {
  it("should accept a valid full config", () => {
    const result = MemFSConfigSchema.safeParse({
      hotDir: "hot",
      defaultLimit: 10000,
      autoCommitDebounceMs: 5000,
      maxTreeDepth: 5,
      globalMemoryEnabled: false,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.hotDir).toBe("hot")
      expect(result.data.defaultLimit).toBe(10000)
      expect(result.data.autoCommitDebounceMs).toBe(5000)
      expect(result.data.maxTreeDepth).toBe(5)
      expect(result.data.globalMemoryEnabled).toBe(false)
    }
  })

  it("should fill all defaults for empty object", () => {
    const result = MemFSConfigSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual(DEFAULT_CONFIG)
    }
  })

  it("should fill defaults for partial config", () => {
    const result = MemFSConfigSchema.safeParse({
      hotDir: "custom",
      defaultLimit: 8000,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.hotDir).toBe("custom")
      expect(result.data.defaultLimit).toBe(8000)
      expect(result.data.autoCommitDebounceMs).toBe(2000) // default
      expect(result.data.maxTreeDepth).toBe(3) // default
      expect(result.data.globalMemoryEnabled).toBe(true) // default
    }
  })

  it("should reject invalid hotDir type", () => {
    const result = MemFSConfigSchema.safeParse({ hotDir: 42 })
    expect(result.success).toBe(false)
  })

  it("should reject negative defaultLimit", () => {
    const result = MemFSConfigSchema.safeParse({ defaultLimit: -100 })
    expect(result.success).toBe(false)
  })

  it("should reject zero defaultLimit", () => {
    const result = MemFSConfigSchema.safeParse({ defaultLimit: 0 })
    expect(result.success).toBe(false)
  })

  it("should reject non-integer defaultLimit", () => {
    const result = MemFSConfigSchema.safeParse({ defaultLimit: 5000.5 })
    expect(result.success).toBe(false)
  })

  it("should reject negative autoCommitDebounceMs", () => {
    const result = MemFSConfigSchema.safeParse({ autoCommitDebounceMs: -1 })
    expect(result.success).toBe(false)
  })

  it("should accept zero autoCommitDebounceMs (no debounce)", () => {
    const result = MemFSConfigSchema.safeParse({ autoCommitDebounceMs: 0 })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.autoCommitDebounceMs).toBe(0)
    }
  })

  it("should reject zero maxTreeDepth", () => {
    const result = MemFSConfigSchema.safeParse({ maxTreeDepth: 0 })
    expect(result.success).toBe(false)
  })

  it("should reject non-boolean globalMemoryEnabled", () => {
    const result = MemFSConfigSchema.safeParse({ globalMemoryEnabled: "yes" })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// DEFAULT_CONFIG
// ---------------------------------------------------------------------------

describe("DEFAULT_CONFIG", () => {
  it("should have expected default values", () => {
    expect(DEFAULT_CONFIG.hotDir).toBe("system")
    expect(DEFAULT_CONFIG.defaultLimit).toBe(5000)
    expect(DEFAULT_CONFIG.autoCommitDebounceMs).toBe(2000)
    expect(DEFAULT_CONFIG.maxTreeDepth).toBe(3)
    expect(DEFAULT_CONFIG.globalMemoryEnabled).toBe(true)
  })
})
