export const MODEL_ENDPOINT_FORMATS = ['chat_completions', 'responses', 'messages'] as const
export type ModelEndpointFormat = (typeof MODEL_ENDPOINT_FORMATS)[number]
export const DEFAULT_MODEL_ENDPOINT_FORMAT: ModelEndpointFormat = 'chat_completions'

export function normalizeModelEndpointFormat(value: unknown): ModelEndpointFormat {
  if (typeof value !== 'string') return DEFAULT_MODEL_ENDPOINT_FORMAT
  const normalized = value.trim().toLowerCase().replace(/^\/+/, '')
  switch (normalized) {
    case 'chat':
    case 'chat-completions':
    case 'chat_completions':
    case 'v1/chat/completions':
    case 'chat/completions':
    case '/v1/chat/completions':
      return 'chat_completions'
    case 'response':
    case 'responses':
    case 'v1/responses':
    case '/v1/responses':
      return 'responses'
    case 'message':
    case 'messages':
    case 'v1/messages':
    case '/v1/messages':
      return 'messages'
    default:
      return DEFAULT_MODEL_ENDPOINT_FORMAT
  }
}

export function modelEndpointPath(format: ModelEndpointFormat): string {
  switch (format) {
    case 'responses':
      return 'responses'
    case 'messages':
      return 'messages'
    case 'chat_completions':
    default:
      return 'chat/completions'
  }
}
