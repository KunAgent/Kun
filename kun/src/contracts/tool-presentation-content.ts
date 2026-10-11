import type { ToolPresentationContent } from './tool-presentation.js'

export const TOOL_PRESENTATION_CONTENT_BUDGET = 256 * 1024
export const TOOL_PRESENTATION_MAX_CONTENT_BLOCKS = 32

/** Preserve inline evidence, never dereference a URI or retain partial base64. */
export function boundedToolPresentationContent(values: unknown): {
  content?: ToolPresentationContent[]; truncated?: boolean
} {
  if (!Array.isArray(values) || values.length === 0) return {}
  let remaining = TOOL_PRESENTATION_CONTENT_BUDGET
  let truncated = values.length > TOOL_PRESENTATION_MAX_CONTENT_BLOCKS
  const text = (value: unknown, max = 64 * 1024): string | undefined => {
    if (typeof value !== 'string') return undefined
    const take = Math.max(0, Math.min(remaining, max))
    if (value.length > take) truncated = true
    const result = value.slice(0, take)
    remaining -= result.length
    return result
  }
  const content = values.slice(0, TOOL_PRESENTATION_MAX_CONTENT_BLOCKS).map((value): ToolPresentationContent => {
    const wrapper = record(value)
    const block = wrapper.type === 'content' ? record(wrapper.content) : wrapper
    const result: ToolPresentationContent = { type: typeof block.type === 'string' ? block.type.slice(0, 100) : 'unknown' }
    for (const key of ['uri', 'name', 'mimeType'] as const) {
      const value = text(block[key], 4_096)
      if (value !== undefined) result[key] = value
    }
    if (typeof block.text === 'string') result.text = text(block.text)
    const binary = (value: unknown): string | undefined => {
      if (typeof value !== 'string') return undefined
      if (value.length > remaining) {
        result.omitted = true; result.originalBytes = value.length; truncated = true
        return undefined
      }
      remaining -= value.length
      return value
    }
    if (typeof block.data === 'string') result.data = binary(block.data)
    if (block.resource && typeof block.resource === 'object') {
      const resource = record(block.resource)
      result.resource = {
        uri: text(resource.uri, 4_096), mimeType: text(resource.mimeType, 256),
        text: text(resource.text), blob: binary(resource.blob)
      }
    }
    if (!['text', 'image', 'audio', 'resource_link', 'resource'].includes(result.type)) {
      try {
        const raw = JSON.stringify(block)
        result.raw = raw.length <= remaining ? block : { preview: text(raw), omitted: true }
        if (raw.length <= remaining) remaining -= raw.length
        else { truncated = true; result.omitted = true }
      } catch { result.omitted = true; truncated = true }
    }
    return result
  })
  return { content, ...(truncated ? { truncated: true } : {}) }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
