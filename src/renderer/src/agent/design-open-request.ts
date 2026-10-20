import type { ChatBlock, ToolBlock } from './types'
import type { CoreTurnItemJson } from './kun-contract'
import { payloadFor } from './kun-mapper-core'

/** Kun tool the Code agent calls to hand a brief to the Design canvas. */
export const DESIGN_OPEN_TOOL_NAME = 'design_open'

const TITLE_MAX_CHARS = 120
const BRIEF_MAX_CHARS = 6_000
const REQUEST_ID_PATTERN = /^design_[0-9a-f]{16}$/

/**
 * Renderer view of one `design_open` call. `pending` covers the streamed tool
 * call before Kun returns the queued request; only a `queued` request carries
 * the durable `requestId` the workbench dispatches exactly once.
 */
export type DesignOpenRequestMetadata = {
  status: 'pending' | 'queued' | 'failed'
  title: string
  brief: string
  requestId?: string
  target?: 'web' | 'app'
  medium?: 'html' | 'image'
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

function medium(value: unknown): 'html' | 'image' | undefined {
  return value === 'html' || value === 'image' ? value : undefined
}

function fromFields(
  source: Record<string, unknown>,
  status: DesignOpenRequestMetadata['status']
): DesignOpenRequestMetadata | undefined {
  const title = text(source.title, TITLE_MAX_CHARS)
  const brief = text(source.brief, BRIEF_MAX_CHARS)
  if (!title && !brief) return undefined
  const requestId = typeof source.requestId === 'string' && REQUEST_ID_PATTERN.test(source.requestId)
    ? source.requestId
    : undefined
  if (status === 'queued' && !requestId) return undefined
  const resolvedTarget = target(source.target)
  const resolvedMedium = medium(source.medium)
  return {
    status,
    title: title || brief.slice(0, 48),
    brief,
    ...(requestId ? { requestId } : {}),
    ...(resolvedTarget ? { target: resolvedTarget } : {}),
    ...(resolvedMedium ? { medium: resolvedMedium } : {})
  }
}

export function extractDesignOpenRequest(item: CoreTurnItemJson): DesignOpenRequestMetadata | undefined {
  if (item.toolName !== DESIGN_OPEN_TOOL_NAME) return undefined
  if (item.kind !== 'tool_result') {
    return fromFields(record(item.arguments) ?? {}, 'pending')
  }
  const payload = payloadFor(item)
  const request = record(payload.designRequest)
  if (item.isError || !request || payload.ok === false) {
    const error = text(payload.error, 400) || 'design_open failed'
    const fallback = fromFields(request ?? record(item.arguments) ?? {}, 'pending')
    return {
      status: 'failed',
      title: fallback?.title || 'Design',
      brief: fallback?.brief || '',
      error
    }
  }
  return fromFields(request, 'queued')
}

/** Validated read of the metadata the mapper attached to a tool block. */
export function readDesignOpenRequest(block: ChatBlock): DesignOpenRequestMetadata | undefined {
  if (block.kind !== 'tool' || block.meta?.toolName !== DESIGN_OPEN_TOOL_NAME) return undefined
  const meta = record(block.meta.designOpenRequest)
  if (!meta) return undefined
  const status = meta.status === 'queued' || meta.status === 'failed' || meta.status === 'pending'
    ? meta.status
    : null
  if (!status) return undefined
  if (status === 'failed') {
    return {
      status,
      title: text(meta.title, TITLE_MAX_CHARS) || 'Design',
      brief: text(meta.brief, BRIEF_MAX_CHARS),
      error: text(meta.error, 400) || 'design_open failed'
    }
  }
  return fromFields(meta, status)
}

export function designOpenStatusOverride(
  item: CoreTurnItemJson,
  request: DesignOpenRequestMetadata | undefined
): ToolBlock['status'] | undefined {
  if (item.toolName !== DESIGN_OPEN_TOOL_NAME || !request) return undefined
  if (request.status === 'failed') return 'error'
  // A pending call keeps the runtime item status so an aborted call settles.
  return request.status === 'queued' ? 'success' : undefined
}

export function isDesignOpenBlock(block: ChatBlock): block is ToolBlock {
  return block.kind === 'tool' && Boolean(readDesignOpenRequest(block))
}
