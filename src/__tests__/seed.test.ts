/**
 * Unit tests for seed.ts — default directory structure + starter files.
 *
 * Seeds are split by scope:
 * - Global: persona.md, human.md, projects.md + reference/
 * - Project: project.md + reference/, archive/
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
// ensureSeed — project scope
// ---------------------------------------------------------------------------

describe("ensureSeed (project)", () => {
  it("should create system/ with only project.md", async () => {
    const seeded = await ensureSeed(tmpDir, TEST_CONFIG, "project")
    expect(seeded).toBe(true)

    const project = await readFile(path.join(tmpDir, "system/project.md"), "utf-8")
    expect(project).toBeTruthy()

    // persona.md and human.md should NOT exist in project scope
    await expect(access(path.join(tmpDir, "system/persona.md"))).rejects.toThrow()
    await expect(access(path.join(tmpDir, "system/human.md"))).rejects.toThrow()
  })

  it("should create reference/ and archive/ directories", async () => {
    await ensureSeed(tmpDir, TEST_CONFIG, "project")

    await expect(access(path.join(tmpDir, "reference"))).resolves.toBeUndefined()
    await expect(access(path.join(tmpDir, "archive"))).resolves.toBeUndefined()
  })

  it("should create .gitkeep in reference/ and archive/", async () => {
    await ensureSeed(tmpDir, TEST_CONFIG, "project")

    await expect(access(path.join(tmpDir, "reference/.gitkeep"))).resolves.toBeUndefined()
    await expect(access(path.join(tmpDir, "archive/.gitkeep"))).resolves.toBeUndefined()
  })

  it("should set correct frontmatter on project.md", async () => {
    await ensureSeed(tmpDir, TEST_CONFIG, "project")

    const raw = await readFile(path.join(tmpDir, "system/project.md"), "utf-8")
    const { frontmatter, body } = parseFrontmatter(raw, "system/project.md")

    expect(frontmatter.description).toBe("Build/test commands, key paths, architecture, gotchas — scannable cheat sheet, not an essay")
    expect(frontmatter.limit).toBe(5000)
    expect(frontmatter.readonly).toBe(false)
    expect(body).toBe("")
  })

  it("should skip seeding if .md files already exist", async () => {
    await mkdir(path.join(tmpDir, "system"), { recursive: true })
    await writeFile(path.join(tmpDir, "system/existing.md"), "existing content")

    const seeded = await ensureSeed(tmpDir, TEST_CONFIG, "project")
    expect(seeded).toBe(false)
  })

  it("should use config.defaultLimit for seeded files", async () => {
    const customConfig = { ...TEST_CONFIG, defaultLimit: 8000 }
    await ensureSeed(tmpDir, customConfig, "project")

    const raw = await readFile(path.join(tmpDir, "system/project.md"), "utf-8")
    const { frontmatter } = parseFrontmatter(raw, "system/project.md")
    expect(frontmatter.limit).toBe(8000)
  })
})

// ---------------------------------------------------------------------------
// ensureSeed — global scope
// ---------------------------------------------------------------------------

describe("ensureSeed (global)", () => {
  it("should create system/ with persona.md, human.md, projects.md", async () => {
    const seeded = await ensureSeed(tmpDir, TEST_CONFIG, "global")
    expect(seeded).toBe(true)

    const persona = await readFile(path.join(tmpDir, "system/persona.md"), "utf-8")
    const human = await readFile(path.join(tmpDir, "system/human.md"), "utf-8")
    const projects = await readFile(path.join(tmpDir, "system/projects.md"), "utf-8")

    expect(persona).toBeTruthy()
    expect(human).toBeTruthy()
    expect(projects).toBeTruthy()

    // project.md should NOT exist in global scope
    await expect(access(path.join(tmpDir, "system/project.md"))).rejects.toThrow()
  })

  it("should create reference/ but not archive/", async () => {
    await ensureSeed(tmpDir, TEST_CONFIG, "global")

    await expect(access(path.join(tmpDir, "reference"))).resolves.toBeUndefined()
    await expect(access(path.join(tmpDir, "archive"))).rejects.toThrow()
  })

  it("should set projects.md as readonly", async () => {
    await ensureSeed(tmpDir, TEST_CONFIG, "global")

    const raw = await readFile(path.join(tmpDir, "system/projects.md"), "utf-8")
    const { frontmatter } = parseFrontmatter(raw, "system/projects.md")

    expect(frontmatter.description).toBe("Registry of all known projects with their paths")
    expect(frontmatter.readonly).toBe(true)
  })

  it("should set persona.md and human.md as non-readonly", async () => {
    await ensureSeed(tmpDir, TEST_CONFIG, "global")

    const personaRaw = await readFile(path.join(tmpDir, "system/persona.md"), "utf-8")
    const { frontmatter: personaFm } = parseFrontmatter(personaRaw, "system/persona.md")
    expect(personaFm.readonly).toBe(false)

    const humanRaw = await readFile(path.join(tmpDir, "system/human.md"), "utf-8")
    const { frontmatter: humanFm } = parseFrontmatter(humanRaw, "system/human.md")
    expect(humanFm.readonly).toBe(false)
  })
})
