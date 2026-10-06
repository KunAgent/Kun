import { randomUUID } from 'node:crypto'
import { DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS, resolveWriteInlineCompletionProviderId,
  type AppSettingsV1 } from '../../shared/app-settings'
import type { WriteInlineCompletionRequest, WriteInlineCompletionResult } from '../../shared/write-inline-completion'
import { retrieveWriteInlineCompletionContext } from './write-retrieval-service'
import { requestRuntimeModelText } from './runtime-model-requests'
import { parseWriteInlineAction } from './write-inline-completion-actions'
import { appendInlineCompletionDebugEntry, buildWriteInlineCompletionChatMessages,
  buildWriteInlineCompletionPrompt, debugPromptFromMessages, INLINE_COMPLETION_TIMEOUT_MS,
  resolveModel, resolveMode } from './write-inline-completion-prompt'

export async function requestWriteInlineThroughRuntime(settings: AppSettingsV1,
  request: WriteInlineCompletionRequest): Promise<WriteInlineCompletionResult> {
  const startedAt = Date.now(), model = resolveModel(request, settings), mode = resolveMode(request)
  const actionMayEdit = Boolean(request.editCandidate && request.recentEdits?.length)
  const providerId = resolveWriteInlineCompletionProviderId(settings)
  const maxTokens = mode === 'long' || mode === 'edit' || actionMayEdit
    ? settings.write.inlineCompletion.longMaxTokens || settings.write.inlineCompletion.maxTokens || DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS
    : settings.write.inlineCompletion.maxTokens || DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS
  const retrieval = settings.write.inlineCompletion.retrievalEnabled === false ? null
    : await retrieveWriteInlineCompletionContext(request, { maxSnippets: mode === 'long' || mode === 'edit' || actionMayEdit ? 5 : 3 }).catch(() => null)
  const messages = buildWriteInlineCompletionChatMessages(request, retrieval)
  const prompt = debugPromptFromMessages(messages)
  const result = await requestRuntimeModelText({ purpose: 'write-inline', providerId,
    model, messages, maxOutputTokens: maxTokens, timeoutMs: INLINE_COMPLETION_TIMEOUT_MS,
    ...(mode !== 'edit' && !actionMayEdit ? { fim: { prompt: buildWriteInlineCompletionPrompt(request, retrieval), suffix: request.suffix } } : {}) })
  const base = { id: randomUUID(), createdAt: new Date(startedAt).toISOString(), model, mode,
    currentFilePath: request.currentFilePath, prompt, suffix: request.suffix,
    referenceCount: retrieval?.snippets.length ?? 0, recentEditCount: request.recentEdits?.length ?? 0,
    promptChars: prompt.length, suffixChars: request.suffix.length, durationMs: Date.now() - startedAt }
  if (!result.ok) {
    appendInlineCompletionDebugEntry({ ...base, ok: false, rawResponse: '', completion: '', responseChars: 0, errorMessage: result.message })
    return result
  }
  const action = parseWriteInlineAction(result.text, { fallbackKind: mode,
    ...(request.editCandidate ? { editTarget: { from: request.editCandidate.from, to: request.editCandidate.to,
      original: request.editCandidate.original, scopeKind: request.editCandidate.kind } } : {}) })
  const completion = action.kind === 'edit' ? action.replacement : action.text
  appendInlineCompletionDebugEntry({ ...base, mode: action.kind, ok: true, rawResponse: result.text,
    completion, actionKind: action.kind, responseChars: result.text.length })
  return { ok: true, completion, action, model, mode: action.kind }
}
