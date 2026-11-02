import { assertFollowUpArbitrationFence, type FollowUpArbitrationFence } from './followup-arbitration.js'
import { NativeFollowUpPermitError } from './native-followup-write-scope.js'
import { ResourceFenceStaleError, type ManagerResourceFence } from './resource-lease-state.js'
import type { ServiceManagerState } from './service-manager-state.js'

/** Both leases must belong to the registered Rooms coordinator at the physical write boundary. */
export function assertManualFollowUpFence(input: {
  state: ServiceManagerState; fence: ManagerResourceFence; arbitration: FollowUpArbitrationFence; enabled: () => boolean
}): void {
  if (!input.enabled()) throw new NativeFollowUpPermitError('manual native follow-up is not enabled')
  if (input.fence.resource !== 'rooms-coordinator' ||
    input.state.registration(input.fence.ownerFlavor)?.instanceId !== input.fence.ownerInstanceId ||
    input.fence.ownerFlavor !== input.arbitration.fence.ownerFlavor ||
    input.fence.ownerInstanceId !== input.arbitration.fence.ownerInstanceId) throw new ResourceFenceStaleError()
  input.state.assertResource(input.fence)
  assertFollowUpArbitrationFence(input.state, input.arbitration)
}
