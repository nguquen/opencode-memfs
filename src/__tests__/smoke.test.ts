/**
 * Smoke test to verify vitest is configured correctly.
 */

import { describe, it, expect } from "vitest"

describe("smoke test", () => {
  it("should pass a basic assertion", () => {
    expect(1 + 1).toBe(2)
  })

  it("should handle async operations", async () => {
    const result = await Promise.resolve("hello")
    expect(result).toBe("hello")
  })
})
