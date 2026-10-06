import type { AdeHarnessPermissionMode } from '@shared/ade-harnesses'
import { KUN_TOOL_PERMISSION_MODES, type KunToolPermissionMode } from '@shared/app-settings'

/** Native modes that answer or plan without changing files. */
const READ_ONLY_MODE_IDS = new Set(['ask', 'plan', 'read-only'])

export type NativePermissionPreview = {
  /** Native mode id the Agent is asked to run in. */
  id: string
  label: string
  /** The native mode answers or plans without changing files. */
  readOnly: boolean
}

/**
 * Codex and Claude Code take permissions from Kun's level and never read a
 * native mode preference: Codex runs in the level's sandbox and routes every
 * request to Kun's approval gate (codex-session.ts); Claude Code maps the
 * level to default/bypassPermissions (sdk-options-builder.ts).
 */
export function permissionFollowsKunLevel(transport: string | undefined): boolean {
  return transport === 'codex-app-server' || transport === 'agent-sdk'
}

/** Codex sandbox per level; mirrors kunToolPermissionModeSettings (kun/src/contracts/policy.ts). */
const CODEX_SANDBOX_BY_LEVEL: Record<KunToolPermissionMode, { id: string; label: string }> = {
  'ask-for-approval': { id: 'workspace-write', label: 'Workspace write' },
  'approve-for-me': { id: 'workspace-write', label: 'Workspace write' },
  'full-access': { id: 'danger-full-access', label: 'Full access' }
}

/**
 * Preview of the native mode an external Agent receives for one Kun
 * permission level. Mirrors kun/src/harness/harness-turn-permissions.ts for
 * an attended composer turn: an explicit per-Agent preference is honored
 * within the level's ceiling, otherwise the widest mode within it is used.
 * Devin negotiates its legacy approval mode for Kun's ask level; current CLIs
 * advertise no such mode, so the turn falls back to read-only Ask.
 */
export function nativePermissionPreview(
  harnessId: string,
  modes: readonly AdeHarnessPermissionMode[] | undefined,
  level: KunToolPermissionMode,
  requested?: string,
  transport?: string
): NativePermissionPreview | null {
  if (transport === 'codex-app-server') return { ...CODEX_SANDBOX_BY_LEVEL[level], readOnly: false }
  if (permissionFollowsKunLevel(transport)) requested = undefined
  if (!modes?.length) return null
  const ceiling = KUN_TOOL_PERMISSION_MODES.indexOf(level)
  const rank = (mode: AdeHarnessPermissionMode): number =>
    KUN_TOOL_PERMISSION_MODES.indexOf(mode.kunPermissionMode as KunToolPermissionMode)
  const allowed = modes.filter((mode) => rank(mode) >= 0 && rank(mode) <= ceiling)
  if (!allowed.length) return null
  let chosen: AdeHarnessPermissionMode | undefined
  if (harnessId === 'devin' && !requested) {
    chosen = ceiling === 1 ? allowed.find((mode) => mode.id === 'smart')
      : ceiling === 0 ? allowed.find((mode) => mode.id === 'normal') ?? allowed.find((mode) => mode.id === 'ask')
        : undefined
  }
  chosen ??= (requested ? allowed.find((mode) => mode.id === requested) : undefined) ?? allowed.at(-1)!
  return { id: chosen.id, label: chosen.label, readOnly: READ_ONLY_MODE_IDS.has(chosen.id) }
}
