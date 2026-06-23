/**
 * RouteRegistry – dynamic API route table for the renderer.
 *
 * Problem (GitHub Issue #237): after a backend route refactor, hardcoded
 * paths in the GUI become stale and return 404 (e.g. /v1/tools → /v1/runtime/tools).
 * The RouteRegistry fetches the canonical route table from the server at
 * startup and resolves all paths through it. If the fetch fails, it falls
 * back to a compile-time default table so the GUI never crashes.
 */

import {
  KUN_HEALTH_PATH,
  KUN_RUNTIME_INFO_PATH,
  KUN_RUNTIME_TOOLS_PATH,
  KUN_SKILLS_PATH,
  KUN_ATTACHMENTS_PATH,
  KUN_ATTACHMENT_DIAGNOSTICS_PATH,
  KUN_ATTACHMENT_TEMPLATE,
  KUN_ATTACHMENT_CONTENT_TEMPLATE,
  KUN_MEMORY_PATH,
  KUN_MEMORY_DIAGNOSTICS_PATH,
  KUN_MEMORY_RECORD_TEMPLATE,
  KUN_THREADS_PATH,
  KUN_THREAD_TEMPLATE,
  KUN_THREAD_FORK_TEMPLATE,
  KUN_THREAD_GOAL_TEMPLATE,
  KUN_THREAD_TODOS_TEMPLATE,
  KUN_THREAD_COMPACT_TEMPLATE,
  KUN_THREAD_REVIEW_TEMPLATE,
  KUN_THREAD_REWIND_TEMPLATE,
  KUN_THREAD_TURNS_TEMPLATE,
  KUN_THREAD_STEER_TEMPLATE,
  KUN_THREAD_INTERRUPT_TEMPLATE,
  KUN_THREAD_EVENTS_TEMPLATE,
  KUN_APPROVAL_TEMPLATE,
  KUN_USER_INPUT_TEMPLATE,
  KUN_SESSION_RESUME_TEMPLATE,
  KUN_USAGE_PATH,
  KUN_DEBUG_LLM_ROUNDS_PATH,
  KUN_ROUTES_PATH,
} from '@shared/kun-endpoints'

export type RouteEntry = { key: string; methods: string[]; path: string }
export type RouteMap = Record<string, RouteEntry>

const DEFAULT_ROUTES: RouteEntry[] = [
  { key: 'health', methods: ['GET'], path: KUN_HEALTH_PATH },
  { key: 'routes', methods: ['GET'], path: KUN_ROUTES_PATH },
  { key: 'runtime.info', methods: ['GET'], path: KUN_RUNTIME_INFO_PATH },
  { key: 'runtime.tools', methods: ['GET'], path: KUN_RUNTIME_TOOLS_PATH },
  { key: 'skills', methods: ['GET'], path: KUN_SKILLS_PATH },
  { key: 'attachments', methods: ['POST'], path: KUN_ATTACHMENTS_PATH },
  { key: 'attachments.diagnostics', methods: ['GET'], path: KUN_ATTACHMENT_DIAGNOSTICS_PATH },
  { key: 'attachment', methods: ['GET'], path: KUN_ATTACHMENT_TEMPLATE },
  { key: 'attachment.content', methods: ['GET'], path: KUN_ATTACHMENT_CONTENT_TEMPLATE },
  { key: 'memory', methods: ['GET', 'POST'], path: KUN_MEMORY_PATH },
  { key: 'memory.diagnostics', methods: ['GET'], path: KUN_MEMORY_DIAGNOSTICS_PATH },
  { key: 'memory.record', methods: ['PATCH', 'DELETE'], path: KUN_MEMORY_RECORD_TEMPLATE },
  { key: 'threads', methods: ['GET', 'POST'], path: KUN_THREADS_PATH },
  { key: 'thread', methods: ['GET', 'PATCH', 'DELETE'], path: KUN_THREAD_TEMPLATE },
  { key: 'thread.fork', methods: ['POST'], path: KUN_THREAD_FORK_TEMPLATE },
  { key: 'thread.goal', methods: ['GET', 'POST', 'DELETE'], path: KUN_THREAD_GOAL_TEMPLATE },
  { key: 'thread.todos', methods: ['GET', 'POST', 'DELETE'], path: KUN_THREAD_TODOS_TEMPLATE },
  { key: 'thread.compact', methods: ['POST'], path: KUN_THREAD_COMPACT_TEMPLATE },
  { key: 'thread.review', methods: ['POST'], path: KUN_THREAD_REVIEW_TEMPLATE },
  { key: 'thread.rewind', methods: ['POST'], path: KUN_THREAD_REWIND_TEMPLATE },
  { key: 'thread.turns', methods: ['POST'], path: KUN_THREAD_TURNS_TEMPLATE },
  { key: 'thread.steer', methods: ['POST'], path: KUN_THREAD_STEER_TEMPLATE },
  { key: 'thread.interrupt', methods: ['POST'], path: KUN_THREAD_INTERRUPT_TEMPLATE },
  { key: 'thread.events', methods: ['GET'], path: KUN_THREAD_EVENTS_TEMPLATE },
  { key: 'approval', methods: ['POST'], path: KUN_APPROVAL_TEMPLATE },
  { key: 'user-input', methods: ['POST'], path: KUN_USER_INPUT_TEMPLATE },
  { key: 'session.resume', methods: ['POST'], path: KUN_SESSION_RESUME_TEMPLATE },
  { key: 'usage', methods: ['GET'], path: KUN_USAGE_PATH },
  { key: 'debug.llm-rounds', methods: ['GET'], path: KUN_DEBUG_LLM_ROUNDS_PATH },
]

function buildRouteMap(entries: RouteEntry[]): RouteMap {
  const map: RouteMap = {}
  for (const entry of entries) map[entry.key] = entry
  return map
}

function fillTemplate(template: string, params: Record<string, string> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key]
    if (value === undefined) throw new Error(`RouteRegistry: missing parameter "${key}" for "${template}"`)
    return encodeURIComponent(value)
  })
}

export type RouteRegistryFetch = (path: string, method?: string) => Promise<{ ok: boolean; status: number; body: string }>

export class RouteRegistry {
  private routes: RouteMap = buildRouteMap(DEFAULT_ROUTES)
  private loaded = false
  private loadPromise: Promise<void> | null = null
  private source: 'server' | 'default' = 'default'

  async init(fetchFn: RouteRegistryFetch): Promise<void> {
    if (this.loaded) return
    if (this.loadPromise) return this.loadPromise
    this.loadPromise = this.loadFromServer(fetchFn).catch(() => {
      this.routes = buildRouteMap(DEFAULT_ROUTES)
      this.source = 'default'
    }).finally(() => { this.loaded = true })
    return this.loadPromise
  }

  private async loadFromServer(fetchFn: RouteRegistryFetch): Promise<void> {
    const result = await fetchFn(KUN_ROUTES_PATH, 'GET')
    if (!result.ok) throw new Error(`Failed to fetch routes: HTTP ${result.status}`)
    const parsed = JSON.parse(result.body) as { routes?: Array<{ method: string; path: string }> }
    if (!parsed.routes || !Array.isArray(parsed.routes)) throw new Error('Invalid routes response')
    const entries: RouteEntry[] = parsed.routes.map((r, i) => ({
      key: `server.${i}`,
      methods: [r.method],
      path: r.path,
    }))
    this.routes = buildRouteMap(entries)
    this.source = 'server'
  }

  isFromServer(): boolean { return this.source === 'server' }

  getEntry(key: string): RouteEntry | undefined { return this.routes[key] }

  path(key: string, params: Record<string, string> = {}): string {
    const entry = this.routes[key]
    if (!entry) throw new Error(`RouteRegistry: unknown route key "${key}"`)
    return fillTemplate(entry.path, params)
  }

  entries(): RouteEntry[] { return Object.values(this.routes) }
}

export const routeRegistry = new RouteRegistry()
