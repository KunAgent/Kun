import type { ActingTurnModelRoute } from '../contracts/turns.js'
import type { ModelRouteTargetMetadata } from '../ports/model-client.js'

/** The provisional object is shared with tool gates; publish its concrete source before exposing tool output. */
export function observeHarnessAliasRoute(acting: ActingTurnModelRoute, requestedAlias: string,
  save: (route: ActingTurnModelRoute) => Promise<void>): (route: ModelRouteTargetMetadata) => Promise<void> {
  let pending: Promise<void> | undefined
  return async (route) => {
    if (route.requestedModelId !== requestedAlias || !acting.unresolvedGatewayAlias) return
    pending ??= (async () => {
      const resolved = { model: route.modelId, providerId: route.providerId, requestedGatewayAlias: requestedAlias }
      await save(resolved)
      Object.assign(acting, resolved, { accountId: undefined, unresolvedGatewayAlias: undefined })
    })()
    await pending
  }
}
