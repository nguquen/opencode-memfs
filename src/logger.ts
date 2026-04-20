/**
 * File-based logger for the plugin.
 *
 * OpenCode's plugin runtime does not forward plugin `console.*` output to any
 * log file users typically tail. This logger appends structured lines to
 * `~/.config/opencode/memfs.log` (overridable via `setLogFile`) so operators
 * have a durable, grep-able record of every cache decision and tier change.
 *
 * Writes are fire-and-forget: the logger never throws and never blocks the
 * transform hook. The parent directory is created on first use.
 */

import { appendFile, mkdir } from "fs/promises"
import { homedir } from "os"
import path from "path"

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Default log file path: `~/.config/opencode/memfs.log`. */
export function defaultLogFile(): string {
  return path.join(homedir(), ".config", "opencode", "memfs.log")
}

/** Currently active log file. `null` disables file logging entirely. */
let logFilePath: string | null = defaultLogFile()

/** Has the parent directory been created this process? */
let dirReady = false

/**
 * Override where (or whether) the logger writes.
 *
 * @param filePath - Absolute path to the log file, or `null` to disable.
 */
export function setLogFile(filePath: string | null): void {
  logFilePath = filePath
  dirReady = false
}

/** Get the active log file (`null` when disabled). */
export function getLogFile(): string | null {
  return logFilePath
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

/** Supported log levels — match OpenCode's conventions for parity. */
export type LogLevel = "debug" | "info" | "warn" | "error"

/** Fire-and-forget log emitter. Never throws. */
export function log(
  level: LogLevel,
  message: string,
  extra?: Record<string, unknown>,
): void {
  const target = logFilePath
  if (!target) return

  const line = formatLine(level, message, extra)

  void (async (): Promise<void> => {
    try {
      if (!dirReady) {
        await mkdir(path.dirname(target), { recursive: true })
        dirReady = true
      }
      await appendFile(target, line + "\n", "utf-8")
    } catch {
      // Logging must never break the plugin.
    }
  })()
}

/** Shorthand for info-level logging. */
export function logInfo(message: string, extra?: Record<string, unknown>): void {
  log("info", message, extra)
}

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

/** Render a single log line. Format: `ISO LEVEL message key=value key=value`. */
function formatLine(
  level: LogLevel,
  message: string,
  extra?: Record<string, unknown>,
): string {
  const ts = new Date().toISOString()
  const lvl = level.toUpperCase().padEnd(5, " ")

  if (!extra || Object.keys(extra).length === 0) {
    return `${ts} ${lvl} ${message}`
  }

  const pairs = Object.entries(extra)
    .map(([k, v]) => `${k}=${formatValue(v)}`)
    .join(" ")

  return `${ts} ${lvl} ${message} ${pairs}`
}

/** Render a single extra value. Strings with spaces are quoted. */
function formatValue(v: unknown): string {
  if (v === null || v === undefined) return String(v)
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  if (typeof v === "string") {
    return /[\s"]/.test(v) ? JSON.stringify(v) : v
  }
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
