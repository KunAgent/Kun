import { KunHandoffError } from './kun-installed-build-handoff'

export type HandoffFailureKind = 'identity_unverifiable' | 'probe_failed'

/**
 * Classify an error as a fail-closed handoff failure, or `null`. Kept in its
 * own Electron-free module so it can be unit-tested without pulling in
 * Electron or electron-updater.
 */
export function handoffFailureKind(error: unknown): HandoffFailureKind | null {
  if (error instanceof KunHandoffError) {
    return error.code === 'identity_unverifiable' || error.code === 'probe_failed'
      ? error.code
      : null
  }
  return null
}
