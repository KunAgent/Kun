const CONTEXT_OVERFLOW_CODES = new Set([
  'context_length_exceeded',
  'context_window_exceeded',
  'context_overflow',
  'input_too_long',
  'max_context_length_exceeded',
  'prompt_too_long'
])

const CONTEXT_OVERFLOW_PATTERNS = [
  /maximum context (?:length|window)/iu,
  /context (?:length|window).{0,80}(?:exceed|overflow|too (?:large|long))/iu,
  /(?:prompt|input).{0,80}too (?:large|long)/iu,
  /too many (?:input )?tokens/iu,
  /reduce (?:the )?(?:length|number) of (?:the )?(?:messages|prompt|input)/iu,
  /token limit.{0,40}(?:exceed|overflow)/iu,
  // Provider-specific variants: "exceeded model token limit: 262144"
  // (Kimi) and Chinese input/context length rejections.
  /exceed(?:ed|s)?.{0,40}(?:context|token limit|input|prompt)/iu,
  /(?:context|input|prompt).{0,40}(?:token )?(?:limit|maximum|too (?:large|long))/iu,
  /(?:输入|上下文|对话|消息|内容).{0,20}(?:长度|字数)?.{0,10}(?:超过|超出)/u,
  /超过.{0,20}(?:上下文|输入|模型.{0,6}上限|最大长度)/u
]

export class ModelContextOverflowError extends Error {
  readonly code = 'context_window_exceeded'

  constructor(message: string, readonly providerCode?: string) {
    super(message)
    this.name = 'ModelContextOverflowError'
  }
}

export function modelContextOverflowError(
  message: string,
  code?: string
): ModelContextOverflowError | undefined {
  const normalizedCode = code?.trim().toLowerCase()
  const normalizedMessage = message.replace(/\s+/g, ' ').trim()
  if (
    (normalizedCode && CONTEXT_OVERFLOW_CODES.has(normalizedCode)) ||
    CONTEXT_OVERFLOW_PATTERNS.some((pattern) => pattern.test(normalizedMessage))
  ) {
    return new ModelContextOverflowError(
      normalizedMessage || 'Model provider rejected the request because its context window was exceeded.',
      normalizedCode
    )
  }
  return undefined
}

export function normalizeModelContextOverflowError(
  error: unknown
): ModelContextOverflowError | undefined {
  if (error instanceof ModelContextOverflowError) return error
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined
    return modelContextOverflowError(error.message, code)
  }
  return modelContextOverflowError(String(error))
}
