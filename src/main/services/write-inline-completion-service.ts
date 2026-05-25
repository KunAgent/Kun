import {
  DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL,
  DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
  DEFAULT_WRITE_INLINE_COMPLETION_MODEL,
  normalizeWriteInlineCompletionModel,
  type AppSettingsV1
} from '../../shared/app-settings'
import { upstreamDeepSeekFimCompletionsUrl } from '../../shared/openai-compat-url'
import type {
  WriteInlineCompletionMode,
  WriteInlineCompletionRequest,
  WriteInlineCompletionResult
} from '../../shared/write-inline-completion'
import {
  retrieveWriteInlineCompletionContext,
  type WriteRetrievalContext
} from './write-retrieval-service'

const INLINE_COMPLETION_TIMEOUT_MS = 12_000

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>
    }
    text?: string
  }>
}

function resolveModel(request: WriteInlineCompletionRequest, settings: AppSettingsV1): string {
  const trimmed = request.model?.trim() || settings.write.inlineCompletion.model.trim()
  return normalizeWriteInlineCompletionModel(trimmed || DEFAULT_WRITE_INLINE_COMPLETION_MODEL)
}

function resolveMode(request: WriteInlineCompletionRequest): WriteInlineCompletionMode {
  return request.mode === 'long' ? 'long' : 'short'
}

function flattenMessageContent(
  content: string | Array<{ type?: string; text?: string }> | undefined
): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => (part?.type === 'text' || part?.text ? part?.text ?? '' : ''))
    .join('')
}

function cleanCompletionText(raw: string): string {
  const normalized = raw.replace(/\r\n?/g, '\n').replaceAll(String.fromCharCode(0), '')
  const trimmed = normalized.trim()
  if (!trimmed) return ''

  const fenced = trimmed.match(/^```(?:\w+)?\n([\s\S]*?)\n```$/)
  if (fenced) return fenced[1]
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return normalized
}

function sanitizePromptLine(text = ''): string {
  return String(text || '').replace(/\r\n?/g, '\n').replace(/-->/g, '--\\>')
}

function buildCompletionModePromptPrefix(mode: WriteInlineCompletionMode): string {
  if (mode !== 'long') return ''
  return [
    '<!-- DeepSeek GUI inline completion mode: long inspiration.',
    'The user paused at the cursor. Continue the draft with a grounded next thought, usually one compact paragraph or a short structural continuation.',
    'Return only insertable text. Do not mention this comment, do not summarize the document, and do not take over the whole draft.',
    '-->',
    ''
  ].join('\n')
}

function buildRetrievalPromptPrefix(
  retrieval: WriteRetrievalContext,
  mode: WriteInlineCompletionMode
): string {
  const lines = [
    '<!-- DeepSeek GUI inline completion references.',
    'Use these snippets only for local terminology, factual continuity, and style. Do not insert or mention this comment.',
    `Completion mode: ${mode}.`,
    `Retrieval: ${retrieval.source}; indexed ${retrieval.indexedFiles} files / ${retrieval.indexedChunks} chunks.`,
    `Query keywords: ${retrieval.keywords.join(', ')}`
  ]

  retrieval.snippets.forEach((snippet, index) => {
    const location = snippet.lineStart === snippet.lineEnd
      ? `${snippet.path}:${snippet.lineStart}`
      : `${snippet.path}:${snippet.lineStart}-${snippet.lineEnd}`
    lines.push('')
    lines.push(`[${index + 1}] ${location}`)
    if (snippet.title) lines.push(`Title: ${sanitizePromptLine(snippet.title)}`)
    lines.push(`Matched: ${snippet.keywords.join(', ')}`)
    lines.push(sanitizePromptLine(snippet.text))
  })

  lines.push('-->')
  return `${lines.join('\n')}\n\n`
}

export function buildWriteInlineCompletionPrompt(
  request: WriteInlineCompletionRequest,
  retrieval: WriteRetrievalContext | null = null
): string {
  const mode = resolveMode(request)
  const modePrefix = buildCompletionModePromptPrefix(mode)
  const retrievalPrefix = retrieval?.snippets.length
    ? buildRetrievalPromptPrefix(retrieval, mode)
    : ''
  return `${modePrefix}${retrievalPrefix}${request.prefix}`
}

function extractCompletion(responseText: string): string {
  let parsed: ChatCompletionResponse
  try {
    parsed = JSON.parse(responseText) as ChatCompletionResponse
  } catch {
    throw new Error('Inline completion provider returned non-JSON data.')
  }
  const firstChoice = parsed.choices?.[0]
  if (typeof firstChoice?.text === 'string') return cleanCompletionText(firstChoice.text)
  const first = firstChoice?.message?.content
  return cleanCompletionText(flattenMessageContent(first))
}

export async function requestWriteInlineCompletion(
  settings: AppSettingsV1,
  request: WriteInlineCompletionRequest
): Promise<WriteInlineCompletionResult> {
  if (settings.write.inlineCompletion.enabled === false) {
    return { ok: false, message: 'Inline completion is disabled.' }
  }

  const apiKey = settings.deepseek.apiKey.trim()
  if (!apiKey) {
    return { ok: false, message: 'Missing API key for inline completion.' }
  }

  const model = resolveModel(request, settings)
  const mode = resolveMode(request)
  const url = upstreamDeepSeekFimCompletionsUrl(
    settings.write.inlineCompletion.baseUrl.trim() || DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL
  )
  const maxTokens = mode === 'long'
    ? settings.write.inlineCompletion.longMaxTokens || settings.write.inlineCompletion.maxTokens || DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS
    : settings.write.inlineCompletion.maxTokens || DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS
  const retrieval = settings.write.inlineCompletion.retrievalEnabled === false
    ? null
    : await retrieveWriteInlineCompletionContext(request, {
        maxSnippets: mode === 'long' ? 5 : 3
      }).catch(() => null)
  const prompt = buildWriteInlineCompletionPrompt(request, retrieval)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        prompt,
        suffix: request.suffix,
        max_tokens: maxTokens
      }),
      signal: AbortSignal.timeout(INLINE_COMPLETION_TIMEOUT_MS)
    })
    const text = await response.text()
    if (!response.ok) {
      return {
        ok: false,
        message: `Inline completion request failed (${response.status}): ${text.slice(0, 300)}`
      }
    }

    return {
      ok: true,
      completion: extractCompletion(text),
      model,
      mode
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
