# AGENTS.md — opencode-memfs

OpenCode memory plugin — git-backed, two-tier hot/cold MemFS with progressive disclosure.
All memory operations go through 9 dedicated custom tools (`memory_read`, `memory_write`, etc.)
for full isolation from core file tools.

## Build / Dev Commands

```bash
npm run build          # tsc — compile to dist/
npm run dev            # tsc --watch — incremental rebuild
npm run clean          # rm -rf dist
npx tsc --noEmit       # type-check without emitting
```

No test runner is configured yet. No linter is configured yet.
When tests are added, document the single-test command here.

## Project Structure

```
src/
├── index.ts           # Public entry point — re-exports MemFSPlugin
├── plugin.ts          # Plugin factory, hook registration, lifecycle
├── tools.ts           # 9 tool handlers (read/write/edit/delete/promote/demote/tree/history/rollback)
├── store.ts           # Memory FS operations (scan dirs, read files, build tree)
├── prompt.ts          # System prompt <memfs> XML rendering (tree + hot content)
├── git.ts             # Git operations via simple-git (init, commit, log, rollback)
├── watcher.ts         # fs.watch + debounce for auto-commit
├── frontmatter.ts     # YAML frontmatter parse/serialize + atomic writes (tmp+rename)
├── seed.ts            # First-run directory structure + starter files
├── config.ts          # Zod schema + loader for ~/.config/opencode/memfs.json
└── types.ts           # Shared type definitions (MemoryFile, MemoryFrontmatter, etc.)
```

## Architecture

### Two-Tier Memory

- **Hot (`system/`)** — full content pinned in system prompt every turn
- **Cold (`reference/`, `archive/`)** — path + description in tree listing, read on demand via `memory_read`

### Plugin API

The plugin conforms to `Plugin` from `@opencode-ai/plugin`:

```ts
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

export const MemFSPlugin: Plugin = async (ctx) => {
  // ctx provides: client, project, directory, worktree
  return {
    tool: {
      memory_read: tool({
        description: "Read a memory file",
        args: { path: tool.schema.string() },
        async execute(args, context) { return "result" }
      }),
    },
    "experimental.chat.system.transform": async (input, output) => {
      output.system.splice(1, 0, renderedBlock)
    },
  }
}
```

### Key Hooks

- `tool` — registers all 9 memory tools
- `experimental.chat.system.transform` — injects `<memfs>` block at position 1 in system prompt

### Git Versioning

Each memory directory (project + global) is its own git repo. The watcher auto-commits
on file change with a 2-second debounce. Tools write to disk; watcher handles git.

## Dependencies

| Package | Purpose |
|---|---|
| `@opencode-ai/plugin` | Plugin SDK — `Plugin` type, `tool()` helper |
| `js-yaml` | YAML frontmatter parse/serialize |
| `simple-git` | Git operations (init, add, commit, log, checkout) |
| `zod` | Config validation (Zod v3 for our schemas) |

**Note:** `@opencode-ai/plugin` bundles its own Zod v4 internally. Use `tool.schema.*` for
tool arg schemas (Zod v4). Use the project's `zod` import for config/frontmatter validation (Zod v3).

## Code Style

### TypeScript

- **Strict mode** — `strict: true` in tsconfig. No implicit `any`. Explicit return types on public functions.
- **`import type`** for type-only imports — required by `isolatedModules: true`.
- **ES2022 target** — modern syntax is fine (optional chaining, nullish coalescing, `Array.at()`, etc.)
- **Module system** — ESM (`import`/`export`). `module: "preserve"` with bundler resolution.
- **No `const enum`** — forbidden by `isolatedModules`.

### Naming Conventions

| Thing | Convention | Example |
|---|---|---|
| Files | `camelCase.ts` | `frontmatter.ts`, `store.ts` |
| Exported values | `PascalCase` | `MemFSPlugin` |
| Functions/variables | `camelCase` | `ensureSeed()`, `renderTree()` |
| Types/interfaces | `PascalCase` | `MemoryFile`, `MemoryFrontmatter` |
| Tool names | `snake_case` with `memory_` prefix | `memory_read`, `memory_promote` |
| Config keys | `camelCase` | `hotDir`, `defaultLimit` |

### Formatting

- **2-space indentation**
- **Double quotes** for strings
- **Named exports only** — no default exports
- Re-export pattern: `export { X } from "./module"`

### Imports

Order imports in this sequence:
1. Node built-ins (`fs`, `path`)
2. External packages (`js-yaml`, `simple-git`, `zod`)
3. Plugin SDK (`@opencode-ai/plugin`)
4. Internal modules (`./store`, `./types`)

Separate groups with a blank line. Use `import type` for type-only imports.

```ts
import { readFile } from "fs/promises"
import path from "path"

import yaml from "js-yaml"
import { z } from "zod"

import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import type { MemoryFile } from "./types"
import { parseMemoryFile } from "./frontmatter"
```

### Comments

- **JSDoc block** at the top of every file explaining its purpose
- **Inline TODOs** reference task IDs: `// TODO: TASK-NN — description`
- Prefer self-documenting code over inline comments

### Error Handling

- Validate inputs early with Zod schemas; surface errors clearly
- Use `try/catch` around file and git operations — degrade gracefully, never crash the plugin
- Return descriptive error messages from tools (the agent sees them)
- Atomic file writes via tmp+rename to prevent corruption

### Frontmatter Contract

Every memory file uses YAML frontmatter:

```yaml
---
description: "What this file contains and when to reference it"
limit: 5000
readonly: false
---
```

Auto-generate defaults when omitted:
- `description` — humanized from filename
- `limit` — `5000`
- `readonly` — `false`

Sort YAML keys alphabetically for deterministic diffs.

## Git Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/) with the TASK-ID as scope:

```
<type>(TASK-<N>): <description>
```

### Types

| Type | When to use |
|---|---|
| `feat` | New feature or functionality |
| `fix` | Bug fix |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `chore` | Build, config, tooling, or dependency changes |
| `docs` | Documentation only |
| `test` | Adding or updating tests |

### Examples

```
feat(TASK-18): implement memory_read tool handler
fix(TASK-13): handle missing .git directory on first init
refactor(TASK-14): extract file scanner into separate function
chore(TASK-9): add .gitignore and clean up node_modules
docs(TASK-20): add usage and config docs to README
test(TASK-11): add frontmatter parse/serialize tests
```

If a commit spans multiple tasks, use the primary task. If no task applies, omit the scope:

```
chore: update dependencies
```

## Task Tracking

Tasks are tracked in the memento vault at `/workspaces/memento/01 Projects/OpenCode MemFS/Tasks/`.
Each task file has an `id` field (e.g., `TASK-9`, `TASK-10`). Source code TODOs reference
these IDs. Current task range: TASK-9 through TASK-19.
