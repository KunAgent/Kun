export type KnowledgeSourceNavigationLocation =
  | { kind: 'text'; lineStart: number; lineEnd: number }
  | { kind: 'pdf'; pageStart: number; pageEnd: number; expectedSha256?: string }
  | { kind: 'word'; paragraphStart: number; paragraphEnd: number }
  | { kind: 'presentation'; slideStart: number; slideEnd: number }
  | { kind: 'spreadsheet'; sheetName: string; range: string }

export type KnowledgeSourceNavigationRequest = {
  filePath: string
  location: KnowledgeSourceNavigationLocation
}

type NavigationListener = (request: KnowledgeSourceNavigationRequest) => boolean

let pending: KnowledgeSourceNavigationRequest | null = null
const listeners = new Set<NavigationListener>()

export function requestKnowledgeSourceNavigation(request: KnowledgeSourceNavigationRequest): void {
  pending = request
  deliverPending()
}

export function subscribeKnowledgeSourceNavigation(
  filePath: string,
  handler: (location: KnowledgeSourceNavigationLocation) => boolean
): () => void {
  const listener: NavigationListener = (request) => {
    if (pathKey(request.filePath) !== pathKey(filePath)) return false
    return handler(request.location)
  }
  listeners.add(listener)
  deliverPending()
  return () => listeners.delete(listener)
}

function deliverPending(): void {
  const request = pending
  if (!request) return
  for (const listener of listeners) {
    if (!listener(request)) continue
    if (pending === request) pending = null
    return
  }
}

function pathKey(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '')
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform
  return platform.toLocaleLowerCase().includes('win')
    ? normalized.toLocaleLowerCase()
    : normalized
}
