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

Restart OpenCode and you're ready to go.

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
  "maxTreeDepth": 3,
  "cacheTtl": "5m",
  "refreshThresholdPercentage": 65,
  "refreshOnPromoteDemote": true
}
```

All fields are optional with sensible defaults:

| Field | Type | Default | Description |
|---|---|---|---|
| `hotDir` | string | `"system"` | Directory name for hot (pinned) files |
| `defaultLimit` | number | `5000` | Default character limit for new files |
| `autoCommitDebounceMs` | number | `2000` | Debounce delay (ms) before auto-committing |
| `maxTreeDepth` | number | `3` | Maximum directory depth in tree listing |
| `cacheTtl` | string \| number | `"5m"` | Injection-cache sync point (`"5m"`, `"30s"`, `"500ms"`, or ms number) |
| `refreshThresholdPercentage` | number | `65` | Context-usage % at which pressure forces a refresh |
| `refreshOnPromoteDemote` | boolean | `true` | Whether `memory_promote`/`memory_demote` force-bust the cache |

## Tools

The plugin registers 10 custom tools. The agent uses these instead of standard file tools to interact with memory.

### Content Tools

#### `memory_read`

Read a memory file with metadata.

| Arg | Type | Description |
|---|---|---|
| `path` | string | Relative path (e.g. `"system/persona.md"`) |
| `scope` | `"project"` \| `"global"` | Memory scope to target |

Returns path, description, char count, limit, readonly status, and full content.

#### `memory_write`

Create or fully replace a memory file.

| Arg | Type | Required | Description |
|---|---|---|---|
| `path` | string | yes | Relative path |
| `scope` | `"project"` \| `"global"` | yes | Memory scope to target |
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
| `scope` | `"project"` \| `"global"` | Memory scope to target |
| `oldString` | string | Exact string to find |
| `newString` | string | Replacement string |

Same semantics as the core Edit tool. Validates readonly status and char limit.

#### `memory_delete`

Remove a memory file.

| Arg | Type | Description |
|---|---|---|
| `path` | string | Relative path |
| `scope` | `"project"` \| `"global"` | Memory scope to target |

Validates that the file exists and is not readonly.

### Hierarchy Tools

#### `memory_promote`

Move a cold file into `system/` (make it hot). The file will be pinned in the system prompt.

| Arg | Type | Description |
|---|---|---|
| `path` | string | Relative path to the cold file |
| `scope` | `"project"` \| `"global"` | Memory scope to target |

#### `memory_demote`

Move a hot file from `system/` into `reference/` (make it cold). The file will only appear as a tree entry.

| Arg | Type | Description |
|---|---|---|
| `path` | string | Relative path to the hot file |
| `scope` | `"project"` \| `"global"` | Memory scope to target |

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

#### `memory_flush`

Force the injected `<memfs>` system-prompt block to refresh on the next turn, regardless of the injection cache's TTL/pressure state.

No arguments.

Use sparingly — the cache exists to preserve upstream prompt-cache prefix hits. Flush when a recent memory write must be visible in the system prompt immediately (e.g. before handing off to a sub-agent). The `/memfs-flush` command does the same thing.

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
<tree scope="global">
system/human.md (128/5000) — User preferences and working style
system/persona.md (342/5000) — Agent identity and behavior guidelines
</tree>

<tree scope="project">
system/project.md (450/5000) — Build commands, architecture, conventions
reference/api-conventions.md (890/5000) — API naming and error handling patterns
</tree>

<instructions>
Your persistent memory is stored as markdown files.
Files in system/ are pinned — you always see their full contents below.
...
</instructions>

<system path="system/human.md" chars="128" limit="5000" scope="global">
...full content...
</system>

<system path="system/project.md" chars="450" limit="5000" scope="project">
...full content...
</system>
</memfs>
```

## Prompt-Cache Preservation

Every write that modifies the `<memfs>` block would — without care — change `message[0]` and bust the upstream provider's KV-cache prefix (Anthropic, Bedrock, etc.), which costs real money on long sessions. The plugin defers rebuilds of the rendered block until a genuine cache-bust moment.

**Two-layer model:**

| Layer | When | Why |
|---|---|---|
| **Disk** (`~/.config/opencode/memory/**`) | Every tool call, immediately | Crash safety, read-after-write consistency, git-commitable |
| **Render** (the `<memfs>` block in `message[0]`) | Deferred to the next cache-bust moment | Preserves the provider's prompt-cache prefix |

**Cache-bust ladder (per session, on each `experimental.chat.system.transform`):**

1. No cached entry yet → render (first turn)
2. Content hash unchanged → serve cached (fast path, byte-identical)
3. A force-bust was requested (`memory_promote` / `memory_demote` / `memory_flush` / `/memfs-flush`) → render
4. Context usage ≥ `refreshThresholdPercentage` → render (pressure beats freshness)
5. `now - lastResponseTime > cacheTtlMs` → render (provider cache likely stale anyway)
6. Otherwise → serve cached bytes even though content has changed

Rules 3–5 are the three independent ways a bust can fire. Rule 6 is the point: between bust moments, the agent sees identical bytes in `message[0]` across many memory edits.

**What is never stale:**

- `memory_read` always hits disk → always returns the latest content
- `memory_tree` always scans live → always current
- The only thing that can be stale is the injected `<memfs>` block, and only for at most one turn's worth of time (bounded by the ladder)

**`cacheTtl` is a sync point, not a timer.** Setting `"5m"` matches Anthropic's default 5-minute prompt-cache window — it describes "when busting the upstream cache is free anyway," not when a local timer fires. For Anthropic's extended 1-hour cache beta, set `"1h"`.

### Observing the cache

Every decision is logged to `~/.config/opencode/memfs.log` (one line per transform). Tail it during a session to see exactly which ladder branch fired:

```sh
tail -f ~/.config/opencode/memfs.log
```

Example:

```
2026-04-20T13:42:01.123Z INFO  plugin loaded projectName=opencode-memfs cache_ttl_ms=300000 refresh_threshold_pct=65
2026-04-20T13:42:01.456Z INFO  refreshed <memfs> render reason=first session=ses_01... chars=2812 prev_cache_age_ms=0 since_last_response_ms=0 ttl_ms=300000 usage_pct=0
2026-04-20T13:42:09.789Z INFO  served cached <memfs> session=ses_01... hash_match=true cache_age_ms=8333 since_last_response_ms=8333 ttl_ms=300000 usage_pct=12.4 chars=2812
2026-04-20T13:48:15.012Z INFO  refreshed <memfs> render reason=ttl session=ses_01... chars=2856 prev_cache_age_ms=374223 since_last_response_ms=374223 ttl_ms=300000 usage_pct=18.1
```

Key fields:

- `hash_match=true` on a served-cached line means a fresh render would be byte-identical — serving cached is the optimization working correctly (and TTL doesn't fire in this case, because rebuilding produces the same bytes).
- `hash_match=false` + served-cached means deferred bust — the content changed but none of force/pressure/TTL triggers applied yet.
- `reason=forced:<source>` identifies which tool drove a force-bust (`promote`, `demote`, `flush-tool`, `flush-command`).

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
- **Injection cache** — Rendered `<memfs>` block is cached per session and only rebuilt at genuine cache-bust moments (see above), preserving upstream prompt-cache prefix hits across many memory edits

## Development

```bash
npm run build          # Compile to dist/
npm run dev            # Watch mode
npm run clean          # Remove dist/
npx tsc --noEmit       # Type-check without emitting
```

## License

MIT
