import { harnessGatewayBindingKey, type HarnessGatewayBinding, type HarnessGatewayAliasGrant } from '../contracts/harness-gateway-binding.js'
/**
 * Credential identity + child-env resolution for delegated turns (P3-10),
 * generalized from `resolveAcpCredentialContext` so every session transport
 * (acp, codex-app-server, pi-rpc) keys its pooled process by the same rule:
 * a `kun-gateway` route folds provider/model into the identity; `native-login`
 * resolves to no env at all.
 */
import type {
  HarnessDefinition,
  HarnessGateway,
  HarnessId,
  HarnessRoute
} from '../contracts/harness.js'
import { nativeHarnessCredentialEnv } from '../harness/harness-secret-env.js'
import { delegatedCredentialIdentity } from '../runtime/delegated-session-binding.js'
import {
  formatGatewayModelId,
  parseGatewayModelId
} from '../harness/gateway-model-id.js'

export type DelegatedCredentialEnvInput = {
  harnessId: HarnessId
  credentialMode: HarnessRoute['credentialMode']
  threadId: string
  turnId: string
  /** Identity the spawned connection pools under — binds the grant to it. */
  credentialIdentity: string
  /** Selected provider/model for `kun-gateway` routes. */
  providerId?: string
  model?: string
  /** The definition's gateway block — absent for harnesses without one. */
  gateway?: HarnessGateway
  accountId?: string
  gatewayBinding?: HarnessGatewayBinding
  frozenGatewayAliases?: readonly HarnessGatewayAliasGrant[]
  onResolvedAliases?: (aliases: HarnessGatewayAliasGrant[]) => Promise<void>
  onGatewayRoute?: (route: import('../ports/model-client.js').ModelRouteTargetMetadata) => Promise<void>
  onResolvedIdentity?: (identity: string, wireModel: string) => void
}

export type DelegatedCredentialResolver = (
  input: DelegatedCredentialEnvInput
) => Promise<Record<string, string>>

export async function resolveDelegatedCredentialContext(
  resolve: DelegatedCredentialResolver | undefined,
  input: {
    definition: HarnessDefinition
    credentialMode: HarnessRoute['credentialMode']
    threadId: string
    turnId: string
    providerId?: string
    model?: string
    accountId?: string
    gatewayBinding?: HarnessGatewayBinding
    frozenGatewayAliases?: readonly HarnessGatewayAliasGrant[]
    onResolvedAliases?: (aliases: HarnessGatewayAliasGrant[]) => Promise<void>
    onGatewayRoute?: (route: import('../ports/model-client.js').ModelRouteTargetMetadata) => Promise<void>
  }
): Promise<{
  credentialIdentity: string
  env: Record<string, string>
  /**
   * Model id the harness wire must send: under `kun-gateway` the route grant
   * is scoped to `kun/<provider>/<model>`, and session transports without an
   * adapter layer (codex app-server, pi rpc) have nothing else that pins it.
   */
  wireModel?: string
}> {
  const { definition, credentialMode } = input
  const gatewayRoute =
    credentialMode === 'kun-gateway'
      ? parseGatewayModelId(input.model ?? '')
      : undefined
  let credentialIdentity = delegatedCredentialIdentity({
    providerId:
      credentialMode === 'kun-gateway'
        ? input.gatewayBinding ? `${credentialMode}:${definition.id}:alias:${harnessGatewayBindingKey(input.gatewayBinding)}`
        : `${credentialMode}:${definition.id}:` +
          `${input.providerId ?? gatewayRoute?.providerId ?? ''}:` +
          `${gatewayRoute?.model ?? input.model ?? ''}`
        : `${credentialMode}:${definition.id}`,
    accountId: input.accountId
  })
  if (input.gatewayBinding && credentialMode !== 'kun-gateway') throw new Error('Alias bindings require gateway credential mode')
  if (credentialMode === 'native-login') {
    return { credentialIdentity, env: nativeHarnessCredentialEnv(definition, { ...process.env, ...definition.launch?.env }) }
  }
  if (!resolve) {
    throw new Error(
      `credential mode '${credentialMode}' needs a serve-hosted credential resolver`
    )
  }
  let aliasWireModel: string | undefined
  const env = await resolve({
    harnessId: definition.id,
    credentialMode,
    threadId: input.threadId,
    turnId: input.turnId,
    credentialIdentity,
    providerId: input.providerId,
    model: input.model,
    gateway: definition.gateway,
    accountId: input.accountId,
    ...(input.gatewayBinding ? { gatewayBinding: input.gatewayBinding, frozenGatewayAliases: input.frozenGatewayAliases,
      onResolvedAliases: input.onResolvedAliases, onGatewayRoute: input.onGatewayRoute, onResolvedIdentity: (identity: string, model: string) => {
      credentialIdentity = identity; aliasWireModel = model
    } } : {})
  })
  const wireModel = aliasWireModel ?? (
    credentialMode === 'kun-gateway' &&
    input.providerId &&
    input.model &&
    !gatewayRoute
      ? formatGatewayModelId(input.providerId, input.model)
      : undefined)
  if (input.gatewayBinding && !aliasWireModel) throw new Error('The Agent credential resolver does not support alias bindings')
  return { credentialIdentity, env, ...(wireModel ? { wireModel } : {}) }
}
