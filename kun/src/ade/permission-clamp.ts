import {
  kunToolPermissionModeFromSettings,
  type KunToolPermissionMode
} from '../contracts/policy.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import type {
  HarnessDefinition,
  HarnessPermissionMode
} from '../contracts/harness.js'

/**
 * Kun's product permission ladder, strictest to widest (docs/ade/09 §7.1).
 * Harness permission modes map onto it through HarnessPermissionMode.
 */
export const PERMISSION_RANK = {
  'ask-for-approval': 0,
  'approve-for-me': 1,
  'full-access': 2
} as const satisfies Record<KunToolPermissionMode, number>

/**
 * The manager turn's authority snapshot: its product permission mode plus
 * whether a human can be asked to widen it. Unattended turns (scheduled, IM,
 * api, extension) are never interactive — escalation clamps silently.
 */
export type ManagerAuthority = {
  kunPermissionMode: KunToolPermissionMode
  interactive: boolean
}

export type PermissionClamp = {
  /** Harness mode id the worker actually runs at. */
  effective: string
  /** The request asked for more than the manager's authority allows. */
  downgraded: boolean
  /**
   * Interactive turns may escalate to full-access past the manager's rank —
   * the host must ask the user (§7.2) before dispatching at the requested mode.
   */
  needsUserConfirmation: boolean
  /** The resolved harness mode the caller asked for, when it was refused. */
  requestedMode?: HarnessPermissionMode
}

/**
 * Project a turn's actual authority into the three-tier product vocabulary.
 * Turn-level overrides beat thread defaults; malformed/noncanonical
 * combinations project to 'ask-for-approval' inside
 * kunToolPermissionModeFromSettings, so the ceiling is only ever
 * underestimated, never overestimated.
 */
export function authorityFromTurn(
  thread: Pick<
    ThreadRecord,
    'approvalPolicy' | 'sandboxMode' | 'approvalReviewer'
  >,
  turn:
    | Pick<
        Turn,
        | 'approvalPolicy'
        | 'sandboxMode'
        | 'approvalReviewer'
        | 'clientSurface'
        | 'imContext'
      >
    | undefined
): ManagerAuthority {
  return {
    kunPermissionMode: kunToolPermissionModeFromSettings({
      approvalPolicy: turn?.approvalPolicy ?? thread.approvalPolicy,
      sandboxMode: turn?.sandboxMode ?? thread.sandboxMode,
      approvalReviewer: turn?.approvalReviewer ?? thread.approvalReviewer
    }),
    // Only surfaces with a real approval UI count as interactive; cli, api,
    // im, extension, and absent values can never confirm an escalation.
    interactive:
      (turn?.clientSurface === 'gui' || turn?.clientSurface === 'tui') &&
      turn.imContext !== true
  }
}

/**
 * Effective worker permission = manager authority intersected with the
 * harness's declared modes (docs/ade/09 §7.1). The worker's sandbox and tool
 * allow-lists are clamped separately by ChildSecuritySnapshot rules.
 */
export function clampPermission(
  def: Pick<HarnessDefinition, 'permissionModes'>,
  requested: string | undefined,
  authority: ManagerAuthority
): PermissionClamp {
  const managerRank = PERMISSION_RANK[authority.kunPermissionMode]
  const candidates = def.permissionModes.filter(
    (mode) => PERMISSION_RANK[mode.kunPermissionMode] <= managerRank
  )
  const fallback = candidates.at(-1)?.id ?? def.permissionModes[0]!.id
  const wanted = def.permissionModes.find((mode) => mode.id === requested)
  if (wanted && PERMISSION_RANK[wanted.kunPermissionMode] > managerRank) {
    return {
      effective: fallback,
      downgraded: true,
      needsUserConfirmation:
        authority.interactive && wanted.kunPermissionMode === 'full-access',
      requestedMode: wanted
    }
  }
  return {
    effective: wanted?.id ?? fallback,
    downgraded: false,
    needsUserConfirmation: false
  }
}
