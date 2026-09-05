import type { PendingUpdateResult } from './gui-updater-pending'

/**
 * Single source of truth for Windows automatic-update transaction phases.
 *
 * The installer PowerShell script (`build/windows-installer-migration-transaction.ps1`)
 * owns the phase transitions; this table mirrors them for every GUI consumer
 * (pre-start bootstrap recovery, runtime reconciliation, and transaction
 * finalization). `update-transaction-states.parity.test.ts` fails when the two
 * sides drift apart.
 *
 * Legacy `pending-update-result.json` records with `schemaVersion === 1` carry
 * no `transactionState`; they are treated as `committed` for compatibility.
 */
export const UPDATE_TRANSACTION_STATES = [
  'prepared',
  'payload_switched',
  'awaiting_health',
  'cleanup_pending',
  'committed',
  'rollback_pending',
  'rolling_back',
  'rolled_back',
  'rollback_incomplete',
  'aborted',
  'finalizing'
] as const

export type UpdateTransactionState = typeof UPDATE_TRANSACTION_STATES[number]

export type UpdateTransactionStateFacts = {
  /** Phases the installer may move this state to next. */
  readonly nextStates: readonly UpdateTransactionState[]
  /**
   * The candidate payload is active: the new version is allowed to run and
   * must complete a runtime health check before its transaction commits.
   */
  readonly countsAsInstalled: boolean
  /** Recovery data must stay on disk so the transaction can still roll back. */
  readonly mustStayRollbackCapable: boolean
  /** The rollback has fully restored the previous payload. */
  readonly rollbackSucceeded: boolean
  /** Deleting the payload backup is authorized from this state. */
  readonly mayDeleteBackup: boolean
  /** A brand-new update may be installed without finishing this transaction. */
  readonly allowsNewInstall: boolean
}

const rollbackable = (
  facts: Pick<UpdateTransactionStateFacts, 'nextStates' | 'countsAsInstalled'>
): UpdateTransactionStateFacts => ({
  ...facts,
  mustStayRollbackCapable: true,
  rollbackSucceeded: false,
  mayDeleteBackup: false,
  allowsNewInstall: false
})

export const UPDATE_TRANSACTION_STATE_FACTS: Readonly<
  Record<UpdateTransactionState, UpdateTransactionStateFacts>
> = {
  prepared: rollbackable({
    nextStates: ['payload_switched', 'rolling_back'],
    countsAsInstalled: false
  }),
  payload_switched: rollbackable({
    nextStates: ['awaiting_health', 'rolling_back'],
    countsAsInstalled: true
  }),
  awaiting_health: rollbackable({
    nextStates: ['cleanup_pending', 'rolling_back'],
    countsAsInstalled: true
  }),
  cleanup_pending: rollbackable({
    nextStates: ['committed', 'rolling_back'],
    countsAsInstalled: true
  }),
  committed: {
    // RecoverUpdateTransaction may still roll a committed transaction back
    // before the application's first complete startup confirms health.
    nextStates: ['finalizing', 'rolling_back'],
    countsAsInstalled: true,
    mustStayRollbackCapable: true,
    rollbackSucceeded: false,
    mayDeleteBackup: false,
    allowsNewInstall: false
  },
  rollback_pending: rollbackable({
    nextStates: ['rolling_back'],
    countsAsInstalled: false
  }),
  rolling_back: rollbackable({
    nextStates: ['rolled_back', 'rollback_incomplete'],
    countsAsInstalled: false
  }),
  rolled_back: {
    nextStates: [],
    countsAsInstalled: false,
    mustStayRollbackCapable: false,
    rollbackSucceeded: true,
    mayDeleteBackup: true,
    allowsNewInstall: true
  },
  rollback_incomplete: rollbackable({
    nextStates: ['rolling_back'],
    countsAsInstalled: false
  }),
  aborted: {
    nextStates: ['rolling_back'],
    countsAsInstalled: false,
    mustStayRollbackCapable: true,
    rollbackSucceeded: false,
    mayDeleteBackup: false,
    allowsNewInstall: false
  },
  finalizing: {
    nextStates: [],
    countsAsInstalled: true,
    mustStayRollbackCapable: false,
    rollbackSucceeded: false,
    mayDeleteBackup: true,
    allowsNewInstall: true
  }
}

export function isUpdateTransactionState(value: unknown): value is UpdateTransactionState {
  return typeof value === 'string' &&
    (UPDATE_TRANSACTION_STATES as readonly string[]).includes(value)
}

export function updateTransactionFacts(
  state: UpdateTransactionState
): UpdateTransactionStateFacts {
  return UPDATE_TRANSACTION_STATE_FACTS[state]
}

/** Unknown or absent states resolve to the most conservative interpretation. */
export function resolveUpdateTransactionFacts(state: unknown): UpdateTransactionStateFacts {
  return isUpdateTransactionState(state)
    ? UPDATE_TRANSACTION_STATE_FACTS[state]
    : rollbackable({ nextStates: [], countsAsInstalled: false })
}

/** True when a transaction phase means the candidate payload is live. */
export function transactionCountsAsInstalled(result: PendingUpdateResult): boolean {
  if (result.schemaVersion === 1) return true
  return resolveUpdateTransactionFacts(result.transactionState).countsAsInstalled
}
