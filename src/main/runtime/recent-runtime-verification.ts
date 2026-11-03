import type { AppSettingsV1 } from '../../shared/app-settings'

/**
 * Every Main runtime request first ensures the Runtime. Without a short
 * verified window each request (extension pumps poll several times a second)
 * paid for /health, /v1/runtime/info, a gateway credential check, and a
 * settings read. The window is dropped by any lifecycle operation, a
 * connection failure, an unexpected exit, or a different runtime fingerprint;
 * the watchdog keeps probing independently.
 */
export const ENSURE_RUNTIME_VERIFIED_WINDOW_MS = 15_000

type VerifiedRuntime = {
  fingerprint: string
  generation: number
  at: number
  settings: AppSettingsV1
}

let verified: VerifiedRuntime | null = null

export function recentRuntimeVerification(
  fingerprint: string,
  generation: number,
  now = Date.now()
): AppSettingsV1 | null {
  if (!verified || verified.fingerprint !== fingerprint || verified.generation !== generation) return null
  return now - verified.at < ENSURE_RUNTIME_VERIFIED_WINDOW_MS ? verified.settings : null
}

export function rememberRuntimeVerification(entry: Omit<VerifiedRuntime, 'at'>, now = Date.now()): void {
  verified = { ...entry, at: now }
}

export function forgetRecentRuntimeVerification(): void {
  verified = null
}
