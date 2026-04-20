/**
 * Per-session metadata for the injection cache (TASK-111).
 *
 * Tracks the state needed by `shouldRefreshNow()`:
 * - `lastResponseTime` — wall-clock of the last assistant response; used by the TTL branch.
 * - `lastChangeTime`   — wall-clock of the last known memory mutation (informational).
 * - `modelContextLimit`— captured from the `Model` passed to `system.transform`,
 *                       used to compute usage percentage.
 * - `lastTokens`       — latest input + cache-read token counts from `message.updated` events.
 *
 * Scope: per-`sessionID`. No serialization — purely in-memory for the life of the plugin.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Latest token counts observed for a session, from `message.updated` events. */
export interface SessionTokenSnapshot {
  /** Prompt input tokens (fresh tokens sent to the provider). */
  input: number
  /** Cached prompt prefix tokens (provider KV-cache hit). */
  cacheRead: number
}

/** Per-session metadata tracked by the injection cache. */
export interface SessionMeta {
  /** ms since epoch when the last assistant message finished. */
  lastResponseTime: number
  /** ms since epoch of the last known memory mutation (tool write or fs.watch event). */
  lastChangeTime: number
  /** Model context-window limit, if known. Populated from `input.model` in system.transform. */
  modelContextLimit?: number
  /** Latest token counts from `message.updated` events. */
  lastTokens?: SessionTokenSnapshot
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/** Keyed store of per-session metadata. */
export class SessionMetaStore {
  private readonly entries = new Map<string, SessionMeta>()

  /** Get the meta for a session, creating a default entry if absent. */
  getOrCreate(sessionID: string, now: number = Date.now()): SessionMeta {
    let meta = this.entries.get(sessionID)
    if (!meta) {
      meta = { lastResponseTime: now, lastChangeTime: now }
      this.entries.set(sessionID, meta)
    }
    return meta
  }

  /** Get the meta for a session, or `undefined`. */
  get(sessionID: string): SessionMeta | undefined {
    return this.entries.get(sessionID)
  }

  /** Iterate over all tracked sessions (used to bump `lastChangeTime` globally). */
  values(): IterableIterator<SessionMeta> {
    return this.entries.values()
  }

  /** Current tracked-session count. */
  size(): number {
    return this.entries.size
  }

  /** Remove a session's meta (e.g. on session close). */
  delete(sessionID: string): void {
    this.entries.delete(sessionID)
  }

  /** Clear all entries (mostly for tests). */
  clear(): void {
    this.entries.clear()
  }
}

// ---------------------------------------------------------------------------
// Usage Percentage
// ---------------------------------------------------------------------------

/**
 * Compute the current context-usage percentage (0-100) for a session.
 *
 * Uses `input + cacheRead` tokens from the most recent assistant message
 * against the model's context-window limit. Returns `0` if either input
 * is missing — this means the pressure branch of the bust ladder will not
 * fire until we have real numbers, which is the safe default.
 */
export function computeUsagePercentage(meta: SessionMeta): number {
  if (!meta.modelContextLimit || meta.modelContextLimit <= 0) return 0
  if (!meta.lastTokens) return 0
  const used = meta.lastTokens.input + meta.lastTokens.cacheRead
  return (used / meta.modelContextLimit) * 100
}
