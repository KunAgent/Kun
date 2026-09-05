import type { ThreadExecutionLease } from '../contracts/runtime-flavor.js'
import type { ManagerSharedDataStore } from './shared-data-store.js'
import type { ServiceManagerState } from './service-manager-state.js'

/**
 * Settle every expired execution owner before a replacement Runtime can
 * register. All leases are attempted even when one data-plane write fails.
 */
export async function reconcileExpiredThreadLeases(input: {
  leases: readonly ThreadExecutionLease[]
  state: ServiceManagerState
  sharedData: Pick<ManagerSharedDataStore, 'reconcileExpiredLease'>
  flushState?: () => Promise<void>
}): Promise<number> {
  if (input.leases.length === 0) return 0
  await input.flushState?.()
  let reconciled = 0
  const errors: unknown[] = []
  for (const lease of input.leases) {
    try {
      await input.sharedData.reconcileExpiredLease(lease)
      input.state.completeExpiredLeaseReconciliation(lease)
      await input.flushState?.()
      reconciled += 1
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) {
    throw new AggregateError(errors, 'multiple expired thread leases could not be reconciled')
  }
  return reconciled
}
