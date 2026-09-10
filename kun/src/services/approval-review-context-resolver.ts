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
  clients: { resolve(providerId?: string): ModelClient }
  routePoolProviderIds?: readonly string[]
}): ApprovalReviewModelContextResolver {
  const routePoolIds = new Set(
    (input.routePoolProviderIds ?? []).map((id) => id.trim().toLowerCase())
  )
  return (actingRoute) => {
    const selection = input.selection() ?? DEFAULT_APPROVAL_REVIEW_MODEL_SELECTION
    if (selection.mode === 'inherit') {
      const route = exactRoute(actingRoute)
      if (!route) throw new Error('the acting turn model route is unavailable')
      return { source: 'inherit', route, client: input.clients.resolve(route.providerId) }
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
      client: input.clients.resolve(route.providerId)
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
    ...(providerId ? { providerId } : {}),
    ...(accountId ? { accountId } : {})
  }
}
