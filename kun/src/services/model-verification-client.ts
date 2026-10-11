import type { ModelClient } from '../ports/model-client.js'
import type { ModelConnectionRegistry } from './model-connection-registry-core.js'
import { catalogBinding, recordProviderInferenceEvidence } from './provider-catalog-operations.js'

/** Records the concrete provider attempt, below route pools, without changing its output. */
export function withModelVerification(client: ModelClient, providerId: string,
  getRegistry?: () => ModelConnectionRegistry | undefined, protocolForModel?: (model: string) => string | undefined,
  scopesForModel?: (model: string) => string[]): ModelClient {
  if (!getRegistry) return client
  return {
    get provider() { return client.provider }, get model() { return client.model },
    ...(client.paperReadOnlyDispatchGuard ? { paperReadOnlyDispatchGuard: client.paperReadOnlyDispatchGuard.bind(client) } : {}),
    ...(client.gatewayDispatchGuard ? { gatewayDispatchGuard: client.gatewayDispatchGuard.bind(client) } : {}),
    ...(client.selectsRouteTargetDuringStream ? { selectsRouteTargetDuringStream: client.selectsRouteTargetDuringStream.bind(client) } : {}),
    async *stream(request) {
      const registry = getRegistry()
      const initial = registry ? await catalogBinding(registry, providerId).catch(() => null) : null
      const scopes = scopesForModel?.(request.model) ?? []
      if (registry && scopes.length > 0 && (!initial || scopes.some((scope) => scope !== initial.identity))) {
        await registry.refreshMetadata().catch(() => undefined)
        yield { kind: 'error' as const, code: 'provider_account_changed',
          message: 'The provider account changed or is unavailable. Model metadata has been refreshed; check the connection and retry.' }
        return
      }
      const protocol = protocolForModel?.(request.model)
      let outcome: { success: boolean; reason?: string } | undefined
      try {
        for await (const chunk of client.stream(request)) {
          if (chunk.kind === 'error') outcome = { success: false, reason: chunk.failure?.reason ?? chunk.code }
          if (chunk.kind === 'completed') outcome ??= { success: chunk.stopReason !== 'error' }
          yield chunk
        }
      } catch (error) {
        if (!request.abortSignal?.aborted) outcome = { success: false, reason: 'transport' }
        throw error
      } finally {
        if (registry && initial && outcome) {
          await recordProviderInferenceEvidence(registry, providerId, request.model, initial.document.revision,
            { ...outcome, expectedIdentity: initial.identity, ...(protocol ? { protocol } : {}) }).catch(() => undefined)
        }
      }
    }
  }
}
