/**
 * Unit tests for seed.ts — default directory structure + starter files.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { readFile, access, mkdir, writeFile } from "fs/promises"
import path from "path"

import { ensureSeed } from "../seed"
import { parseFrontmatter } from "../frontmatter"
import { createTmpDir, cleanupTmpDir, TEST_CONFIG } from "./helpers"

let tmpDir: string

beforeEach(async () => {
  tmpDir = await createTmpDir("memfs-seed-")
})

afterEach(async () => {
  await cleanupTmpDir(tmpDir)
})

// ---------------------------------------------------------------------------
// ensureSeed
// ---------------------------------------------------------------------------

describe("ensureSeed", () => {
  it("should create system/ with persona.md, human.md, project.md", async () => {
    const seeded = await ensureSeed(tmpDir, TEST_CONFIG)
    expect(seeded).toBe(true)

    const persona = await readFile(path.join(tmpDir, "system/persona.md"), "utf-8")
    const human = await readFile(path.join(tmpDir, "system/human.md"), "utf-8")
    const project = await readFile(path.join(tmpDir, "system/project.md"), "utf-8")

    expect(persona).toBeTruthy()
    expect(human).toBeTruthy()
    expect(project).toBeTruthy()
  })

  it("should create reference/ and archive/ directories", async () => {
    await ensureSeed(tmpDir, TEST_CONFIG)

    // Directories should exist (access doesn't throw)
    await expect(access(path.join(tmpDir, "reference"))).resolves.toBeUndefined()
    await expect(access(path.join(tmpDir, "archive"))).resolves.toBeUndefined()
  })

  it("should create .gitkeep in reference/ and archive/", async () => {
    await ensureSeed(tmpDir, TEST_CONFIG)

    await expect(access(path.join(tmpDir, "reference/.gitkeep"))).resolves.toBeUndefined()
    await expect(access(path.join(tmpDir, "archive/.gitkeep"))).resolves.toBeUndefined()
  })

  it("should set correct frontmatter on seeded files", async () => {
    await ensureSeed(tmpDir, TEST_CONFIG)

    const raw = await readFile(path.join(tmpDir, "system/persona.md"), "utf-8")
    const { frontmatter, body } = parseFrontmatter(raw, "system/persona.md")

    expect(frontmatter.description).toBe("Agent identity, behavior guidelines, communication style")
    expect(frontmatter.limit).toBe(5000)
    expect(frontmatter.readonly).toBe(false)
    expect(body).toBe("")
  })

  it("should skip seeding if .md files already exist", async () => {
    // Pre-create a file
    await mkdir(path.join(tmpDir, "system"), { recursive: true })
    await writeFile(path.join(tmpDir, "system/existing.md"), "existing content")

    const seeded = await ensureSeed(tmpDir, TEST_CONFIG)
    expect(seeded).toBe(false)
  })

  it("should use config.defaultLimit for seeded files", async () => {
    const customConfig = { ...TEST_CONFIG, defaultLimit: 8000 }
    await ensureSeed(tmpDir, customConfig)

    const raw = await readFile(path.join(tmpDir, "system/persona.md"), "utf-8")
    const { frontmatter } = parseFrontmatter(raw, "system/persona.md")
    expect(frontmatter.limit).toBe(8000)
  })
})
