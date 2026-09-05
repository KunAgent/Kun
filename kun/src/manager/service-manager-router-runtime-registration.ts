import {
  RuntimeFlavorSchema,
  RuntimeRegistrationSchema
} from '../contracts/runtime-flavor.js'
import { readJsonBody } from '../server/read-json-body.js'
import { jsonResponse } from '../server/response.js'
import type { Router } from '../server/router.js'
import { reconcileExpiredThreadLeases } from './expired-thread-lease-reconciliation.js'
import { authorizedAsync, validation } from './service-manager-router-auth.js'
import {
  isManagerPersistenceDegraded,
  managerPersistenceDegradedResponse
} from './service-manager-router-persistence.js'
import type { ManagerSharedDataStore } from './shared-data-store.js'
import {
  RuntimeSlotBusyError,
  type ServiceManagerState
} from './service-manager-state.js'

/**
 * A replacement Runtime is not admitted until Manager has durably settled
 * every expired execution lease left by the previous owner.
 */
export function addRuntimeRegistrationRoute(
  router: Router,
  input: {
    managerToken: string
    state: ServiceManagerState
    sharedData?: ManagerSharedDataStore
    flushState?: () => Promise<void>
    statePersistence?: () => { degraded: boolean }
  }
): void {
  router.add('PUT', '/v1/runtimes/:flavor/register', (request, context) => authorizedAsync(
    request,
    input.managerToken,
    async () => {
      if (isManagerPersistenceDegraded(input.statePersistence)) return managerPersistenceDegradedResponse()
      const flavor = RuntimeFlavorSchema.safeParse(context.params.flavor)
      if (!flavor.success) return validation('invalid runtime flavor')
      const body = await readJsonBody(request)
      if (!body.ok) return body.response
      const registration = RuntimeRegistrationSchema.safeParse(body.value)
      if (!registration.success || registration.data.flavor !== flavor.data) {
        return validation(
          'invalid runtime registration',
          registration.success ? undefined : registration.error.issues
        )
      }
      try {
        const owner = input.state.registration(flavor.data)
        if (
          owner &&
          owner.instanceId !== registration.data.instanceId &&
          !processIsAlive(owner.pid)
        ) {
          input.state.unregister(owner.flavor, owner.instanceId)
        }
        if (input.sharedData) {
          await reconcileExpiredThreadLeases({
            leases: input.state.expireStale(),
            state: input.state,
            sharedData: input.sharedData,
            flushState: input.flushState
          })
        }
        const registered = input.state.register(registration.data)
        try {
          await input.flushState?.()
        } catch (error) {
          if (owner?.instanceId !== registered.instanceId) {
            input.state.unregister(registered.flavor, registered.instanceId)
          }
          throw error
        }
        return jsonResponse({ registration: registered })
      } catch (error) {
        if (error instanceof RuntimeSlotBusyError) {
          return jsonResponse({
            code: 'runtime_slot_busy',
            message: error.message,
            owner: error.owner
          }, 409)
        }
        throw error
      }
    }
  ))
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return String((error as { code?: unknown })?.code ?? '') === 'EPERM'
  }
}
