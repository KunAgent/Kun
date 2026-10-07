import type { AdeHarnessReadiness } from '@shared/ade-harnesses'

/**
 * The most recent readiness check for one connection, kept so the result is
 * still there after the page is left, and so a result the runtime kept with
 * its proof shows up after a restart of the window.
 */
export type LastCheck = {
  readiness?: AdeHarnessReadiness
  /** An `agentEnablement.` key or a raw message; empty when the check passed. */
  error: string
  errorDetail: string
  /** Epoch milliseconds the check finished. */
  at: number
  /** The connection the check was for; a result for another connection is never shown. */
  profileKey: string
}

export function checkFromProof(readiness: AdeHarnessReadiness, profileKey: string): LastCheck {
  const at = Date.parse(readiness.checkedAt)
  return { readiness, error: '', errorDetail: '', at: Number.isFinite(at) ? at : 0, profileKey }
}

/** The newest check that belongs to `profileKey`. */
export function newestCheck(profileKey: string, ...candidates: ReadonlyArray<LastCheck | undefined>): LastCheck | undefined {
  let newest: LastCheck | undefined
  for (const candidate of candidates) {
    if (!candidate || candidate.profileKey !== profileKey) continue
    if (!newest || candidate.at >= newest.at) newest = candidate
  }
  return newest
}
