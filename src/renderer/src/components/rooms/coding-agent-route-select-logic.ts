import { codingRouteKey, type CodingAgentRoute } from './coding-agent-client'

export type CodingRouteRow = { key: string; route: CodingAgentRoute; name: string }
export type CodingRouteGroup = {
  id: string; label: string; gateway: boolean; mode?: CodingAgentRoute['credentialMode']; rows: CodingRouteRow[]
}

/** i18n keys (common) naming where a route's credentials come from. */
export const CODING_ROUTE_SOURCE_LABELS = {
  'native-login': 'directCodingAgentOwnSignIn',
  'kun-gateway': 'directCodingAgentViaGateway',
  provider: 'directCodingAgentViaProvider'
} as const

/** `openai/gpt-5.4` -> vendor `openai`, name `gpt-5.4`; bare ids have no vendor. */
export function splitCodingModel(model: string): { vendor: string; name: string } {
  const slash = model.indexOf('/')
  return slash > 0 && slash < model.length - 1
    ? { vendor: model.slice(0, slash), name: model.slice(slash + 1) }
    : { vendor: '', name: model }
}

/**
 * Routes grouped by model vendor, gateway routes kept apart from the engine's
 * own ones. Every query word must appear in the model id.
 */
export function codingRouteGroups(routes: readonly CodingAgentRoute[], query = ''): CodingRouteGroup[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const groups = new Map<string, CodingRouteGroup>()
  for (const route of routes) {
    const model = route.model.toLowerCase()
    if (!words.every((word) => model.includes(word))) continue
    const { vendor, name } = splitCodingModel(route.model)
    const gateway = route.credentialMode === 'kun-gateway'
    const id = `${gateway ? 'gateway' : 'own'}:${vendor}`
    const group = groups.get(id) ?? { id, label: vendor, gateway, mode: route.credentialMode, rows: [] }
    group.rows.push({ key: codingRouteKey(route), route, name })
    groups.set(id, group)
  }
  return [...groups.values()]
}

/** Search only pays off once the list no longer fits at a glance. */
export const CODING_ROUTE_SEARCH_THRESHOLD = 8
