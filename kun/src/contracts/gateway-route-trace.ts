import type { RouteDecisionSource } from '../ports/model-client.js'

/**
 * Gateway route traces: which concrete provider/model a routed alias picked
 * for an external agent's request, why, and every fallback it tried. Shared by
 * the client-facing `/v1/kun/route` long-poll and the admin recent list.
 * Nothing about prompt content is retained.
 */
export type GatewayRouteTry = {
  providerId: string
  modelId: string
  /** Why this member was tried. */
  decision?: RouteDecisionSource
  /** Failure reason that made the router move on, when this try failed. */
  fail?: string
}

export type GatewayRouteTrace = {
  seq: number
  requestId: string
  asked: string
  agent?: string
  /** Gateway client name (admin list only). */
  client?: string
  startedAt: string
  /** The provider/model being tried now, once routing has decided. */
  model?: string
  effort?: string
  tries: GatewayRouteTry[]
  done: boolean
  status?: 'completed' | 'failed' | 'cancelled'
  /** The concrete provider/model that produced the reply. */
  served?: string
  /** What put the first member first. */
  decision?: RouteDecisionSource
  /** Route rule that decided the turn's first member. */
  rule?: string
  /** Intent the pool's classifier assigned. */
  intent?: string
  firstTokenMs?: number
  durationMs?: number
}

export type { RouteDecisionSource }
