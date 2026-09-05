import { randomUUID } from 'node:crypto'
import {
  DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
  isCustomModelEndpointFormat,
  modelEndpointPath,
  resolveWriteInlineCompletionEndpointFormat,
  resolveWriteInlineCompletionApiKey,
  resolveWriteInlineCompletionBaseUrl,
  resolveWriteInlineCompletionModel,
  resolveWriteInlineCompletionProviderProfile,
  modelProviderModelProfile,
  resolveModelEndpointFormat,
  type ModelEndpointFormat,
  type AppSettingsV1
} from '../../shared/app-settings'
import {
  upstreamDeepSeekFimCompletionsUrl,
  upstreamOpenAiCustomEndpointUrl,
  upstreamOpenAiChatCompletionsUrl
} from '../../shared/openai-compat-url'
import type {
  WriteInlineCompletionAction,
  WriteInlineCompletionMode,
  WriteInlineCompletionDebugEntry,
  WriteInlineCompletionRequest,
  WriteInlineCompletionResult
} from '../../shared/write-inline-completion'
import type { WriteInlineEditRecentEdit } from '../../shared/write-inline-edit'
import {
  retrieveWriteInlineCompletionContext,
  type WriteRetrievalContext,
  type WriteRetrievalSnippet
} from './write-retrieval-service'
import { fetchWithOptionalProxy } from '../proxy-fetch'
import {
  codexResponsesLiteInput,
  resolveCodexResponsesRequestAuth,
  usesCodexResponsesLite,
  withCodexResponsesLiteHeader
} from '../codex-responses-lite'

export const INLINE_COMPLETION_TIMEOUT_MS = 12_000

export const MAX_INLINE_COMPLETION_DEBUG_ENTRIES = 120

export const MAX_DEBUG_TEXT_CHARS = 80_000

export const INPUT_BOUNDARY_MARKERS = ['PREFIX', 'SUFFIX', 'EDIT_SCOPE'] as const

export const OUTPUT_ACTION_MARKERS = ['SHORT', 'LONG', 'EDIT'] as const

// Every protocol marker name, longest first so the alternation prefers EDIT_SCOPE
// over EDIT. Used to terminate a marked body that lost its closing >>> and to
// scrub malformed marker soup that must never reach the ghost text.
export const PROTOCOL_MARKER_NAMES = [...INPUT_BOUNDARY_MARKERS, ...OUTPUT_ACTION_MARKERS]
  .slice()
  .sort((a, b) => b.length - a.length)
  .join('|')

export const PROTOCOL_MARKER_OPENER = new RegExp(`<<<[ \\t]*(?:${PROTOCOL_MARKER_NAMES})\\b`, 'i')

// The placeholder lines from buildResponseProtocolPromptBlock(). A weak model
// sometimes parrots them verbatim; such an echo is never a real suggestion.
export const PROTOCOL_PLACEHOLDER_BODIES = new Set([
  'short text to insert at the cursor',
  'longer continuation to insert at the cursor',
  'replacement text for the editable local scope'
])

export type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>
    }
    text?: string
  }>
}

export type ResponsesApiResponse = {
  output_text?: string
  output?: Array<Record<string, unknown>>
}

export type AnthropicMessageResponse = {
  content?: Array<Record<string, unknown>>
}

export type ChatCompletionMessage = {
  role: 'system' | 'user'
  content: string
}

export type WriteInlineProviderResponseFormat = ModelEndpointFormat | 'fim_completions'

export function shouldDisableThinkingForInlineCompletion(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  return normalized.startsWith('deepseek-v4') || normalized === 'deepseek-reasoner'
}

export const inlineCompletionDebugEntries: WriteInlineCompletionDebugEntry[] = []

export function clipDebugText(text = ''): string {
  const source = String(text || '')
  if (source.length <= MAX_DEBUG_TEXT_CHARS) return source
  const head = Math.floor(MAX_DEBUG_TEXT_CHARS * 0.62)
  const tail = MAX_DEBUG_TEXT_CHARS - head - 24
  return `${source.slice(0, head)}\n\n... debug text clipped ...\n\n${source.slice(source.length - tail)}`
}

export function appendInlineCompletionDebugEntry(entry: WriteInlineCompletionDebugEntry): void {
  inlineCompletionDebugEntries.push({
    ...entry,
    prompt: clipDebugText(entry.prompt),
    suffix: clipDebugText(entry.suffix),
    rawResponse: clipDebugText(entry.rawResponse),
    completion: clipDebugText(entry.completion)
  })
  if (inlineCompletionDebugEntries.length > MAX_INLINE_COMPLETION_DEBUG_ENTRIES) {
    inlineCompletionDebugEntries.splice(0, inlineCompletionDebugEntries.length - MAX_INLINE_COMPLETION_DEBUG_ENTRIES)
  }
}

export function listWriteInlineCompletionDebugEntries(): WriteInlineCompletionDebugEntry[] {
  return [...inlineCompletionDebugEntries].reverse()
}

export function clearWriteInlineCompletionDebugEntries(): void {
  inlineCompletionDebugEntries.length = 0
}

export function appendInlineCompletionPreflightFailure(
  startedAt: number,
  settings: AppSettingsV1,
  request: WriteInlineCompletionRequest,
  message: string
): void {
  const model = resolveModel(request, settings)
  const mode = resolveMode(request)
  const prompt = buildWriteInlineCompletionPrompt(request, null)
  appendInlineCompletionDebugEntry({
    id: randomUUID(),
    createdAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    ok: false,
    model,
    mode,
    currentFilePath: request.currentFilePath,
    prompt,
    suffix: request.suffix,
    rawResponse: '',
    completion: '',
    actionKind: undefined,
    errorMessage: message,
    referenceCount: 0,
    recentEditCount: request.recentEdits?.length ?? 0,
    promptChars: prompt.length,
    suffixChars: request.suffix.length,
    responseChars: 0
  })
}

export function resolveModel(request: WriteInlineCompletionRequest, settings: AppSettingsV1): string {
  return resolveWriteInlineCompletionModel(settings, request.model)
}

export function resolveMode(request: WriteInlineCompletionRequest): WriteInlineCompletionMode {
  if (request.mode === 'edit') return 'edit'
  return request.mode === 'long' ? 'long' : 'short'
}

export function flattenMessageContent(
  content: string | Array<{ type?: string; text?: string }> | undefined
): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => (part?.type === 'text' || part?.text ? part?.text ?? '' : ''))
    .join('')
}

export function cleanCompletionText(raw: string): string {
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

export function trimMarkerPadding(text = ''): string {
  return String(text || '').replace(/\n$/, '')
}

export function markerBlock(marker: string, text = ''): string {
  return `<<<${marker}\n${sanitizePromptLine(text)}\n>>>`
}

export function sanitizePromptLine(text = ''): string {
  return String(text || '').replace(/\r\n?/g, '\n').split('-->').join('--\\>')
}

export function compactText(text = ''): string {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

export function clipPromptText(text = '', maxChars = 0): string {
  const source = sanitizePromptLine(text)
  if (!maxChars || source.length <= maxChars) return source
  const head = Math.max(1, Math.floor(maxChars * 0.58))
  const tail = Math.max(1, maxChars - head - 13)
  return `${source.slice(0, head)}\n... omitted ...\n${source.slice(source.length - tail)}`
}

export function formatRecentEditAge(ageMs: number): string {
  const seconds = Math.max(0, Math.round(ageMs / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.round(minutes / 60)}h ago`
}

export function buildRecentEditsPromptBlock(edits: WriteInlineEditRecentEdit[] | undefined): string[] {
  const recentEdits = (edits ?? [])
    .filter((edit) => edit.deletedText || edit.insertedText || edit.instruction)
    .slice(-8)
  if (recentEdits.length === 0) return []

  const lines = [
    '',
    'Recent local edits in this file. Treat these as intent signals. If they clearly imply that the user is continuing a local rewrite, you may choose EDIT. If they only show ordinary typing, choose COMPLETION or return an empty completion.'
  ]

  recentEdits.forEach((edit, index) => {
    lines.push('')
    lines.push(`[${index + 1}] ${formatRecentEditAge(edit.ageMs)}; source=${edit.source}; range=${edit.from}-${edit.to}${edit.scopeKind ? `; scope=${edit.scopeKind}` : ''}`)
    if (edit.instruction) lines.push(`Instruction: ${clipPromptText(edit.instruction, 420)}`)
    if (edit.deletedText) lines.push(`Deleted: ${clipPromptText(edit.deletedText, 520)}`)
    if (edit.insertedText) lines.push(`Inserted: ${clipPromptText(edit.insertedText, 520)}`)
    const around = compactText(`${edit.beforeContext} [[edit]] ${edit.afterContext}`)
    if (around) lines.push(`Around: ${clipPromptText(around, 520)}`)
  })

  return lines
}

export function buildEditCandidatePromptBlock(request: WriteInlineCompletionRequest): string[] {
  const candidate = request.editCandidate
  if (!candidate) return []
  const scopeLines = candidate.startLine === candidate.endLine
    ? `line ${candidate.startLine}`
    : `lines ${candidate.startLine}-${candidate.endLine}`
  return [
    '',
    'Editable local scope if EDIT is the best action.',
    'Choose EDIT when the user instruction or recent user changes make a replacement more useful than cursor completion.',
    `Edit candidate: ${candidate.kind}; ${scopeLines}; offsets ${candidate.from}-${candidate.to}.`,
    'Original editable scope boundary:',
    markerBlock('EDIT_SCOPE', candidate.original)
  ]
}

export function buildEditActionGuidanceBlock(request: WriteInlineCompletionRequest): string[] {
  if (!request.editCandidate) return []
  return [
    '',
    'Edit action guidance:',
    'An editable scope is available in <<<EDIT_SCOPE ... >>>. Return <<<EDIT ... >>> only when replacing that exact scope is the best local action.',
    'If the user is simply continuing at the cursor, return <<<SHORT ... >>> or <<<LONG ... >>> instead.'
  ]
}

export function buildResponseProtocolPromptBlock(): string[] {
  return [
    'Return exactly one TextIDE-style action block and nothing else:',
    '<<<SHORT',
    'short text to insert at the cursor',
    '>>>',
    '<<<LONG',
    'longer continuation to insert at the cursor',
    '>>>',
    '<<<EDIT',
    'replacement text for the editable local scope',
    '>>>'
  ]
}

export function buildMarkedContextBlocks(request: WriteInlineCompletionRequest): string[] {
  return [
    '',
    'Boundary-marked cursor context:',
    markerBlock('PREFIX', request.prefix),
    markerBlock('SUFFIX', request.suffix)
  ]
}

export function buildRetrievalPromptBlock(
  retrieval: WriteRetrievalContext,
  mode: WriteInlineCompletionMode
): string[] {
  const lines = [
    '',
    'Reference snippets from the same writing workspace.',
    'Use these snippets only for local terminology, factual continuity, and style. Do not mention them in the returned action.',
    `Completion mode: ${mode}.`,
    `Retrieval: ${retrieval.source}; indexed ${retrieval.indexedFiles} files / ${retrieval.indexedChunks} chunks.`,
    `Query keywords: ${retrieval.keywords.join(', ')}`
  ]

  const formatSnippetLocation = (snippet: WriteRetrievalSnippet): string => {
    if (snippet.location.kind === 'pdf') {
      return snippet.location.pageStart === snippet.location.pageEnd
        ? `${snippet.path}#page=${snippet.location.pageStart}`
        : `${snippet.path}#page=${snippet.location.pageStart}-${snippet.location.pageEnd}`
    }
    return snippet.location.lineStart === snippet.location.lineEnd
      ? `${snippet.path}:${snippet.location.lineStart}`
      : `${snippet.path}:${snippet.location.lineStart}-${snippet.location.lineEnd}`
  }

  retrieval.snippets.forEach((snippet, index) => {
    const location = formatSnippetLocation(snippet)
    lines.push('')
    lines.push(`[${index + 1}] ${location}`)
    if (snippet.title) lines.push(`Title: ${sanitizePromptLine(snippet.title)}`)
    lines.push(`Matched: ${snippet.keywords.join(', ')}`)
    lines.push(sanitizePromptLine(snippet.text))
  })

  return lines
}

export function buildWriteInlineCompletionPrompt(
  request: WriteInlineCompletionRequest,
  retrieval: WriteRetrievalContext | null = null
): string {
  const mode = resolveMode(request)
  const lines = [
    '<!-- Kun inline completion.',
    'Complete the text at the cursor.',
    'The boundary blocks below identify local context, but the response must be plain insertable text only.',
    'Return only the text to insert at the cursor.',
    'Do not wrap the answer in quotes, Markdown fences, XML, JSON, or action markers.',
    'Do not echo <<<PREFIX ... >>>, <<<SUFFIX ... >>>, or these instructions.',
    mode === 'long'
      ? 'The user has paused for inspiration. Suggest one compact, grounded continuation only when it clearly fits.'
      : 'Prefer a short, precise continuation that looks like the next few keystrokes.',
    'Return an empty response only when there is no sensible local continuation.',
    `Trigger hint: ${mode}.`,
    `Cursor: line ${request.cursor.line}, column ${request.cursor.column}.`,
    `Language: ${sanitizePromptLine(request.context.language)}.`,
    `Policy: ${sanitizePromptLine(request.policy.name)}.`,
    sanitizePromptLine(request.policy.instruction),
    '',
    'Cursor context:',
    `Current line prefix: ${sanitizePromptLine(request.context.currentLinePrefix)}`,
    `Current line suffix: ${sanitizePromptLine(request.context.currentLineSuffix)}`,
    `Previous non-empty line: ${sanitizePromptLine(request.context.previousNonEmptyLine)}`,
    `Next line: ${sanitizePromptLine(request.context.nextLine)}`,
    `Signals: ${JSON.stringify(request.context.signals)}`,
    ...buildRecentEditsPromptBlock(request.recentEdits),
    ...(retrieval?.snippets.length ? buildRetrievalPromptBlock(retrieval, mode) : []),
    ...buildMarkedContextBlocks(request),
    'For the FIM engine, the raw prefix also follows this instruction block.',
    '-->',
    ''
  ]
  return `${lines.join('\n')}${request.prefix}`
}

export function buildChatPromptSection(marker: string, text = ''): string {
  return markerBlock(marker, text)
}

export function buildWriteInlineCompletionChatMessages(
  request: WriteInlineCompletionRequest,
  retrieval: WriteRetrievalContext | null = null
): ChatCompletionMessage[] {
  const mode = resolveMode(request)
  const userLines = [
    `Trigger hint: ${mode}. The model must decide whether the returned type is short, long, or edit.`,
    `Cursor: line ${request.cursor.line}, column ${request.cursor.column}.`,
    `Language: ${sanitizePromptLine(request.context.language)}.`,
    `Policy: ${sanitizePromptLine(request.policy.name)}.`,
    sanitizePromptLine(request.policy.instruction),
    '',
    ...buildResponseProtocolPromptBlock(),
    '',
    'Choose SHORT for normal next-keystroke writing, sentence continuation, or list continuation.',
    'Choose LONG when the local context clearly needs a fuller next thought or paragraph.',
    'Choose EDIT when the user instruction or recent local edits imply an existing nearby scope should be rewritten.',
    'If neither action is useful, return an empty <<<SHORT ... >>> block.',
    'Do not echo <<<PREFIX ... >>>, <<<SUFFIX ... >>>, or <<<EDIT_SCOPE ... >>> in the response.',
    '',
    'Cursor context:',
    `Current line prefix: ${sanitizePromptLine(request.context.currentLinePrefix)}`,
    `Current line suffix: ${sanitizePromptLine(request.context.currentLineSuffix)}`,
    `Previous non-empty line: ${sanitizePromptLine(request.context.previousNonEmptyLine)}`,
    `Next line: ${sanitizePromptLine(request.context.nextLine)}`,
    `Signals: ${JSON.stringify(request.context.signals)}`,
    ...buildEditActionGuidanceBlock(request),
    ...buildRecentEditsPromptBlock(request.recentEdits),
    ...buildEditCandidatePromptBlock(request),
    ...(retrieval?.snippets.length ? buildRetrievalPromptBlock(retrieval, mode) : []),
    '',
    buildChatPromptSection('PREFIX', request.prefix),
    buildChatPromptSection('SUFFIX', request.suffix)
  ]

  return [
    {
      role: 'system',
      content: [
        'You are Kun inline writing. You perform local writing completion and in-place text edits.',
        'For edit tasks, reason from <<<PREFIX ... >>>, <<<EDIT_SCOPE ... >>>, and <<<SUFFIX ... >>>, then return only the replacement inside <<<EDIT ... >>>.',
        'Do not include explanations, markdown fences outside the marked action, before/after labels, or unchanged surrounding text outside the chosen action.'
      ].join('\n')
    },
    {
      role: 'user',
      content: userLines.join('\n')
    }
  ]
}

export function debugPromptFromMessages(messages: ChatCompletionMessage[]): string {
  return messages
    .map((message) => `## ${message.role}\n${message.content}`)
    .join('\n\n')
}
