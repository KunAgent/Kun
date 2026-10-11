import { workFileResourceKey, workWhiteboardResourceKey } from './work-resource-key'

const STORAGE_KEY = 'kun.mobile.work.resource-routes'
const MAX_ROUTES = 200
export type MobileWorkRoute = { key: string; root: string; kind: 'document' | 'whiteboard'; path: string }

function valid(route: MobileWorkRoute): boolean {
  return route.kind === 'document'
    ? workFileResourceKey(route.root, route.path) === route.key
    : workWhiteboardResourceKey(route.path) === route.key
}

function readRoutes(): MobileWorkRoute[] {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(value)) return []
    return value.filter((item): item is MobileWorkRoute => Boolean(item) &&
      typeof item.key === 'string' && typeof item.root === 'string' &&
      typeof item.path === 'string' && (item.kind === 'document' || item.kind === 'whiteboard') && valid(item))
  } catch { return [] }
}

export function rememberMobileWorkRoute(route: MobileWorkRoute): void {
  if (!route.root.trim() || !route.path.trim() || !valid(route)) return
  try {
    const routes = readRoutes()
    const next = [route, ...routes.filter((item) => item.key !== route.key)].slice(0, MAX_ROUTES)
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch { /* private mode or stale state */ }
}

export function readMobileWorkRoute(key: string, workspaces: readonly string[]): MobileWorkRoute | null {
  const route = readRoutes().find((item) => item.key === key)
  return route && workspaces.includes(route.root) ? route : null
}
