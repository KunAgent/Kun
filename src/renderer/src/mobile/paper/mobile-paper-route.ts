import { paperResourceKey } from './paper-resource-key'

const STORAGE_KEY = 'kun.mobile.paper.resource-routes'
const MAX_ROUTES = 200

export type MobilePaperRoute = { key: string; root: string; unitDir: string }

function readRoutes(): MobilePaperRoute[] {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is MobilePaperRoute => Boolean(item) &&
      typeof item.key === 'string' && typeof item.root === 'string' && typeof item.unitDir === 'string' &&
      paperResourceKey(item.root, item.unitDir) === item.key) : []
  } catch { return [] }
}

export function rememberMobilePaperRoute(root: string, unitDir: string): string {
  const key = paperResourceKey(root, unitDir)
  if (!root.trim() || !unitDir.trim()) return key
  try {
    const next = [{ key, root, unitDir }, ...readRoutes().filter((item) => item.key !== key)].slice(0, MAX_ROUTES)
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch { /* private mode */ }
  return key
}

export function readMobilePaperRoute(key: string, libraries: readonly string[]): MobilePaperRoute | null {
  const route = readRoutes().find((item) => item.key === key)
  return route && libraries.includes(route.root) ? route : null
}
