import type { ModelProviderProfileV1 } from '@shared/app-settings'
import {
  SharedModelConnectionConflictError,
  requestSharedModelConnections,
  type SharedModelConnectionsSnapshot
} from './settings-section-providers-shared-api'
import {
  sharedConnectionProfilePatch
} from './settings-section-providers-shared-reconcile'
import type { PendingSharedProviderName } from './shared-provider-mutation-coordinator'

export async function commitSharedModelConnectionProfile(
  provider: ModelProviderProfileV1,
  pending: PendingSharedProviderName,
  isProviderTombstoned: (providerId: string) => boolean = () => false
): Promise<SharedModelConnectionsSnapshot> {
  if (isProviderTombstoned(provider.id)) throw new Error(`Shared model connection ${provider.id} is pending deletion`)
  let snapshot = await requestSharedModelConnections('/v1/model-connections')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await requestSharedModelConnections(
        `/v1/model-connections/${encodeURIComponent(provider.id)}`,
        'PATCH',
        {
          expectedRevision: snapshot.revision,
          ...sharedConnectionProfilePatch({
            ...provider,
            name: pending.localName,
            ...(pending.localBaseUrl !== undefined ? { baseUrl: pending.localBaseUrl } : {}),
            ...(pending.localEndpointFormat !== undefined ? { endpointFormat: pending.localEndpointFormat } : {})
          })
        }
      )
    } catch (error) {
      if (!(error instanceof SharedModelConnectionConflictError) || attempt === 1) throw error
      snapshot = error.snapshot
    }
  }
  return snapshot
}
