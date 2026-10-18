const START_TIMEOUT_FLOOR_MS = 15_000
const START_TIMEOUT_CEILING_MS = 10 * 60_000

/**
 * How long a client waits for a Runtime it launched. Large histories keep
 * restart recovery ahead of discovery for tens of seconds, so the default is
 * generous; a crashed candidate still fails fast through its exit.
 * KUN_STARTUP_TIMEOUT_MS overrides it, clamped to 15s-10min like the GUI.
 */
export function resolveSharedRuntimeStartTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): number {
  const parsed = Number(env.KUN_STARTUP_TIMEOUT_MS?.trim() || NaN)
  if (Number.isFinite(parsed)) {
    return Math.min(START_TIMEOUT_CEILING_MS, Math.max(START_TIMEOUT_FLOOR_MS, Math.floor(parsed)))
  }
  return platform === 'win32' ? 240_000 : 180_000
}
