import type { HarnessGatewayBinding } from '../contracts/harness-gateway-binding.js'
import type {
  HarnessCredentialMode,
  HarnessDefinition,
  HarnessId,
  HarnessRoute
} from '../contracts/harness.js'

/** The engine fields a role (or an explicit dispatch) may pin. */
export type HarnessRoutePin = {
  model?: string
  providerId?: string
  credentialMode?: HarnessCredentialMode
  gatewayBinding?: HarnessGatewayBinding
}

export type HarnessRouteResolutionDeps = {
  /** The configured model for a provider-backed route. */
  configuredModel?: (harnessId: string, providerId: string | undefined, mode: HarnessCredentialMode) => string | undefined
  /** The concrete model behind a gateway alias binding. */
  gatewayAliasModel?: (binding: HarnessGatewayBinding) => string | undefined
}

/**
 * Turn an engine binding into a concrete route: credential path, model and
 * provider. Shared by the worker selector and the agent roster so a role pinned
 * to an engine resolves to the same route on every dispatch lane.
 */
export function resolveHarnessRoute(input: {
  harnessId: HarnessId
  definition: HarnessDefinition | undefined
  pin?: HarnessRoutePin
  deps: HarnessRouteResolutionDeps
  /** The dispatching turn's own route; the default for provider-sourced engines. */
  parent: { model?: string; providerId?: string }
}): { route: HarnessRoute; rejectedReason?: string } {
  const { harnessId, definition: def, pin, deps, parent } = input
  if (!def) {
    return {
      route: { harnessId, model: '-', credentialMode: 'provider' },
      rejectedReason: `unknown harness ${harnessId}`
    }
  }
  const credentialMode = pin?.credentialMode ?? (pin?.gatewayBinding ? 'kun-gateway' : def.credentialModes[0])
  if (!credentialMode || !def.credentialModes.includes(credentialMode)) {
    return {
      route: { harnessId, model: '-', credentialMode: credentialMode ?? 'provider' },
      rejectedReason: `credentialMode ${credentialMode ?? '(none)'} is not supported by harness ${def.id}`
    }
  }
  if (pin?.gatewayBinding && (credentialMode !== 'kun-gateway' || !def.gateway || (pin.gatewayBinding.small && !def.gateway.env.smallModel) || !deps.gatewayAliasModel?.(pin.gatewayBinding))) return {
    route: { harnessId: def.id, model: '-', credentialMode, gatewayBinding: pin.gatewayBinding }, rejectedReason: 'Agent gateway alias is unavailable'
  }
  const model =
    (pin?.gatewayBinding ? deps.gatewayAliasModel?.(pin.gatewayBinding) : pin?.model?.trim()) ||
    deps.configuredModel?.(def.id, pin?.providerId, credentialMode) || def.staticModels[0] ||
    (def.modelSource === 'provider' ? parent.model?.trim() : '') ||
    ''
  if (!model) {
    return {
      route: { harnessId, model: '-', credentialMode },
      rejectedReason: `harness ${def.id} advertises no model; set agent.model explicitly`
    }
  }
  const providerId =
    credentialMode === 'native-login' || pin?.gatewayBinding
      ? undefined
      : pin?.providerId?.trim() ||
        (def.modelSource === 'provider' ? parent.providerId?.trim() : undefined)
  return {
    route: { harnessId: def.id, model, ...(providerId ? { providerId } : {}), credentialMode,
      ...(pin?.gatewayBinding ? { gatewayBinding: pin.gatewayBinding } : {}) }
  }
}
