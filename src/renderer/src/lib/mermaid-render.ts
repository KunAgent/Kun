/**
 * Lazy, serialized Mermaid rendering (implementation §7.2).
 *
 * - `mermaid` is loaded on first use; renders are queued because
 *   `mermaid.render` mutates a global element id.
 * - Successful SVGs are cached per `(theme, code)` in a small LRU.
 */
type MermaidModule = typeof import('mermaid').default

let mermaidPromise: Promise<MermaidModule> | null = null
let queue: Promise<unknown> = Promise.resolve()

const MERMAID_CACHE_MAX = 64
const cache = new Map<string, string>()

function loadMermaid(): Promise<MermaidModule> {
  mermaidPromise ??= import('mermaid').then((m) => m.default)
  return mermaidPromise
}

export type MermaidRenderResult =
  | { ok: true; svg: string }
  | { ok: false; message: string }

export function renderMermaid(code: string, theme: 'light' | 'dark'): Promise<MermaidRenderResult> {
  const key = `${theme}\0${code}`
  const hit = cache.get(key)
  if (hit !== undefined) {
    // Refresh LRU position.
    cache.delete(key)
    cache.set(key, hit)
    return Promise.resolve({ ok: true, svg: hit })
  }
  const task = queue
    .then(async (): Promise<MermaidRenderResult> => {
      const mermaid = await loadMermaid()
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: theme === 'dark' ? 'dark' : 'default'
      })
      const { svg } = await mermaid.render(`kun-mmd-${crypto.randomUUID()}`, code)
      cache.delete(key)
      cache.set(key, svg)
      while (cache.size > MERMAID_CACHE_MAX) {
        const oldest = cache.keys().next().value
        if (oldest === undefined) break
        cache.delete(oldest)
      }
      return { ok: true, svg }
    })
    .catch((error): MermaidRenderResult => ({
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }))
  queue = task.then(() => undefined)
  return task
}

export function clearMermaidCache(): void {
  cache.clear()
}
