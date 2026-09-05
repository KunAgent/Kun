import type { ThreadExecutionLease } from '../contracts/runtime-flavor.js'

export class ThreadExecutionBusyError extends Error {
  constructor(readonly owner: ThreadExecutionLease) {
    super(`thread ${owner.threadId} already has an active turn`)
    this.name = 'ThreadExecutionBusyError'
  }
}

export type ThreadLeaseAuthorityState = 'holder' | 'grace' | 'lost'

export interface ThreadExecutionLeasePort {
  acquire(threadId: string, turnId: string): Promise<ThreadExecutionLease>
  release(threadId: string, turnId: string): Promise<void>
  owner(threadId: string): Promise<ThreadExecutionLease | null>
  /**
   * Current authority for a thread. Absent means `holder` (embedded runtimes
   * without a Manager have no takeover peer).
   */
  authorityState?(threadId: string): ThreadLeaseAuthorityState
  /**
   * Resolves once a `grace` state settles: renewal recovered (`holder`) or
   * authority was lost (`lost`). Never rejects; the lost case is finished by
   * the normal turn-abort path.
   */
  waitAuthorityResolution?(threadId: string): Promise<'holder' | 'lost'>
  setLeaseLostHandler?(handler: (lease: ThreadExecutionLease) => void): void
  shutdown?(): Promise<void>
}
