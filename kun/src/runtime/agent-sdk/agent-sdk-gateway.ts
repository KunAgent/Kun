/**
 * `kun-gateway` credential mode (docs/ade/04 §5.5): the Claude SDK harness
 * reaches the loopback `kun serve` model gateway instead of a provider. This
 * module resolves the per-turn injection — base URL, a turn-scoped `kgw_`
 * grant restricted to the routed provider/model pair, and the harness's
 * expected env var names — without ever materializing provider credentials
 * into the child environment.
 */
import type { HarnessGateway, HarnessId } from '../../contracts/harness.js'
import type { RolesConfig } from '../../config/kun-config.js'
import { formatGatewayModelId } from '../../harness/gateway-model-id.js'
import type { HarnessTokenRoute, HarnessTokenService } from '../../harness/harness-token-service.js'
import { AgentSdkGatewayUnavailableError } from './agent-sdk-runtime-contracts.js'
import type { SdkGatewayEnv } from './sdk-options-builder.js'

export type AgentSdkGatewayDeps = {
  /** Issues turn-scoped gateway grants; absent means the serve runtime is not wired. */
  tokens?: Pick<HarnessTokenService, 'issue'>
  /** Loopback `kun serve` base URL; absent until the server is listening. */
  baseUrl?: () => string | undefined
  /** Roles config — supplies the small/fast model routed through the gateway. */
  roles?: () => RolesConfig | undefined
  /** The harness definition's `gateway` block (env names + strip list). */
  gateway?: () => HarnessGateway | undefined
}

export function resolveAgentSdkGatewayEnv(input: {
  deps: AgentSdkGatewayDeps
  threadId: string
  harnessId: HarnessId
  providerId: string
  model: string
}): SdkGatewayEnv {
  const gateway = input.deps.gateway?.()
  if (!gateway) {
    throw new AgentSdkGatewayUnavailableError(`harness '${input.harnessId}' declares no gateway surface`)
  }
  const baseUrl = input.deps.baseUrl?.()
  if (!baseUrl) {
    throw new AgentSdkGatewayUnavailableError('no kun serve endpoint is listening')
  }
  if (!input.deps.tokens) {
    throw new AgentSdkGatewayUnavailableError('the harness token service is not wired')
  }
  const roles = input.deps.roles?.()
  // A role preference is not consent to another Agent credential profile.
  // Keep helper requests inside the provider admitted for this turn. A small
  // model from another provider cannot safely be addressed to this provider.
  const smallProviderId = input.providerId
  const configuredSmallProviderId = roles?.smallModelProviderId?.trim() || input.providerId
  const smallModel = configuredSmallProviderId === input.providerId
    ? roles?.smallModel?.trim() || input.model : input.model
  const routes: HarnessTokenRoute[] = [
    { providerId: input.providerId, model: input.model, role: 'main' }
  ]
  if (smallProviderId !== input.providerId || smallModel !== input.model) {
    routes.push({ providerId: smallProviderId, model: smallModel, role: 'small' })
  }
  // The grant id is deterministic on (harness, credentialIdentity, thread,
  // scopes) — routes are not hashed in. Bind every route into the identity
  // so a later turn's grant can never widen a live token's route set.
  const token = input.deps.tokens.issue({
    threadId: input.threadId,
    harnessId: input.harnessId,
    credentialIdentity: `kun-gateway:${JSON.stringify(routes)}`,
    scopes: ['gateway'],
    routes
  })
  return {
    baseUrl,
    token,
    model: formatGatewayModelId(input.providerId, input.model),
    smallModel: formatGatewayModelId(smallProviderId, smallModel),
    env: gateway.env,
    stripEnv: gateway.stripEnv
  }
}
