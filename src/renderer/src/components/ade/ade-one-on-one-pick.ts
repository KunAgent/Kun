import type { AdeHarnessCredentialMode, AdeHarnessRow } from '@shared/ade-harnesses'
import type { KunHarnessDefaultsEntryV1 } from '@shared/app-settings-types-kun-runtime'
import { defaultCredentialModeForRow } from '../../lib/ade-composer-harness'

/**
 * P4-15: the one-on-one creation dialog remembers the last confirmed pick so
 * a repeat session is one click. Stored in localStorage (renderer-local, never
 * synced into app settings); an unreadable or stale payload falls back to the
 * per-harness defaults from `agents.kun.harnesses.defaults`.
 */
export type AdeOneOnOnePick = {
  harnessId: string
  credentialMode?: string
  providerId?: string
  model?: string
  isolation?: 'local' | 'worktree'
}

const STORAGE_KEY = 'kun.ade.lastOneOnOnePick'

export function readAdeLastOneOnOnePick(): AdeOneOnOnePick | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AdeOneOnOnePick>
    if (typeof parsed.harnessId !== 'string' || !parsed.harnessId.trim()) return null
    return {
      harnessId: parsed.harnessId.trim(),
      credentialMode: typeof parsed.credentialMode === 'string' ? parsed.credentialMode : undefined,
      providerId: typeof parsed.providerId === 'string' ? parsed.providerId : undefined,
      model: typeof parsed.model === 'string' ? parsed.model : undefined,
      isolation:
        parsed.isolation === 'local' || parsed.isolation === 'worktree'
          ? parsed.isolation
          : undefined
    }
  } catch {
    return null
  }
}

export function writeAdeLastOneOnOnePick(pick: AdeOneOnOnePick): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(pick))
  } catch {
    // localStorage may be unavailable (private mode); memory is best-effort.
  }
}

export type AdeOneOnOneResolved = {
  credentialMode: string
  providerId: string
  model: string
  isolation: 'local' | 'worktree'
}

/**
 * Layered defaults for one harness pick: the remembered dialog values win
 * while still valid for that harness, then the configured P4-11 defaults,
 * then the definition's first credential mode / local isolation.
 */
export function resolveOneOnOnePick(input: {
  row: AdeHarnessRow | undefined
  defaults: KunHarnessDefaultsEntryV1 | undefined
  hint?: AdeOneOnOnePick
}): AdeOneOnOneResolved {
  const { row, defaults, hint } = input
  const modes = row?.definition.credentialModes ?? []
  const validMode = (value: string | undefined): value is AdeHarnessCredentialMode =>
    modes.includes(value as AdeHarnessCredentialMode)
  const hinted = hint?.credentialMode
  const configured = defaults?.credentialMode
  return {
    credentialMode: validMode(hinted)
      ? hinted
      : validMode(configured)
        ? configured
        : defaultCredentialModeForRow(row),
    providerId: hint?.providerId ?? defaults?.providerId ?? '',
    model: hint?.model ?? defaults?.model ?? '',
    isolation: hint?.isolation ?? defaults?.isolation ?? 'local'
  }
}
