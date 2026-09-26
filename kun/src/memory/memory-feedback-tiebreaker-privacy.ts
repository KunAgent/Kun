const MAX_SAFE_TRACE_STRING_CHARS = 512
const FORBIDDEN_KEYS = new Set(['query', 'content', 'memoryContent', 'source', 'sources', 'sourceExcerpt'])
const FORBIDDEN_VALUES = [
  /(?:^|\s)[a-z]:[\\/]/iu,
  /\\\\[^\\\s]+\\[^\s]+/u,
  /file:\/\//iu,
  /(?:^|\s)\/(?:users|home|var|tmp|etc)\//iu,
  /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/iu,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu
]

export function assertMemoryFeedbackTiebreakerPrivateArtifact(value: unknown): void {
  visit(value)
}

function visit(value: unknown): void {
  if (typeof value === 'string') {
    if (value.length > MAX_SAFE_TRACE_STRING_CHARS) {
      throw new Error('memory feedback tiebreaker artifact contains an oversized string')
    }
    if (FORBIDDEN_VALUES.some((pattern) => pattern.test(value))) {
      throw new Error('memory feedback tiebreaker artifact contains private text')
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) visit(item)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error('memory feedback tiebreaker artifact contains a forbidden text field')
    }
    visit(item)
  }
}
