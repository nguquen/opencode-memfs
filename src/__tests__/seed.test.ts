/**
 * Unit tests for seed.ts — default directory structure + starter files.
 *
 * Seeds are split by scope:
 * - Global: persona.md, human.md, projects.md + reference/
 * - Project: persona.md, human.md, project.md, handoff.md + reference/, archive/
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
  it("should create system/ with persona.md, human.md, project.md, and handoff.md", async () => {
    const seeded = await ensureSeed(tmpDir, TEST_CONFIG, "project")
    expect(seeded).toBe(true)

    const persona = await readFile(path.join(tmpDir, "system/persona.md"), "utf-8")
    expect(persona).toBeTruthy()

    const human = await readFile(path.join(tmpDir, "system/human.md"), "utf-8")
    expect(human).toBeTruthy()

    const project = await readFile(path.join(tmpDir, "system/project.md"), "utf-8")
    expect(project).toBeTruthy()

    const handoff = await readFile(path.join(tmpDir, "system/handoff.md"), "utf-8")
    expect(handoff).toBeTruthy()

    // projects.md should NOT exist in project scope (global only)
    await expect(access(path.join(tmpDir, "system/projects.md"))).rejects.toThrow()
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

  it("should set project-scoped persona.md and human.md as supplement-aware", async () => {
    await ensureSeed(tmpDir, TEST_CONFIG, "project")

    const personaRaw = await readFile(path.join(tmpDir, "system/persona.md"), "utf-8")
    const { frontmatter: personaFm } = parseFrontmatter(personaRaw, "system/persona.md")
    expect(personaFm.readonly).toBe(false)
    expect(personaFm.description).toContain("supplements the global persona")

    const humanRaw = await readFile(path.join(tmpDir, "system/human.md"), "utf-8")
    const { frontmatter: humanFm } = parseFrontmatter(humanRaw, "system/human.md")
    expect(humanFm.readonly).toBe(false)
    expect(humanFm.description).toContain("supplements the global human profile")
  })

  it("should set canOverrideDescription to false on all project seed files", async () => {
    await ensureSeed(tmpDir, TEST_CONFIG, "project")

    const seedPaths = [
      "system/persona.md",
      "system/human.md",
      "system/project.md",
      "system/handoff.md",
    ]

    for (const seedPath of seedPaths) {
      const raw = await readFile(path.join(tmpDir, seedPath), "utf-8")
      const { frontmatter } = parseFrontmatter(raw, seedPath)
      expect(frontmatter.canOverrideDescription).toBe(false)
    }
  })

  it("should set correct frontmatter on project.md", async () => {
    await ensureSeed(tmpDir, TEST_CONFIG, "project")

    const raw = await readFile(path.join(tmpDir, "system/project.md"), "utf-8")
    const { frontmatter, body } = parseFrontmatter(raw, "system/project.md")

    expect(frontmatter.description).toBe(
      "Key context, decisions, current state, conventions — scannable cheat sheet\n" +
      "Update when: you learn what the project is about, its purpose, or current state\n" +
      "Update when: key decisions or conventions are established\n" +
      "Update when: you discover build commands, architecture, or important paths\n" +
      "Not limited to code — research topics, document structures, and workflows count"
    )
    expect(frontmatter.limit).toBe(5000)
    expect(frontmatter.readonly).toBe(false)
    expect(body).toContain("New project")
    expect(body).toContain("explore the project")
  })

  it("should set correct frontmatter on handoff.md", async () => {
    await ensureSeed(tmpDir, TEST_CONFIG, "project")

    const raw = await readFile(path.join(tmpDir, "system/handoff.md"), "utf-8")
    const { frontmatter, body } = parseFrontmatter(raw, "system/handoff.md")

    expect(frontmatter.description).toBe(
      "Session continuity — record what you're working on so the next session can pick up where you left off\n" +
      "Update when: beginning work that involves multiple steps — capture the goal, plan, and relevant files\n" +
      "Update when: completing a step or making progress — update what's done and what remains\n" +
      "Update when: key decisions or discoveries are made — preserve context that would be lost between sessions\n" +
      "Update when: work is finished — clear or summarize the outcome"
    )
    expect(frontmatter.limit).toBe(5000)
    expect(frontmatter.readonly).toBe(false)
    expect(body).toBe("")
  })

  it("should not overwrite existing seed files", async () => {
    await mkdir(path.join(tmpDir, "system"), { recursive: true })
    await writeFile(path.join(tmpDir, "system/project.md"), "custom content")

    await ensureSeed(tmpDir, TEST_CONFIG, "project")

    // project.md should keep its custom content
    const raw = await readFile(path.join(tmpDir, "system/project.md"), "utf-8")
    expect(raw).toBe("custom content")
  })

  it("should backfill missing seed files in existing stores", async () => {
    // Simulate existing store with only project.md
    await mkdir(path.join(tmpDir, "system"), { recursive: true })
    await writeFile(path.join(tmpDir, "system/project.md"), "existing project")

    const created = await ensureSeed(tmpDir, TEST_CONFIG, "project")
    expect(created).toBe(true)

    // handoff.md should have been backfilled
    const handoff = await readFile(path.join(tmpDir, "system/handoff.md"), "utf-8")
    expect(handoff).toBeTruthy()

    // project.md should NOT have been overwritten
    const project = await readFile(path.join(tmpDir, "system/project.md"), "utf-8")
    expect(project).toBe("existing project")
  })

  it("should return false when all seed files already exist", async () => {
    // First run creates everything
    await ensureSeed(tmpDir, TEST_CONFIG, "project")

    // Second run should find nothing to create
    const created = await ensureSeed(tmpDir, TEST_CONFIG, "project")
    expect(created).toBe(false)
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

    // project.md and handoff.md should NOT exist in global scope (project only)
    await expect(access(path.join(tmpDir, "system/project.md"))).rejects.toThrow()
    await expect(access(path.join(tmpDir, "system/handoff.md"))).rejects.toThrow()
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

  it("should set persona.md and human.md as non-readonly with multi-line descriptions", async () => {
    await ensureSeed(tmpDir, TEST_CONFIG, "global")

    const personaRaw = await readFile(path.join(tmpDir, "system/persona.md"), "utf-8")
    const { frontmatter: personaFm } = parseFrontmatter(personaRaw, "system/persona.md")
    expect(personaFm.readonly).toBe(false)
    expect(personaFm.description).toBe(
      "Agent identity, behavior guidelines, communication style\n" +
      `Update when: user names you or customizes your identity ("call yourself...", "you are...")\n` +
      `Update when: user tells you how to behave ("be more concise", "ask before doing X")\n` +
      "Update when: you learn what tone, verbosity, or proactivity level works for this user"
    )

    const humanRaw = await readFile(path.join(tmpDir, "system/human.md"), "utf-8")
    const { frontmatter: humanFm } = parseFrontmatter(humanRaw, "system/human.md")
    expect(humanFm.readonly).toBe(false)
    expect(humanFm.description).toBe(
      "User preferences, habits, constraints, working style\n" +
      `Update when: user states a preference or constraint ("I prefer...", "don't...", "always...")\n` +
      "Update when: user corrects you — record what they wanted instead\n" +
      "Update when: you observe a pattern across interactions (e.g., consistently asks for concise answers)"
    )
  })

  it("should set canOverrideDescription to false on all global seed files", async () => {
    await ensureSeed(tmpDir, TEST_CONFIG, "global")

    const seedPaths = [
      "system/persona.md",
      "system/human.md",
      "system/projects.md",
    ]

    for (const seedPath of seedPaths) {
      const raw = await readFile(path.join(tmpDir, seedPath), "utf-8")
      const { frontmatter } = parseFrontmatter(raw, seedPath)
      expect(frontmatter.canOverrideDescription).toBe(false)
    }
  })
})
