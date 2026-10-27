import type { ChatBlock, ToolBlock } from './types'
import type { CoreTurnItemJson } from './kun-contract'
import { payloadFor } from './kun-mapper-core'

/** Kun tool the Code agent calls to put finished screens on the Design canvas. */
export const DESIGN_OPEN_TOOL_NAME = 'design_open'

const TITLE_MAX_CHARS = 120
const MAX_SCREENS = 12
const SECTION_MAX_CHARS = 60
const REQUEST_ID_PATTERN = /^design_[0-9a-f]{16}$/
const DOCUMENT_ID_PATTERN = /^[0-9a-f]{8}$/

export type DesignOpenScreenMetadata = {
  artifactId: string
  name: string
  relativePath: string
  width: number
  height: number
  section?: string
}

/**
 * Renderer view of one `design_open` call. `pending` is the streamed call
 * (screen names only, never their HTML); `ready` carries the screens Kun wrote
 * into `.kun-design/<documentId>/<artifactId>/v1.html`. `legacy` is a request
 * from the earlier queued-pass contract, kept readable in old transcripts.
 */
export type DesignOpenRequestMetadata = {
  status: 'pending' | 'ready' | 'legacy' | 'failed'
  title: string
  screenCount: number
  screens: DesignOpenScreenMetadata[]
  requestId?: string
  documentId?: string
  target?: 'web' | 'app'
  error?: string
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function target(value: unknown): 'web' | 'app' | undefined {
  return value === 'web' || value === 'app' ? value : undefined
}

function positive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback
}

/** Written screens, accepted only inside their own design document folder. */
function readyScreens(value: unknown, documentId: string): DesignOpenScreenMetadata[] {
  if (!Array.isArray(value)) return []
  const screens: DesignOpenScreenMetadata[] = []
  for (const item of value.slice(0, MAX_SCREENS)) {
    const entry = record(item)
    const artifactId = text(entry?.artifactId, 16)
    const name = text(entry?.name, TITLE_MAX_CHARS)
    const relativePath = text(entry?.relativePath, 200)
    if (!/^[0-9a-f]{8}$/.test(artifactId) || !name) continue
    if (relativePath !== `.kun-design/${documentId}/${artifactId}/v1.html`) continue
    const section = text(entry?.section, SECTION_MAX_CHARS)
    screens.push({
      artifactId,
      name,
      relativePath,
      width: positive(entry?.width, 1280),
      height: positive(entry?.height, 800),
      ...(section ? { section } : {})
    })
  }
  return screens
}

function pendingRequest(args: Record<string, unknown>): DesignOpenRequestMetadata | undefined {
  const title = text(args.title, TITLE_MAX_CHARS)
  const rawScreens = Array.isArray(args.screens) ? args.screens : []
  if (!title && rawScreens.length === 0) return undefined
  const resolvedTarget = target(args.target)
  return {
    status: 'pending',
    title: title || 'Design',
    screenCount: Math.min(rawScreens.length, MAX_SCREENS),
    screens: [],
    ...(resolvedTarget ? { target: resolvedTarget } : {})
  }
}

function fromRequest(request: Record<string, unknown>): DesignOpenRequestMetadata | undefined {
  const title = text(request.title, TITLE_MAX_CHARS)
  const requestId = typeof request.requestId === 'string' && REQUEST_ID_PATTERN.test(request.requestId)
    ? request.requestId
    : undefined
  if (!title || !requestId) return undefined
  const resolvedTarget = target(request.target)
  const documentId = typeof request.documentId === 'string' && DOCUMENT_ID_PATTERN.test(request.documentId)
    ? request.documentId
    : undefined
  if (request.status === 'ready' && documentId) {
    const screens = readyScreens(request.screens, documentId)
    if (screens.length === 0) return undefined
    return {
      status: 'ready',
      title,
      requestId,
      documentId,
      screens,
      screenCount: screens.length,
      ...(resolvedTarget ? { target: resolvedTarget } : {})
    }
  }
  if (request.status !== 'queued') return undefined
  return {
    status: 'legacy',
    title,
    requestId,
    screens: [],
    screenCount: 0,
    ...(resolvedTarget ? { target: resolvedTarget } : {})
  }
}

export function extractDesignOpenRequest(item: CoreTurnItemJson): DesignOpenRequestMetadata | undefined {
  if (item.toolName !== DESIGN_OPEN_TOOL_NAME) return undefined
  if (item.kind !== 'tool_result') return pendingRequest(record(item.arguments) ?? {})
  const payload = payloadFor(item)
  const request = record(payload.designRequest)
  const parsed = !item.isError && payload.ok !== false && request ? fromRequest(request) : undefined
  if (parsed) return parsed
  const fallback = pendingRequest(record(item.arguments) ?? request ?? {})
  return {
    status: 'failed',
    title: fallback?.title || 'Design',
    screenCount: fallback?.screenCount ?? 0,
    screens: [],
    error: text(payload.error, 400) || 'design_open failed'
  }
}

/** Validated read of the metadata the mapper attached to a tool block. */
export function readDesignOpenRequest(block: ChatBlock): DesignOpenRequestMetadata | undefined {
  if (block.kind !== 'tool' || block.meta?.toolName !== DESIGN_OPEN_TOOL_NAME) return undefined
  const meta = record(block.meta.designOpenRequest)
  if (!meta) return undefined
  if (meta.status === 'failed') {
    return {
      status: 'failed',
      title: text(meta.title, TITLE_MAX_CHARS) || 'Design',
      screenCount: positive(meta.screenCount, 0),
      screens: [],
      error: text(meta.error, 400) || 'design_open failed'
    }
  }
  if (meta.status === 'pending') {
    return {
      status: 'pending',
      title: text(meta.title, TITLE_MAX_CHARS) || 'Design',
      screenCount: Math.min(positive(meta.screenCount, 0), MAX_SCREENS),
      screens: [],
      ...(target(meta.target) ? { target: target(meta.target) } : {})
    }
  }
  return fromRequest({
    ...meta,
    status: meta.status === 'legacy' ? 'queued' : meta.status
  })
}

export function designOpenStatusOverride(
  item: CoreTurnItemJson,
  request: DesignOpenRequestMetadata | undefined
): ToolBlock['status'] | undefined {
  if (item.toolName !== DESIGN_OPEN_TOOL_NAME || !request) return undefined
  if (request.status === 'failed') return 'error'
  // A pending call keeps the runtime item status so an aborted call settles.
  return request.status === 'pending' ? undefined : 'success'
}

export function isDesignOpenBlock(block: ChatBlock): block is ToolBlock {
  return block.kind === 'tool' && Boolean(readDesignOpenRequest(block))
}

function titleKey(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/gu, ' ')
}

/**
 * An agent builds a multi-board design over several `design_open` calls with
 * the same title (Kun maps that title to one document). The transcript shows
 * one card per design, in the order each design first appeared.
 */
export function groupDesignOpenBlocks(blocks: readonly ToolBlock[]): ToolBlock[][] {
  const groups = new Map<string, ToolBlock[]>()
  for (const block of blocks) {
    const request = readDesignOpenRequest(block)
    const key = request ? titleKey(request.title) : block.id
    const group = groups.get(key)
    if (group) group.push(block)
    else groups.set(key, [block])
  }
  return [...groups.values()]
}

/**
 * One view of a design built across calls: every written board (a later call
 * that rewrites a board wins), the newest call's status, and a pending call's
 * boards counted while it streams. Earlier boards stay openable when a later
 * call fails or is still running.
 */
export function mergeDesignOpenRequests(
  requests: readonly DesignOpenRequestMetadata[]
): DesignOpenRequestMetadata | undefined {
  const last = requests[requests.length - 1]
  if (!last || requests.length === 1) return last
  const screens = new Map<string, DesignOpenScreenMetadata>()
  let latestReady: DesignOpenRequestMetadata | undefined
  for (const request of requests) {
    if (request.status !== 'ready') continue
    latestReady = request
    for (const screen of request.screens) screens.set(screen.artifactId, screen)
  }
  if (!latestReady) return last
  const merged = [...screens.values()]
  const base: DesignOpenRequestMetadata = { ...latestReady, screens: merged, screenCount: merged.length }
  if (last.status === 'pending') {
    return { ...base, status: 'pending', screenCount: merged.length + last.screenCount }
  }
  return base
}
