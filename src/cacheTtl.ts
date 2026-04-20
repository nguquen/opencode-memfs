/**
 * Parse cache-TTL values for the injection cache (TASK-111).
 *
 * Accepts a human-readable duration string (`"5m"`, `"30s"`, `"1h"`, `"500ms"`)
 * or a raw number interpreted as milliseconds.
 *
 * Framed as a *sync point*, not a timer: the value represents the moment at
 * which we accept that busting the upstream prompt-cache prefix is cheap
 * (because the provider likely dropped its own cache anyway).
 *
 * Lifted in spirit from Magic Context's `parseCacheTtl`.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Accepted input forms for a cache TTL. */
export type CacheTtlInput = string | number

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/** Suffix → milliseconds multiplier. Longer suffixes must come first. */
const SUFFIXES: ReadonlyArray<readonly [string, number]> = [
  ["ms", 1],
  ["s", 1000],
  ["m", 60_000],
  ["h", 3_600_000],
  ["d", 86_400_000],
]

const DURATION_RE = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i

/**
 * Parse a cache TTL into milliseconds.
 *
 * @param value - A string like `"5m"`, `"30s"`, `"1h"`, `"500ms"`, or a raw number (ms).
 * @returns     - Milliseconds as a non-negative finite number.
 * @throws      - If the value is not a non-negative finite number or not a parseable duration.
 */
export function parseCacheTtl(value: CacheTtlInput): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid cache TTL: ${value} (must be a non-negative finite number)`)
    }
    return value
  }

  if (typeof value !== "string") {
    throw new Error(`Invalid cache TTL: ${String(value)} (must be string or number)`)
  }

  const trimmed = value.trim().toLowerCase()
  const match = trimmed.match(DURATION_RE)
  if (!match) {
    throw new Error(
      `Invalid cache TTL: "${value}" ` +
      `(expected "<number>[ms|s|m|h|d]", e.g. "5m", "30s", "500ms", or raw number of ms)`
    )
  }

  const n = Number(match[1])
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid cache TTL: ${value} (must be non-negative)`)
  }

  const suffix = (match[2] ?? "ms").toLowerCase()
  const entry = SUFFIXES.find(([s]) => s === suffix)
  if (!entry) {
    // Should be unreachable because the regex restricts suffix, but be defensive.
    throw new Error(`Invalid cache TTL suffix: "${suffix}"`)
  }

  return n * entry[1]
}
