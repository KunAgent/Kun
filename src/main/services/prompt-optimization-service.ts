import {
  DEFAULT_DEEPSEEK_BASE_URL,
  getModelProviderProfile,
  modelProviderModelProfile,
  resolveKunPromptOptimizationPrompt,
  resolveKunRuntimeSettings,
  resolveProviderProxyUrl,
  type AppSettingsV1,
  type ModelEndpointFormat,
  type ModelProviderProfileV1
} from '../../shared/app-settings'
import type { PromptOptimizationResult } from '../../shared/kun-gui-api'
import { resolveCodexResponsesRequestAuth } from '../codex-responses-lite'
import { oneShotModelRequest } from './one-shot-model-request'

function firstProviderModel(provider: ModelProviderProfileV1): string {
  return provider.models.map((item) => item.trim()).find(Boolean) ?? ''
}

function defaultPromptOptimizationModel(
  runtime: ReturnType<typeof resolveKunRuntimeSettings>,
  provider: ModelProviderProfileV1
): string {
  const smallModel = runtime.smallModel?.trim() ?? ''
  const smallProviderId = runtime.smallModelProviderId?.trim() || runtime.providerId.trim() || provider.id
  if (smallModel && smallProviderId === provider.id) return smallModel

  const mainModel = runtime.model.trim()
  const mainProviderId = runtime.providerId.trim() || provider.id
  if (mainModel && mainProviderId === provider.id) return mainModel

  return firstProviderModel(provider) || mainModel
}

function effectivePromptOptimizationModel(settings: AppSettingsV1): {
  providerId: string
  model: string
  apiKey: string
  baseUrl: string
  endpointFormat: ModelEndpointFormat
  responsesMode?: 'lite'
  systemPrompt: string
  timeoutMs: number
} {
  const runtime = resolveKunRuntimeSettings(settings)
  const promptOptimization = runtime.promptOptimization
  const providerId = promptOptimization.providerId.trim() || runtime.providerId
  const provider = getModelProviderProfile(settings, providerId)
  const model = promptOptimization.model.trim() || defaultPromptOptimizationModel(runtime, provider)
  const profile = modelProviderModelProfile(provider, model)
  const endpointFormat = profile?.endpointFormat ?? provider.endpointFormat
  return {
    providerId: provider.id,
    model,
    apiKey: provider.apiKey.trim() || runtime.apiKey.trim(),
    baseUrl: provider.baseUrl.trim() || runtime.baseUrl.trim() || DEFAULT_DEEPSEEK_BASE_URL,
    endpointFormat,
    responsesMode: profile?.responsesMode,
    systemPrompt: resolveKunPromptOptimizationPrompt(runtime),
    timeoutMs: promptOptimization.timeoutMs
  }
}

export async function optimizePrompt(
  settings: AppSettingsV1,
  sourceText: string
): Promise<PromptOptimizationResult> {
  const trimmed = sourceText.trim()
  if (!trimmed) return { ok: false, message: 'Prompt text is empty.' }
  const modelSettings = effectivePromptOptimizationModel(settings)
  if (!resolveKunRuntimeSettings(settings).promptOptimization.enabled) {
    return { ok: false, message: 'Prompt optimization is disabled.' }
  }
  if (!modelSettings.apiKey) {
    return { ok: false, message: 'Prompt optimization model is missing an API key.' }
  }
  if (!resolveCodexResponsesRequestAuth(modelSettings.baseUrl, modelSettings.apiKey).apiKey) {
    return { ok: false, message: 'ChatGPT subscription credentials are invalid. Please sign in again.' }
  }
  const result = await oneShotModelRequest({
    baseUrl: modelSettings.baseUrl,
    apiKey: modelSettings.apiKey,
    endpointFormat: modelSettings.endpointFormat,
    responsesMode: modelSettings.responsesMode,
    model: modelSettings.model,
    systemPrompt: modelSettings.systemPrompt,
    userText: trimmed,
    timeoutMs: modelSettings.timeoutMs,
    proxyUrl: resolveProviderProxyUrl(settings, modelSettings.providerId),
    providerId: modelSettings.providerId,
    presetSource: getModelProviderProfile(settings, modelSettings.providerId).presetSource?.presetId
  })
  if (!result.ok) return { ok: false, message: result.message }
  return {
    ok: true,
    text: result.text,
    model: modelSettings.model,
    providerId: modelSettings.providerId
  }
}
