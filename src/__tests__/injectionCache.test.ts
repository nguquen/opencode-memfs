/**
 * Integration tests for the injection cache (TASK-111).
 *
 * Exercises `runSystemTransform` — the exported transform pipeline used by
 * `experimental.chat.system.transform` — to verify the acceptance bullets:
 *
 *   1. Identical memory state → byte-identical render across N calls
 *   2. 10 writes within TTL at low pressure → 1 render rebuild
 *   3. 10 writes at ≥ threshold pressure  → 10 render rebuilds
 *   4. memory_read after deferred writes returns the latest disk content
 *   5. memory_promote always triggers refresh on the next transform
 *   6. Cold file changes alone do not change the hash
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import path from "path"

import { runSystemTransform } from "../plugin"
import { RenderCache } from "../renderCache"
import { SessionMetaStore } from "../sessionMeta"
import { createMemoryWrite, createMemoryRead, createMemoryPromote, createMemoryFlush } from "../tools"
import type { MemFSState } from "../tools"
import { createTmpDir, cleanupTmpDir, createTestState, writeTestFile } from "./helpers"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string
let state: MemFSState

beforeEach(async () => {
  tmpDir = await createTmpDir("memfs-injcache-")
  const base = await createTestState(tmpDir)

  state = {
    ...base,
    sessionMeta: new SessionMetaStore(),
    renderCache: new RenderCache(),
    forceBustGeneration: { value: 0 },
  }

  // Seed a hot file so there is content to hash/render.
  await writeTestFile(
    tmpDir,
    "system/persona.md",
    `---\ndescription: "Agent identity"\nlimit: 5000\nreadonly: false\n---\n\nYou are Botbeech.\n`,
  )
})

afterEach(async () => {
  await cleanupTmpDir(tmpDir)
})

/** Write to a hot file through the `memory_write` tool. */
async function writeHot(contents: string): Promise<void> {
  const writeTool = createMemoryWrite(state)
  const result = await writeTool.execute(
    { path: "system/persona.md", scope: "project", content: contents },
    {} as never,
  )
  // sanity: no error
  if (typeof result === "string" && result.startsWith("Error")) {
    throw new Error(result)
  }
}

/** Call transform in a low-pressure steady state. */
async function transform(now: number = Date.now()): Promise<string> {
  return runSystemTransform(state, {
    sessionID: "sess-1",
    modelContextLimit: 200_000,
    now,
  })
}

/** Count how many distinct renders landed in the cache over N calls. */
async function countRebuildsOver(
  n: number,
  mutate: (i: number) => Promise<void>,
  transformArgs: Parameters<typeof runSystemTransform>[1] = {
    sessionID: "sess-1",
    modelContextLimit: 200_000,
  },
): Promise<number> {
  const seenBlocks = new Set<string>()
  for (let i = 0; i < n; i++) {
    await mutate(i)
    const block = await runSystemTransform(state, transformArgs)
    seenBlocks.add(block)
  }
  return seenBlocks.size
}

// ---------------------------------------------------------------------------
// Acceptance: byte-identity across identical states
// ---------------------------------------------------------------------------

describe("injection cache — byte-identity", () => {
  it("produces byte-identical bytes across N calls on unchanged state", async () => {
    const first = await transform()
    const blocks = new Set<string>([first])

    for (let i = 0; i < 5; i++) {
      blocks.add(await transform())
    }

    expect(blocks.size).toBe(1)
  })

  it("records exactly one render for 10 consecutive low-pressure hot-file edits within TTL", async () => {
    // Bootstrap so the first transform caches an entry (rules out the 'first' branch).
    await transform()

    const rebuilds = await countRebuildsOver(10, async (i) => {
      await writeHot(`You are Botbeech. Iteration ${i}.`)
    })

    // Each edit changes the hash, but every rebuild is deferred under TTL/low pressure.
    // All 10 transforms should serve the same bytes (= the original cached block).
    expect(rebuilds).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Acceptance: pressure overrides freshness
// ---------------------------------------------------------------------------

describe("injection cache — pressure", () => {
  it("rebuilds on every transform when usage ≥ threshold", async () => {
    // Seed the cache and simulate sustained high pressure via message.updated data.
    await transform()
    const meta = state.sessionMeta!.getOrCreate("sess-1")
    meta.modelContextLimit = 200_000
    meta.lastTokens = { input: 130_000, cacheRead: 0 } // 65%

    const rebuilds = await countRebuildsOver(10, async (i) => {
      await writeHot(`You are Botbeech. Iter ${i}.`)
    })

    // 10 distinct edits × pressure-every-turn = 10 distinct rebuilds.
    expect(rebuilds).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// Acceptance: TTL elapsed
// ---------------------------------------------------------------------------

describe("injection cache — TTL", () => {
  it("rebuilds once TTL has elapsed since lastResponseTime", async () => {
    const t0 = 1_000_000
    await transform(t0)

    // Edit but stay within TTL — should serve cached.
    await writeHot("You are Botbeech. Edit 1.")
    const stale = await transform(t0 + 30_000) // 30s later, TTL=5m
    const seeded = await transform(t0)
    expect(stale).toBe(seeded) // same bytes

    // Advance past TTL — should refresh.
    state.sessionMeta!.getOrCreate("sess-1").lastResponseTime = t0
    const fresh = await transform(t0 + 6 * 60 * 1000) // 6m later
    expect(fresh).not.toBe(stale)
  })
})

// ---------------------------------------------------------------------------
// Acceptance: promote / demote always force-refresh
// ---------------------------------------------------------------------------

describe("injection cache — promote/demote", () => {
  it("memory_promote forces a refresh on the next transform regardless of TTL/pressure", async () => {
    // Seed with a cold reference file.
    await writeTestFile(
      tmpDir,
      "reference/debugging.md",
      `---\ndescription: "Debugging patterns"\nlimit: 5000\nreadonly: false\n---\n\nContent.\n`,
    )

    // Prime cache.
    const before = await transform()

    // Promote under no pressure, well within TTL.
    const promote = createMemoryPromote(state)
    const result = await promote.execute(
      { path: "reference/debugging.md", scope: "project" },
      {} as never,
    )
    expect(String(result)).toMatch(/Promoted/)

    // Next transform must rebuild (forced branch).
    const after = await transform()
    expect(after).not.toBe(before)

    // A subsequent transform with no further changes is byte-identical again.
    const again = await transform()
    expect(again).toBe(after)
  })

  it("memory_flush bumps the force-bust counter", async () => {
    await transform()
    const before = state.forceBustGeneration!.value

    const flush = createMemoryFlush(state)
    await flush.execute({}, {} as never)

    expect(state.forceBustGeneration!.value).toBe(before + 1)
  })
})

// ---------------------------------------------------------------------------
// Acceptance: consistency > cache — reads are always live
// ---------------------------------------------------------------------------

describe("injection cache — consistency", () => {
  it("memory_read returns the latest disk content even while the render is stale", async () => {
    await transform()

    await writeHot("You are Botbeech. Fresh disk content.")

    // Cache still serves stale bytes (low pressure, within TTL).
    const staleBlock = await transform()
    // Ensure the stale block does NOT mention the new content.
    expect(staleBlock.includes("Fresh disk content")).toBe(false)

    // But memory_read must see the disk update.
    const read = createMemoryRead(state)
    // memory_read requires reading through frontmatter; we'll register it then call.
    const body = await read.execute(
      { path: "system/persona.md", scope: "project" },
      {} as never,
    )
    expect(String(body)).toContain("Fresh disk content")
  })
})

// ---------------------------------------------------------------------------
// Acceptance: cold-file body changes don't change the hash
// ---------------------------------------------------------------------------

describe("injection cache — cold content exclusion", () => {
  it("changes to a cold file's BODY (not description) do not bust the cache", async () => {
    await writeTestFile(
      tmpDir,
      "reference/notes.md",
      `---\ndescription: "Notes"\nlimit: 5000\nreadonly: false\n---\n\nOld body, same length.\n`,
    )

    const first = await transform()

    // Overwrite the body with equal-length content — char count unchanged, description unchanged.
    await writeTestFile(
      tmpDir,
      "reference/notes.md",
      `---\ndescription: "Notes"\nlimit: 5000\nreadonly: false\n---\n\nNew body, same length.\n`,
    )

    const second = await transform()
    // Cache still serves the same bytes because cold body is not in the hash.
    expect(second).toBe(first)
  })
})

// ---------------------------------------------------------------------------
// Acceptance: sessions are isolated
// ---------------------------------------------------------------------------

describe("injection cache — session isolation", () => {
  it("two sessions maintain independent caches", async () => {
    const a1 = await runSystemTransform(state, {
      sessionID: "a",
      modelContextLimit: 200_000,
    })
    const b1 = await runSystemTransform(state, {
      sessionID: "b",
      modelContextLimit: 200_000,
    })
    expect(a1).toBe(b1) // same memory state → same render for first turn

    // Mutate memory, but only re-render for session "a" — session "b" is still unserved.
    await writeHot("You are Botbeech. Post-edit.")
    const a2 = await runSystemTransform(state, {
      sessionID: "a",
      modelContextLimit: 200_000,
    })
    expect(a2).toBe(a1) // stale served for "a" under TTL

    // Session "b"'s cached entry should be unaffected.
    expect(state.renderCache!.get("b")?.block).toBe(b1)
  })
})
