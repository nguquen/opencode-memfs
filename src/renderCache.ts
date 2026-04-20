/**
 * Injection-cache store and refresh decision ladder (TASK-111).
 *
 * The cache is keyed by `sessionID` and stores the most recently rendered
 * `<memfs>` block along with the content hash that produced it. The decision
 * ladder (`shouldRefreshNow`) determines whether to serve the cached bytes or
 * publish a fresh render on each `experimental.chat.system.transform` pass.
 *
 * Ladder (mirrors Magic Context's `scheduler.shouldExecute()`):
 *   1. No cached entry          → "first"    — first turn, nothing to serve yet
 *   2. Hash unchanged && not forced → null   — fast path, serve identical bytes
 *   3. Force-bust generation advanced → "forced" — promote/demote/flush
 *   4. Context usage ≥ threshold  → "pressure" — pressure overrides freshness
 *   5. TTL elapsed              → "ttl"     — provider cache is probably stale anyway
 *   6. Otherwise                 → null     — content changed but bust is not yet cheap enough
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A cached render for a single session. */
export interface CacheEntry {
  /** Hash of the memory state that produced `block`. */
  hash: string
  /** The rendered `<memfs>` block. */
  block: string
  /** ms since epoch when this entry was last rendered. */
  renderedAt: number
  /** Value of the global `forceBustGeneration` at render time. */
  bustGenSeen: number
}

/** Reason a refresh is being published (useful for logging / tests). */
export type RefreshReason = "first" | "forced" | "pressure" | "ttl"

/** Arguments for `shouldRefreshNow`. */
export interface ShouldRefreshArgs {
  /** The cached entry, or `undefined` if this is the first transform for the session. */
  cached: CacheEntry | undefined
  /** Content hash of the current memory state. */
  currentHash: string
  /** Current force-bust generation counter. */
  forceBustGeneration: number
  /** Current context-usage percentage (0-100). */
  usagePercentage: number
  /** Threshold at which pressure forces a refresh (0-100). */
  refreshThresholdPercentage: number
  /** ms since epoch when the last assistant response finished. */
  lastResponseTime: number
  /** Cache TTL in ms. */
  cacheTtlMs: number
  /** Current wall-clock (ms since epoch). */
  now: number
}

// ---------------------------------------------------------------------------
// Decision Ladder
// ---------------------------------------------------------------------------

/**
 * Decide whether to publish a fresh render on this transform pass.
 *
 * Returns a reason string (`"first" | "forced" | "pressure" | "ttl"`) when a
 * refresh should happen, or `null` to serve the cached render.
 *
 * Order matters: explicit forces come before pressure which comes before TTL.
 * This matches the "user-meaningful ops force bust" and "pressure overrides
 * freshness" principles from the [[Defer Render Not Writes]] spec.
 */
export function shouldRefreshNow(args: ShouldRefreshArgs): RefreshReason | null {
  const {
    cached,
    currentHash,
    forceBustGeneration,
    usagePercentage,
    refreshThresholdPercentage,
    lastResponseTime,
    cacheTtlMs,
    now,
  } = args

  // 1. No cached entry — first turn of the session.
  if (!cached) return "first"

  // Determine whether a forced bust (promote/demote/flush) is pending.
  const forced = cached.bustGenSeen < forceBustGeneration

  // 2. Hash unchanged and no force pending — serve cached (fast path).
  if (cached.hash === currentHash && !forced) return null

  // 3. Force-bust pending — always publish.
  if (forced) return "forced"

  // 4. Pressure overrides freshness.
  if (usagePercentage >= refreshThresholdPercentage) return "pressure"

  // 5. TTL elapsed — provider cache likely stale anyway, bust is cheap.
  if (now - lastResponseTime > cacheTtlMs) return "ttl"

  // 6. Content changed but none of the bust moments apply — serve stale.
  return null
}

// ---------------------------------------------------------------------------
// Cache Store
// ---------------------------------------------------------------------------

/** In-memory store of cached renders keyed by `sessionID`. */
export class RenderCache {
  private readonly entries = new Map<string, CacheEntry>()

  /** Get the cached entry for a session, or `undefined`. */
  get(sessionID: string): CacheEntry | undefined {
    return this.entries.get(sessionID)
  }

  /** Store (or replace) the cached entry for a session. */
  set(sessionID: string, entry: CacheEntry): void {
    this.entries.set(sessionID, entry)
  }

  /**
   * Invalidate cached entries.
   *
   * With no argument, clears every session. With a sessionID, clears only
   * that session's entry.
   */
  invalidate(sessionID?: string): void {
    if (sessionID === undefined) {
      this.entries.clear()
    } else {
      this.entries.delete(sessionID)
    }
  }

  /** Current cached-session count. */
  size(): number {
    return this.entries.size
  }
}
