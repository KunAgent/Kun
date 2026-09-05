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

import {
  INPUT_BOUNDARY_MARKERS,
  OUTPUT_ACTION_MARKERS,
  PROTOCOL_MARKER_NAMES,
  PROTOCOL_MARKER_OPENER,
  PROTOCOL_PLACEHOLDER_BODIES,
  WriteInlineProviderResponseFormat,
  cleanCompletionText,
  trimMarkerPadding
} from './write-inline-completion-prompt'
import {
  providerTextFromResponse
} from './write-inline-completion-transport'

export type WriteInlineActionEditTarget = {
  from: number
  to: number
  original: string
  scopeKind?: 'selection' | 'paragraph'
}

export function completionAction(
  text: string,
  kind: Extract<WriteInlineCompletionMode, 'short' | 'long'> = 'short'
): WriteInlineCompletionAction {
  return { kind, text: cleanCompletionText(text) }
}

export function editAction(
  replacement: string,
  target: WriteInlineActionEditTarget | undefined
): WriteInlineCompletionAction {
  const cleaned = cleanCompletionText(replacement)
  if (!target) return completionAction(cleaned)
  return {
    kind: 'edit',
    replacement: cleaned,
    from: target.from,
    to: target.to,
    original: target.original,
    scopeKind: target.scopeKind
  }
}

export function actionFromJsonValue(
  value: unknown,
  options: { editTarget?: WriteInlineActionEditTarget }
): WriteInlineCompletionAction | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const rawKind = String(record.kind ?? record.action ?? record.type ?? '').trim().toLowerCase()
  const text = String(record.text ?? record.completion ?? record.insert ?? record.replacement ?? record.edit ?? '')
  if (rawKind === 'short' || rawKind === 'completion' || rawKind === 'insert') return completionAction(text, 'short')
  if (rawKind === 'long') return completionAction(text, 'long')
  if (rawKind === 'edit' || rawKind === 'replacement' || rawKind === 'replace') {
    return editAction(text, options.editTarget)
  }
  return null
}

export function containsInputBoundaryEcho(text: string): boolean {
  return INPUT_BOUNDARY_MARKERS.some((marker) => new RegExp(`<<<\\s*${marker}\\b`, 'i').test(text)) ||
    text.includes('Return only the text to insert at the cursor.')
}

/**
 * Strip protocol marker tokens that leaked into a malformed response so they can
 * never surface as ghost text. Guarded on an actual marker opener being present,
 * so ordinary prose that merely contains ">>>" (a REPL transcript, a merge
 * conflict marker) is returned untouched.
 */
export function stripActionMarkerArtifacts(text: string): string {
  if (!PROTOCOL_MARKER_OPENER.test(text)) return text
  return text
    .replace(new RegExp(`<<<[ \\t]*(?:${PROTOCOL_MARKER_NAMES})\\b[ \\t]*`, 'gi'), '')
    .replace(/>>>/g, '')
    // Drop any line that is a bare echo of the protocol placeholder text, so a
    // full-template parrot collapses to empty rather than leaking the sample lines.
    .split('\n')
    .filter((line) => !PROTOCOL_PLACEHOLDER_BODIES.has(line.trim().toLowerCase()))
    .join('\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function parseMarkedActionBlock(
  text: string,
  options: { editTarget?: WriteInlineActionEditTarget }
): WriteInlineCompletionAction | null {
  // A body ends at the first closing >>> or the next protocol opener, whichever
  // comes first, so a block that dropped its >>> never swallows later markers.
  const bodyTerminator = new RegExp(`>>>|<<<[ \\t]*(?:${PROTOCOL_MARKER_NAMES})\\b`, 'i')
  for (const marker of OUTPUT_ACTION_MARKERS) {
    // Tolerant opener: trailing spaces/tabs and an optional single newline after
    // the keyword, so same-line bodies (<<<SHORT text >>>) parse too.
    const opener = new RegExp(`<<<[ \\t]*${marker}\\b[ \\t]*\\n?`, 'i').exec(text)
    if (!opener) continue
    const rest = text.slice(opener.index + opener[0].length)
    const end = rest.search(bodyTerminator)
    // Drop horizontal whitespace abutting the close marker, then a single
    // trailing newline; leading whitespace is kept so a continuation like
    // " next words" stays intact.
    const body = trimMarkerPadding((end >= 0 ? rest.slice(0, end) : rest).replace(/[ \t]+$/, ''))
    // Skip empty blocks (a contentless SHORT must not shadow a filled LONG, and
    // a pure marker skeleton must fall through to the scrubbing fallback below)
    // and skip a verbatim echo of the protocol's own placeholder text.
    const condensed = body.trim().toLowerCase()
    if (!condensed || PROTOCOL_PLACEHOLDER_BODIES.has(condensed)) continue
    if (marker === 'SHORT') return completionAction(body, 'short')
    if (marker === 'LONG') return completionAction(body, 'long')
    return editAction(body, options.editTarget)
  }
  return null
}

export function parseWriteInlineAction(
  raw: string,
  options: {
    fallbackKind?: WriteInlineCompletionAction['kind']
    editTarget?: WriteInlineActionEditTarget
  } = {}
): WriteInlineCompletionAction {
  const fallbackKind = options.fallbackKind ?? 'short'
  const normalized = raw.replace(/\r\n?/g, '\n').replaceAll(String.fromCharCode(0), '')
  const trimmed = normalized.trim()
  if (!trimmed) {
    return fallbackKind === 'edit'
      ? editAction('', options.editTarget)
      : completionAction('', fallbackKind === 'long' ? 'long' : 'short')
  }

  if (containsInputBoundaryEcho(trimmed)) {
    return fallbackKind === 'edit'
      ? editAction('', options.editTarget)
      : completionAction('', fallbackKind === 'long' ? 'long' : 'short')
  }

  const marked = parseMarkedActionBlock(trimmed, { editTarget: options.editTarget })
  if (marked) return marked

  try {
    const parsed = JSON.parse(trimmed) as unknown
    const action = actionFromJsonValue(parsed, { editTarget: options.editTarget })
    if (action) return action
  } catch {
    /* XML/plain-text fallbacks below. */
  }

  const short = trimmed.match(/^<short(?:\s[^>]*)?>([\s\S]*?)<\/short>$/i) ??
    trimmed.match(/<short(?:\s[^>]*)?>([\s\S]*?)<\/short>/i)
  if (short) return completionAction(short[1], 'short')

  const long = trimmed.match(/^<long(?:\s[^>]*)?>([\s\S]*?)<\/long>$/i) ??
    trimmed.match(/<long(?:\s[^>]*)?>([\s\S]*?)<\/long>/i)
  if (long) return completionAction(long[1], 'long')

  const completion = trimmed.match(/^<completion(?:\s[^>]*)?>([\s\S]*?)<\/completion>$/i) ??
    trimmed.match(/<completion(?:\s[^>]*)?>([\s\S]*?)<\/completion>/i)
  if (completion) return completionAction(completion[1], fallbackKind === 'long' ? 'long' : 'short')

  const edit = trimmed.match(/^<edit(?:\s[^>]*)?>([\s\S]*?)<\/edit>$/i) ??
    trimmed.match(/<edit(?:\s[^>]*)?>([\s\S]*?)<\/edit>/i)
  if (edit) return editAction(edit[1], options.editTarget)

  const labeledCompletion = trimmed.match(/^(?:completion|insert)[:：]\s*([\s\S]*)$/i)
  if (labeledCompletion) return completionAction(labeledCompletion[1], fallbackKind === 'long' ? 'long' : 'short')
  const labeledShort = trimmed.match(/^(?:short)[:：]\s*([\s\S]*)$/i)
  if (labeledShort) return completionAction(labeledShort[1], 'short')
  const labeledLong = trimmed.match(/^(?:long)[:：]\s*([\s\S]*)$/i)
  if (labeledLong) return completionAction(labeledLong[1], 'long')
  const labeledEdit = trimmed.match(/^(?:edit|replacement|replace|new text|edited text|替换文本|修改后|修改|替换)[:：]\s*([\s\S]*)$/i)
  if (labeledEdit) return editAction(labeledEdit[1], options.editTarget)

  // Last resort: treat the response as plain insertable text, but scrub any
  // leaked protocol markers first so a malformed skeleton (">>> <<<LONG >>>
  // <<<EDIT") degrades to an empty completion instead of polluting the ghost text.
  const scrubbed = stripActionMarkerArtifacts(normalized)
  return fallbackKind === 'edit'
    ? editAction(scrubbed, options.editTarget)
    : completionAction(scrubbed, fallbackKind === 'long' ? 'long' : 'short')
}

export function extractWriteInlineAction(
  responseText: string,
  options: {
    fallbackKind?: WriteInlineCompletionAction['kind']
    editTarget?: WriteInlineActionEditTarget
    responseFormat?: WriteInlineProviderResponseFormat
  } = {}
): WriteInlineCompletionAction {
  return parseWriteInlineAction(providerTextFromResponse(responseText, options.responseFormat), options)
}
