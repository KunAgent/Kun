import { randomUUID } from 'node:crypto'
import {
  DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
  isCustomModelEndpointFormat,
  modelEndpointPath,
  resolveProviderProxyUrl,
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
  extractWriteInlineAction
} from './write-inline-completion-actions'
import {
  INLINE_COMPLETION_TIMEOUT_MS,
  WriteInlineProviderResponseFormat,
  appendInlineCompletionDebugEntry,
  appendInlineCompletionPreflightFailure,
  buildWriteInlineCompletionChatMessages,
  buildWriteInlineCompletionPrompt,
  debugPromptFromMessages,
  resolveMode,
  resolveModel
} from './write-inline-completion-prompt'
import {
  buildProviderHeaders,
  buildProviderRequestBody,
  compatibleModelEndpointUrl,
  isDeepSeekInlineCompletionBaseUrl
} from './write-inline-completion-transport'

export async function requestWriteInlineCompletion(
  settings: AppSettingsV1,
  request: WriteInlineCompletionRequest
): Promise<WriteInlineCompletionResult> {
  const startedAt = Date.now()
  if (settings.write.inlineCompletion.enabled === false) {
    appendInlineCompletionPreflightFailure(startedAt, settings, request, 'Inline completion is disabled.')
    return { ok: false, message: 'Inline completion is disabled.' }
  }

  const rawApiKey = resolveWriteInlineCompletionApiKey(settings)
  if (!rawApiKey) {
    appendInlineCompletionPreflightFailure(startedAt, settings, request, 'Missing API key for inline completion.')
    return { ok: false, message: 'Missing API key for inline completion.' }
  }

  const model = resolveModel(request, settings)
  const mode = resolveMode(request)
  const actionMayEdit = Boolean(request.editCandidate && request.recentEdits?.length)
  const useChatCompletions = mode === 'edit' || actionMayEdit
  const baseUrl = resolveWriteInlineCompletionBaseUrl(settings)
  const provider = resolveWriteInlineCompletionProviderProfile(settings)
  const responsesLite = usesCodexResponsesLite(
    baseUrl,
    modelProviderModelProfile(provider, model)?.responsesMode
  )
  const auth = resolveCodexResponsesRequestAuth(baseUrl, rawApiKey)
  if (!auth.apiKey) {
    appendInlineCompletionPreflightFailure(startedAt, settings, request, 'Missing API key for inline completion.')
    return { ok: false, message: 'Missing API key for inline completion.' }
  }
  const configuredEndpointFormat = resolveWriteInlineCompletionEndpointFormat(settings)
  const endpointFormat = resolveModelEndpointFormat(configuredEndpointFormat, baseUrl)
  if (!endpointFormat) {
    return {
      ok: false,
      message: 'Custom full endpoint URL must end with /chat/completions, /completions, /responses, or /messages.'
    }
  }
  const useFimCompletions =
    !useChatCompletions &&
    configuredEndpointFormat === 'chat_completions' &&
    isDeepSeekInlineCompletionBaseUrl(baseUrl)
  const responseFormat: WriteInlineProviderResponseFormat = useFimCompletions
    ? 'fim_completions'
    : endpointFormat
  const url = useFimCompletions
    ? upstreamDeepSeekFimCompletionsUrl(baseUrl)
    : compatibleModelEndpointUrl(baseUrl, configuredEndpointFormat)
  const maxTokens = mode === 'long' || mode === 'edit' || actionMayEdit
    ? settings.write.inlineCompletion.longMaxTokens || settings.write.inlineCompletion.maxTokens || DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS
    : settings.write.inlineCompletion.maxTokens || DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS
  const retrieval = settings.write.inlineCompletion.retrievalEnabled === false
    ? null
    : await retrieveWriteInlineCompletionContext(request, {
        maxSnippets: mode === 'long' || mode === 'edit' || actionMayEdit ? 5 : 3
      }).catch(() => null)
  const messages = useFimCompletions
    ? null
    : buildWriteInlineCompletionChatMessages(request, retrieval)
  const prompt = messages
    ? debugPromptFromMessages(messages)
    : buildWriteInlineCompletionPrompt(request, retrieval)
  const debugBase = {
    id: randomUUID(),
    createdAt: new Date(startedAt).toISOString(),
    model,
    mode,
    currentFilePath: request.currentFilePath,
    prompt,
    suffix: request.suffix,
    referenceCount: retrieval?.snippets.length ?? 0,
    recentEditCount: request.recentEdits?.length ?? 0,
    promptChars: prompt.length,
    suffixChars: request.suffix.length
  }

  try {
    const body = buildProviderRequestBody({
      responseFormat,
      model,
      messages,
      prompt,
      suffix: request.suffix,
      maxTokens,
      responsesLite
    })
    const response = await fetchWithOptionalProxy(url, {
      method: 'POST',
      headers: buildProviderHeaders(auth.apiKey, responseFormat, auth.headers, responsesLite),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(INLINE_COMPLETION_TIMEOUT_MS)
    }, resolveProviderProxyUrl(settings, provider))
    const text = await response.text()
    if (!response.ok) {
      appendInlineCompletionDebugEntry({
        ...debugBase,
        durationMs: Date.now() - startedAt,
        ok: false,
        rawResponse: text,
        completion: '',
        responseChars: text.length,
        errorMessage: `Inline completion request failed (${response.status})`
      })
      return {
        ok: false,
        message: `Inline completion request failed (${response.status}): ${text.slice(0, 300)}`
      }
    }

    const action = extractWriteInlineAction(text, {
      fallbackKind: mode,
      responseFormat,
      editTarget: request.editCandidate
        ? {
            from: request.editCandidate.from,
            to: request.editCandidate.to,
            original: request.editCandidate.original,
            scopeKind: request.editCandidate.kind
          }
        : undefined
    })
    const completion = action.kind === 'edit' ? action.replacement : action.text
    const finalMode = action.kind
    appendInlineCompletionDebugEntry({
      ...debugBase,
      mode: finalMode,
      durationMs: Date.now() - startedAt,
      ok: true,
      rawResponse: text,
      completion,
      actionKind: finalMode,
      responseChars: text.length
    })

    return {
      ok: true,
      completion,
      action,
      model,
      mode: finalMode
    }
  } catch (error) {
    appendInlineCompletionDebugEntry({
      ...debugBase,
      durationMs: Date.now() - startedAt,
      ok: false,
      rawResponse: '',
      completion: '',
      responseChars: 0,
      errorMessage: error instanceof Error ? error.message : String(error)
    })
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
