import {
  DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
  resolveProviderProxyUrl,
  resolveWriteInlineCompletionApiKey,
  resolveWriteInlineCompletionBaseUrl,
  resolveWriteInlineCompletionEndpointFormat,
  resolveWriteInlineCompletionModel,
  resolveWriteInlineCompletionProviderProfile,
  modelProviderModelProfile,
  resolveModelEndpointFormat,
  type AppSettingsV1
} from '../../shared/app-settings'
import { openCodeSessionRuntimeHeaders } from '../../shared/opencode-session'
import {
  buildWriteAiPropertiesMessages,
  normalizeAiPropertiesYaml,
  type WriteAiPropertiesRequest,
  type WriteAiPropertiesResult
} from '../../shared/write-ai-properties'
import { fetchWithOptionalProxy } from '../proxy-fetch'
import {
  resolveCodexResponsesRequestAuth,
  usesCodexResponsesLite
} from '../codex-responses-lite'
import {
  buildProviderHeaders,
  buildProviderRequestBody,
  compatibleModelEndpointUrl,
  providerTextFromResponse
} from './write-inline-completion-transport'

const AI_PROPERTIES_TIMEOUT_MS = 30_000

/**
 * One-shot "generate frontmatter properties" request. Reuses the inline
 * completion provider configuration (baseUrl/apiKey/model/endpointFormat)
 * but always sends chat-style messages — FIM is a completion-only path.
 */
export async function requestWriteAiProperties(
  settings: AppSettingsV1,
  request: WriteAiPropertiesRequest
): Promise<WriteAiPropertiesResult> {
  const rawApiKey = resolveWriteInlineCompletionApiKey(settings)
  if (!rawApiKey) {
    return { ok: false, message: 'Missing API key for AI property generation.' }
  }
  const model = resolveWriteInlineCompletionModel(settings, request.model)
  const baseUrl = resolveWriteInlineCompletionBaseUrl(settings)
  const provider = resolveWriteInlineCompletionProviderProfile(settings)
  const responsesLite = usesCodexResponsesLite(
    baseUrl,
    modelProviderModelProfile(provider, model)?.responsesMode
  )
  const auth = resolveCodexResponsesRequestAuth(baseUrl, rawApiKey)
  if (!auth.apiKey) {
    return { ok: false, message: 'Missing API key for AI property generation.' }
  }
  const configuredEndpointFormat = resolveWriteInlineCompletionEndpointFormat(settings)
  const endpointFormat = resolveModelEndpointFormat(configuredEndpointFormat, baseUrl)
  if (!endpointFormat) {
    return {
      ok: false,
      message:
        'Custom full endpoint URL must end with /chat/completions, /completions, /responses, or /messages.'
    }
  }
  const url = compatibleModelEndpointUrl(baseUrl, configuredEndpointFormat)
  const maxTokens =
    settings.write.inlineCompletion.longMaxTokens ||
    settings.write.inlineCompletion.maxTokens ||
    DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS
  const messages = buildWriteAiPropertiesMessages(request)

  try {
    const body = buildProviderRequestBody({
      responseFormat: endpointFormat,
      model,
      messages,
      prompt: '',
      suffix: '',
      maxTokens,
      responsesLite
    })
    const response = await fetchWithOptionalProxy(
      url,
      {
        method: 'POST',
        headers: {
          ...buildProviderHeaders(auth.apiKey, endpointFormat, auth.headers, responsesLite),
          ...openCodeSessionRuntimeHeaders({
            presetSource: provider.presetSource?.presetId,
            providerId: provider.id,
            baseUrl
          })
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(AI_PROPERTIES_TIMEOUT_MS)
      },
      resolveProviderProxyUrl(settings, provider)
    )
    const text = await response.text()
    if (!response.ok) {
      return {
        ok: false,
        message: `AI properties request failed (${response.status}): ${text.slice(0, 300)}`
      }
    }
    const output = providerTextFromResponse(text, endpointFormat)
    const yaml = normalizeAiPropertiesYaml(output)
    if (!yaml) {
      return { ok: false, message: 'Model did not return usable frontmatter properties.' }
    }
    return { ok: true, yaml, model }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
