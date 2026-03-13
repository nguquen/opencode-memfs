/**
 * Unit tests for plugin.ts — projects registry, name derivation, collision handling.
 *
 * Tests the exported registry functions. Does not test the full plugin factory
 * (that requires the @opencode-ai/plugin SDK runtime — covered by TASK-21 E2E).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { readFile, mkdir } from "fs/promises"
import path from "path"

import {
  parseProjectsRegistry,
  serializeProjectsTable,
  readRegistry,
  writeRegistry,
  resolveProjectName,
  isValidProjectName,
} from "../plugin"
import { parseFrontmatter } from "../frontmatter"
import { createTmpDir, cleanupTmpDir, TEST_CONFIG } from "./helpers"

let tmpDir: string

beforeEach(async () => {
  tmpDir = await createTmpDir("memfs-plugin-")
})

afterEach(async () => {
  await cleanupTmpDir(tmpDir)
})

// ---------------------------------------------------------------------------
// parseProjectsRegistry
// ---------------------------------------------------------------------------

describe("parseProjectsRegistry", () => {
  it("should parse a table with entries", () => {
    const body = [
      "| Project | Path | Last Seen |",
      "|---|---|---|",
      "| my-app | /home/user/my-app | 2026-03-10 |",
      "| other | /work/other | 2026-03-09 |",
    ].join("\n")

    const entries = parseProjectsRegistry(body)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({
      name: "my-app",
      path: "/home/user/my-app",
      lastSeen: "2026-03-10",
    })
    expect(entries[1]).toEqual({
      name: "other",
      path: "/work/other",
      lastSeen: "2026-03-09",
    })
  })

  it("should return empty array for empty body", () => {
    const entries = parseProjectsRegistry("")
    expect(entries).toEqual([])
  })

  it("should return empty array for header-only table", () => {
    const body = [
      "| Project | Path | Last Seen |",
      "|---|---|---|",
    ].join("\n")

    const entries = parseProjectsRegistry(body)
    expect(entries).toEqual([])
  })

  it("should handle extra whitespace in cells", () => {
    const body = [
      "| Project | Path | Last Seen |",
      "|---|---|---|",
      "|  spaced-app  |  /path/to/it  |  2026-03-10  |",
    ].join("\n")

    const entries = parseProjectsRegistry(body)
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe("spaced-app")
    expect(entries[0].path).toBe("/path/to/it")
  })

  it("should skip non-table lines", () => {
    const body = [
      "Some intro text",
      "",
      "| Project | Path | Last Seen |",
      "|---|---|---|",
      "| my-app | /path | 2026-03-10 |",
      "",
      "Some trailing text",
    ].join("\n")

    const entries = parseProjectsRegistry(body)
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe("my-app")
  })
})

// ---------------------------------------------------------------------------
// serializeProjectsTable
// ---------------------------------------------------------------------------

describe("serializeProjectsTable", () => {
  it("should serialize entries into a table", () => {
    const entries = [
      { name: "app-a", path: "/home/user/app-a", lastSeen: "2026-03-10" },
      { name: "app-b", path: "/work/app-b", lastSeen: "2026-03-09" },
    ]

    const table = serializeProjectsTable(entries)
    const lines = table.split("\n")

    expect(lines[0]).toBe("| Project | Path | Last Seen |")
    expect(lines[1]).toBe("|---|---|---|")
    expect(lines[2]).toBe("| app-a | /home/user/app-a | 2026-03-10 |")
    expect(lines[3]).toBe("| app-b | /work/app-b | 2026-03-09 |")
  })

  it("should produce header-only table for empty entries", () => {
    const table = serializeProjectsTable([])
    const lines = table.split("\n")

    expect(lines[0]).toBe("| Project | Path | Last Seen |")
    expect(lines[1]).toBe("|---|---|---|")
    expect(lines).toHaveLength(2)
  })

  it("should round-trip through parse", () => {
    const original = [
      { name: "my-project", path: "/home/user/my-project", lastSeen: "2026-03-10" },
    ]

    const serialized = serializeProjectsTable(original)
    const parsed = parseProjectsRegistry(serialized)

    expect(parsed).toEqual(original)
  })
})

// ---------------------------------------------------------------------------
// readRegistry / writeRegistry
// ---------------------------------------------------------------------------

describe("readRegistry", () => {
  it("should return empty array when file does not exist", async () => {
    const registryPath = path.join(tmpDir, "system", "projects.md")
    const entries = await readRegistry(registryPath, 5000)
    expect(entries).toEqual([])
  })

  it("should read entries from an existing registry file", async () => {
    const registryPath = path.join(tmpDir, "system", "projects.md")
    const entries = [
      { name: "test-app", path: "/test/app", lastSeen: "2026-03-10" },
    ]

    await writeRegistry(registryPath, entries, 5000)

    const result = await readRegistry(registryPath, 5000)
    expect(result).toEqual(entries)
  })
})

describe("writeRegistry", () => {
  it("should create the file with correct frontmatter", async () => {
    const registryPath = path.join(tmpDir, "system", "projects.md")
    await writeRegistry(registryPath, [], 5000)

    const raw = await readFile(registryPath, "utf-8")
    const { frontmatter } = parseFrontmatter(raw, "system/projects.md")

    expect(frontmatter.description).toBe("Registry of all known projects with their paths")
    expect(frontmatter.readonly).toBe(true)
    expect(frontmatter.limit).toBe(5000)
  })

  it("should create parent directories if they don't exist", async () => {
    const registryPath = path.join(tmpDir, "deep", "nested", "projects.md")
    await writeRegistry(registryPath, [], 5000)

    const raw = await readFile(registryPath, "utf-8")
    expect(raw).toBeTruthy()
  })

  it("should use the config defaultLimit", async () => {
    const registryPath = path.join(tmpDir, "system", "projects.md")
    await writeRegistry(registryPath, [], 8000)

    const raw = await readFile(registryPath, "utf-8")
    const { frontmatter } = parseFrontmatter(raw, "system/projects.md")
    expect(frontmatter.limit).toBe(8000)
  })

  it("should overwrite existing file with updated entries", async () => {
    const registryPath = path.join(tmpDir, "system", "projects.md")

    await writeRegistry(registryPath, [
      { name: "old", path: "/old", lastSeen: "2026-03-01" },
    ], 5000)

    await writeRegistry(registryPath, [
      { name: "old", path: "/old", lastSeen: "2026-03-01" },
      { name: "new", path: "/new", lastSeen: "2026-03-10" },
    ], 5000)

    const result = await readRegistry(registryPath, 5000)
    expect(result).toHaveLength(2)
    expect(result[1].name).toBe("new")
  })
})

// ---------------------------------------------------------------------------
// resolveProjectName
// ---------------------------------------------------------------------------

describe("resolveProjectName", () => {
  it("should derive name from basename of project directory", async () => {
    const registryPath = path.join(tmpDir, "system", "projects.md")
    const projectDir = "/home/user/projects/my-awesome-app"

    const name = await resolveProjectName(registryPath, projectDir, TEST_CONFIG)
    expect(name).toBe("my-awesome-app")
  })

  it("should register the project in the registry", async () => {
    const registryPath = path.join(tmpDir, "system", "projects.md")
    const projectDir = "/home/user/projects/test-project"

    await resolveProjectName(registryPath, projectDir, TEST_CONFIG)

    const entries = await readRegistry(registryPath, TEST_CONFIG.defaultLimit)
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe("test-project")
    expect(entries[0].path).toBe("/home/user/projects/test-project")
  })

  it("should reuse existing name for same project path", async () => {
    const registryPath = path.join(tmpDir, "system", "projects.md")
    const projectDir = "/home/user/projects/my-app"

    const name1 = await resolveProjectName(registryPath, projectDir, TEST_CONFIG)
    const name2 = await resolveProjectName(registryPath, projectDir, TEST_CONFIG)

    expect(name1).toBe("my-app")
    expect(name2).toBe("my-app")

    // Should still be only 1 entry
    const entries = await readRegistry(registryPath, TEST_CONFIG.defaultLimit)
    expect(entries).toHaveLength(1)
  })

  it("should update lastSeen for existing project", async () => {
    const registryPath = path.join(tmpDir, "system", "projects.md")
    const projectDir = "/home/user/projects/my-app"

    await resolveProjectName(registryPath, projectDir, TEST_CONFIG)
    const entries1 = await readRegistry(registryPath, TEST_CONFIG.defaultLimit)
    const firstSeen = entries1[0].lastSeen

    // Call again — lastSeen should be updated (same day in tests, so same value)
    await resolveProjectName(registryPath, projectDir, TEST_CONFIG)
    const entries2 = await readRegistry(registryPath, TEST_CONFIG.defaultLimit)

    expect(entries2[0].lastSeen).toBe(firstSeen) // same day
    expect(entries2).toHaveLength(1)
  })

  it("should handle collision by appending hash suffix", async () => {
    const registryPath = path.join(tmpDir, "system", "projects.md")

    // Register first project with basename "app"
    const name1 = await resolveProjectName(
      registryPath,
      "/home/user/projects/app",
      TEST_CONFIG,
    )
    expect(name1).toBe("app")

    // Register second project with same basename but different path
    const name2 = await resolveProjectName(
      registryPath,
      "/work/clients/app",
      TEST_CONFIG,
    )

    // Should have a hash suffix
    expect(name2).not.toBe("app")
    expect(name2).toMatch(/^app-[a-f0-9]{4}$/)

    // Both should be registered
    const entries = await readRegistry(registryPath, TEST_CONFIG.defaultLimit)
    expect(entries).toHaveLength(2)
    expect(entries[0].path).toBe("/home/user/projects/app")
    expect(entries[1].path).toBe("/work/clients/app")
  })

  it("should produce consistent hash suffix for same path", async () => {
    const registryPath = path.join(tmpDir, "system", "projects.md")

    // Register first project to create collision
    await resolveProjectName(
      registryPath,
      "/home/user/projects/app",
      TEST_CONFIG,
    )

    // Register colliding project
    const name1 = await resolveProjectName(
      registryPath,
      "/work/clients/app",
      TEST_CONFIG,
    )

    // Clean up and re-register to verify deterministic hash
    const registryPath2 = path.join(tmpDir, "system", "projects2.md")
    await resolveProjectName(
      registryPath2,
      "/home/user/projects/app",
      TEST_CONFIG,
    )
    const name2 = await resolveProjectName(
      registryPath2,
      "/work/clients/app",
      TEST_CONFIG,
    )

    expect(name1).toBe(name2)
  })

  it("should handle multiple projects without collisions", async () => {
    const registryPath = path.join(tmpDir, "system", "projects.md")

    const name1 = await resolveProjectName(registryPath, "/home/user/project-a", TEST_CONFIG)
    const name2 = await resolveProjectName(registryPath, "/home/user/project-b", TEST_CONFIG)
    const name3 = await resolveProjectName(registryPath, "/home/user/project-c", TEST_CONFIG)

    expect(name1).toBe("project-a")
    expect(name2).toBe("project-b")
    expect(name3).toBe("project-c")

    const entries = await readRegistry(registryPath, TEST_CONFIG.defaultLimit)
    expect(entries).toHaveLength(3)
  })

  it("should handle empty registry file gracefully", async () => {
    const registryPath = path.join(tmpDir, "system", "projects.md")

    // File doesn't exist — should create it
    const name = await resolveProjectName(registryPath, "/test/project", TEST_CONFIG)
    expect(name).toBe("project")
  })

})

describe("isValidProjectName", () => {
  it("should accept normal project names", () => {
    expect(isValidProjectName("my-project")).toBe(true)
    expect(isValidProjectName("opencode-memfs")).toBe(true)
    expect(isValidProjectName("app")).toBe(true)
    expect(isValidProjectName("my_project_v2")).toBe(true)
    expect(isValidProjectName("project.config")).toBe(true)
  })

  it("should reject empty names", () => {
    expect(isValidProjectName("")).toBe(false)
  })

  it("should reject names over 64 characters", () => {
    expect(isValidProjectName("a".repeat(65))).toBe(false)
  })

  it("should reject base64-encoded paths", () => {
    // /tmp (short base64)
    expect(isValidProjectName("L3RtcA")).toBe(false)
    // /home/user (previously slipped through length heuristic)
    expect(isValidProjectName("L2hvbWUvdXNlcg")).toBe(false)
    // /home/user/projects
    expect(isValidProjectName("L2hvbWUvdXNlci9wcm9qZWN0cw")).toBe(false)
    // /home/user/projects/my-app
    expect(isValidProjectName("L2hvbWUvdXNlci9wcm9qZWN0cy9teS1hcHA")).toBe(false)
  })

  it("should accept short alphanumeric names", () => {
    // Short names shouldn't be falsely flagged as base64
    expect(isValidProjectName("webapp")).toBe(true)
    expect(isValidProjectName("jobs")).toBe(true)
    expect(isValidProjectName("x123")).toBe(true)
  })
})
