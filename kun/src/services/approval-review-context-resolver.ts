import {
  DEFAULT_APPROVAL_REVIEW_MODEL_SELECTION,
  type ApprovalReviewModelSelection
} from '../contracts/approval-review-config.js'
import { LOCAL_MODEL_GATEWAY_PROVIDER_ID } from '../contracts/model-route-pool.js'
import type { ApprovalReviewModelRoute } from '../ports/approval-review.js'
import type { ModelClient } from '../ports/model-client.js'

export type ApprovalReviewModelContext = {
  source: ApprovalReviewModelSelection['mode']
  route: ApprovalReviewModelRoute
  client: Pick<ModelClient, 'stream'>
}

export type ApprovalReviewModelContextResolver = (
  actingRoute?: ApprovalReviewModelRoute
) => ApprovalReviewModelContext

/** Resolve one immutable review route/client before the first await. */
export function createApprovalReviewModelContextResolver(input: {
  selection: () => ApprovalReviewModelSelection | undefined
  clients: { resolve(providerId?: string): ModelClient; capture?(providerId?: string): ModelClient }
  routePoolProviderIds?: readonly string[]
  inheritedRouteAllowed?: (route: ApprovalReviewModelRoute) => boolean
}): ApprovalReviewModelContextResolver {
  const routePoolIds = new Set(
    (input.routePoolProviderIds ?? []).map((id) => id.trim().toLowerCase())
  )
  return (actingRoute) => {
    const selection = input.selection() ?? DEFAULT_APPROVAL_REVIEW_MODEL_SELECTION
    if (selection.mode === 'inherit') {
      const route = exactRoute(actingRoute)
      if (!route || route.unresolvedGatewayAlias) throw new Error('the acting turn model route is unavailable until the gateway resolves its first upstream')
      if (input.inheritedRouteAllowed && !input.inheritedRouteAllowed(route)) throw new Error('The acting gateway target is no longer allowed; automatic review will not substitute another provider')
      return { source: 'inherit', route, client: input.clients.capture?.(route.providerId) ?? input.clients.resolve(route.providerId) }
    }
    if (!selection.providerId.trim() || !selection.model.trim()) {
      throw new Error('the fixed approval review route is incomplete')
    }
    const route = exactRoute({
      model: selection.model,
      providerId: selection.providerId,
      ...(selection.accountId ? { accountId: selection.accountId } : {})
    })
    if (!route?.providerId) throw new Error('the fixed approval review route is incomplete')
    const providerId = route.providerId.trim().toLowerCase()
    if (
      providerId === LOCAL_MODEL_GATEWAY_PROVIDER_ID ||
      providerId.startsWith('route-pool:') ||
      routePoolIds.has(providerId)
    ) {
      throw new Error('route pools cannot provide an isolated approval review route')
    }
    return {
      source: 'fixed',
      route,
      client: input.clients.capture?.(route.providerId) ?? input.clients.resolve(route.providerId)
    }
  }
}

function exactRoute(route: ApprovalReviewModelRoute | undefined): ApprovalReviewModelRoute | null {
  const model = route?.model.trim() ?? ''
  if (!model) return null
  const providerId = route?.providerId?.trim()
  const accountId = route?.accountId?.trim()
  return {
    model,
    ...(route?.unresolvedGatewayAlias ? { unresolvedGatewayAlias: true as const } : {}),
    ...(route?.requestedGatewayAlias ? { requestedGatewayAlias: route.requestedGatewayAlias } : {}),
    ...(providerId ? { providerId } : {}),
    ...(accountId ? { accountId } : {})
  }
}
