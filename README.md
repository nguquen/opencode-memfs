# opencode-memfs

Git-backed, two-tier hot/cold memory plugin for [OpenCode](https://github.com/anomalyco/opencode). Gives your agent persistent memory across sessions with automatic git versioning.

## How It Works

Memory files are plain markdown with YAML frontmatter, organized into two tiers:

- **Hot (`system/`)** — Full content is pinned in the system prompt every turn. Use for high-signal, always-relevant context (persona, user prefs, project conventions).
- **Cold (`reference/`, `archive/`, etc.)** — Only the path and description appear in a tree listing. The agent reads cold files on demand via `memory_read`. Use for reference material, debugging notes, historical context.

All changes are automatically committed to a local git repo via a filesystem watcher (2s debounce). The agent can browse history and roll back with `memory_history` / `memory_rollback`.

## Installation

Add to your OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "plugin": ["opencode-memfs"]
}
```

Optionally, pin to a specific version:

```json
{
  "plugin": ["opencode-memfs@0.0.2"]
}
```

Restart OpenCode and you're ready to go. OpenCode fetches unpinned plugins from npm on each startup; pinned versions are cached.

## Directory Structure

All memory is centralized under `~/.config/opencode/memory/` in a single git repo:

```
~/.config/opencode/memory/               # Single git repo, single watcher
├── global/                              # Shared across all projects
│   ├── system/                          # HOT — pinned in system prompt
│   │   ├── persona.md                   # Agent identity and behavior
│   │   ├── human.md                     # User preferences and habits
│   │   └── projects.md                  # Auto-maintained project registry (readonly)
│   └── reference/                       # COLD — read on demand
└── projects/
    ├── my-app/                          # Per-project memory
    │   ├── system/
    │   │   └── project.md               # Build commands, architecture, conventions
    │   ├── reference/                   # COLD — read on demand
    │   └── archive/                     # COLD — historical context
    └── another-project/
        ├── system/
        │   └── project.md
        ├── reference/
        └── archive/
```

Project directories are named by the project's directory basename (e.g. `my-app` from `/home/user/projects/my-app`). If two projects share the same basename, a short hash suffix is appended to disambiguate (e.g. `my-app-a3f2`).

The `projects.md` file is an auto-maintained registry of all known projects — updated on each plugin init with the project name, path, and last-seen date.

## Configuration

Optional. Create `~/.config/opencode/memfs.json`:

```json
{
  "hotDir": "system",
  "defaultLimit": 5000,
  "autoCommitDebounceMs": 2000,
  "maxTreeDepth": 3
}
```

All fields are optional with sensible defaults:

| Field | Type | Default | Description |
|---|---|---|---|
| `hotDir` | string | `"system"` | Directory name for hot (pinned) files |
| `defaultLimit` | number | `5000` | Default character limit for new files |
| `autoCommitDebounceMs` | number | `2000` | Debounce delay (ms) before auto-committing |
| `maxTreeDepth` | number | `3` | Maximum directory depth in tree listing |

## Tools

The plugin registers 9 custom tools. The agent uses these instead of standard file tools to interact with memory.

### Content Tools

#### `memory_read`

Read a memory file with metadata.

| Arg | Type | Description |
|---|---|---|
| `path` | string | Relative path (e.g. `"system/persona.md"`) |

Returns path, description, char count, limit, readonly status, and full content.

#### `memory_write`

Create or fully replace a memory file.

| Arg | Type | Required | Description |
|---|---|---|---|
| `path` | string | yes | Relative path |
| `content` | string | yes | Full content body |
| `description` | string | no | File description (auto-generated from filename if omitted) |
| `limit` | number | no | Character limit (defaults to `defaultLimit`) |
| `readonly` | boolean | no | Protect from modification (defaults to `false`) |

Validates that content doesn't exceed the limit and that existing readonly files aren't overwritten.

#### `memory_edit`

Partial edit using exact string replacement.

| Arg | Type | Description |
|---|---|---|
| `path` | string | Relative path |
| `oldString` | string | Exact string to find |
| `newString` | string | Replacement string |

Same semantics as the core Edit tool. Validates readonly status and char limit.

#### `memory_delete`

Remove a memory file.

| Arg | Type | Description |
|---|---|---|
| `path` | string | Relative path |

Validates that the file exists and is not readonly.

### Hierarchy Tools

#### `memory_promote`

Move a cold file into `system/` (make it hot). The file will be pinned in the system prompt.

| Arg | Type | Description |
|---|---|---|
| `path` | string | Relative path to the cold file |

#### `memory_demote`

Move a hot file from `system/` into `reference/` (make it cold). The file will only appear as a tree entry.

| Arg | Type | Description |
|---|---|---|
| `path` | string | Relative path to the hot file |

### Git / Navigation Tools

#### `memory_tree`

Show the memory tree with descriptions and character counts.

| Arg | Type | Default | Description |
|---|---|---|---|
| `scope` | `"all"` \| `"project"` \| `"global"` | `"all"` | Filter by scope |

#### `memory_history`

Show git history of memory changes.

| Arg | Type | Default | Description |
|---|---|---|---|
| `limit` | number | `10` | Maximum commits to return |

#### `memory_rollback`

Revert memory to a specific commit. Creates a new commit recording the rollback (history is preserved).

| Arg | Type | Description |
|---|---|---|
| `commitHash` | string | Commit hash from `memory_history` |

## Frontmatter

Every memory file uses YAML frontmatter:

```yaml
---
description: "What this file contains and when to reference it"
limit: 5000
readonly: false
---

Your content here...
```

- **`description`** — Navigation signal visible in the tree listing. Auto-generated from the filename if omitted.
- **`limit`** — Maximum character count for the body. Default: `5000`.
- **`readonly`** — When `true`, the agent cannot modify or delete the file. Default: `false`.

## System Prompt

The plugin injects a `<memfs>` block into the system prompt containing:

1. A **tree listing** of all files with paths, char counts, and descriptions
2. **Instructions** on how to use the memory tools
3. **Full content** of all hot (`system/`) files

```xml
<memfs>
<tree>
system/persona.md (342/5000) — Agent identity and behavior guidelines
system/human.md (128/5000) — User preferences and working style
reference/api-conventions.md (890/5000) — API naming and error handling patterns
</tree>

<instructions>
Your persistent memory is stored as markdown files.
Files in system/ are pinned — you always see their full contents below.
...
</instructions>

<system path="system/persona.md" chars="342" limit="5000">
...full content...
</system>
</memfs>
```

## Architecture

```
Agent calls memory_write / memory_edit / etc.
  → Tool validates input (readonly, limit, existence)
  → Atomic write to disk (tmp + rename)
  → Tool returns result immediately
  → Single fs.watch on ~/.config/opencode/memory/ detects change
  → 2-second debounce (batches rapid edits)
  → git add . && git commit -m "memory: update <files>"
```

Key design decisions:

- **Centralized storage** — All memory under `~/.config/opencode/memory/` with one git repo and one watcher
- **Tool isolation** — Dedicated memory tools prevent ambiguity between "editing code" and "updating memory"
- **Progressive disclosure** — Tree is always visible (cheap), content loaded on demand (expensive)
- **Git versioning** — Rollback, audit trail, and conflict resolution without custom code
- **Decoupled commit path** — Tools write files, watcher handles git. Catches all changes regardless of source
- **Atomic writes** — tmp + rename prevents corruption from partial writes
- **Projects registry** — Auto-maintained `projects.md` tracks all known projects for cross-project awareness

## Development

```bash
npm run build          # Compile to dist/
npm run dev            # Watch mode
npm run clean          # Remove dist/
npx tsc --noEmit       # Type-check without emitting
```

## License

MIT
