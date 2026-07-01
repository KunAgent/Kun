/**
 * ControlMaster (connection multiplexing) capability detection (Issue #647).
 *
 * Reusing one SSH connection for many tool calls is a big latency win, but
 * OpenSSH ControlMaster relies on a Unix-domain control socket that the bundled
 * Windows OpenSSH client does not support. Callers must detect support BEFORE
 * adding `-o ControlPath=...`, otherwise every ssh invocation errors on
 * Windows. Linux/macOS support it.
 */

export function supportsControlMaster(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== 'win32'
}

/**
 * After a dropped connection a target enters `degraded`. Read-only commands may
 * transparently reconnect; mutating commands (writes, deploys, restarts) must
 * NOT be auto-replayed because we cannot confirm whether the remote already ran
 * them. This classifies whether a command is safe to auto-retry on reconnect.
 */
export function isAutoReplaySafeOnReconnect(input: { writes: boolean }): boolean {
  return input.writes === false
}
