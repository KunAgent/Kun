import { randomUUID } from 'node:crypto'
import {
  DEFAULT_DEEPSEEK_BASE_URL,
  getModelProviderProfile,
  getModelProviderSettings,
  modelProviderModelProfile,
  normalizeModelProviderId,
  resolveKunPromptOptimizationPrompt,
  resolveKunRuntimeSettings,
  resolveProviderProxyUrl,
  type AppSettingsV1,
  type ModelEndpointFormat,
  type ModelProviderProfileV1
} from '../../shared/app-settings'
import type { PromptOptimizationFailureCode, PromptOptimizationResult } from '../../shared/kun-gui-api'
import { redactSecretText } from '../../shared/secret-redaction'
import { resolveCodexResponsesRequestAuth } from '../codex-responses-lite'
import { oneShotModelRequest } from './one-shot-model-request'
import { routesTextThroughRuntime } from './runtime-model-requests'

/** The composer's selected model, as the renderer sees it. */
export type PromptOptimizationSelection = { providerId: string; model: string }

type PromptOptimizationLogger = (category: string, message: string, detail?: unknown) => void

export type PromptOptimizationOptions = {
  /** Renderer-chosen id so `cancelPromptOptimization` can abort this request. */
  requestId?: string
  /** Absent for callers that predate the composer selection (legacy default model). */
  selection?: PromptOptimizationSelection
  log?: { info?: PromptOptimizationLogger; error?: PromptOptimizationLogger }
}

type PromptOptimizationTarget = {
  source: 'pinned' | 'composer' | 'default'
  providerId: string
  model: string
  apiKey: string
  baseUrl: string
  endpointFormat: ModelEndpointFormat
  responsesMode?: 'lite'
}

/** Profiles that run whole turns inside another agent; Kun has no ModelClient for them. */
const EXTERNAL_AGENT_PROVIDER_KINDS = new Set(['agent-sdk', 'cursor-sdk', 'antigravity-cli'])
/** The Runtime's model-utility route accepts at most 120 s; leave it a margin so this timer decides. */
const MAX_PROMPT_OPTIMIZATION_TIMEOUT_MS = 115_000
const RUNTIME_TIMEOUT_MARGIN_MS = 5_000

const activeRequests = new Map<string, AbortController>()

export function cancelPromptOptimization(requestId: string): void {
  activeRequests.get(requestId)?.abort()
}

function firstProviderModel(provider: ModelProviderProfileV1): string {
  return provider.models.map((item) => item.trim()).find(Boolean) ?? ''
}

function defaultPromptOptimizationModel(settings: AppSettingsV1, provider: ModelProviderProfileV1): string {
  const runtime = resolveKunRuntimeSettings(settings)
  // An empty runtime provider id means the default provider, not "whichever provider is asked about".
  const activeProviderId = getModelProviderProfile(settings, runtime.providerId).id
  const smallModel = runtime.smallModel?.trim() ?? ''
  const smallProviderId = runtime.smallModelProviderId?.trim()
    ? getModelProviderProfile(settings, runtime.smallModelProviderId).id
    : activeProviderId
  if (smallModel && smallProviderId === provider.id) return smallModel

  const mainModel = runtime.model.trim()
  if (mainModel && activeProviderId === provider.id) return mainModel

  return firstProviderModel(provider) || mainModel
}

function findExactProvider(settings: AppSettingsV1, providerId: string): ModelProviderProfileV1 | undefined {
  const id = normalizeModelProviderId(providerId)
  return getModelProviderSettings(settings).providers.find((profile) => profile.id === id)
}

function targetFor(
  settings: AppSettingsV1,
  source: PromptOptimizationTarget['source'],
  provider: ModelProviderProfileV1,
  requestedModel: string
): PromptOptimizationTarget {
  const runtime = resolveKunRuntimeSettings(settings)
  const model = requestedModel && requestedModel.toLowerCase() !== 'auto'
    ? requestedModel
    : defaultPromptOptimizationModel(settings, provider)
  const profile = modelProviderModelProfile(provider, model)
  return {
    source,
    providerId: provider.id,
    model,
    apiKey: provider.apiKey.trim() || runtime.apiKey.trim(),
    baseUrl: provider.baseUrl.trim() || runtime.baseUrl.trim() || DEFAULT_DEEPSEEK_BASE_URL,
    endpointFormat: profile?.endpointFormat ?? provider.endpointFormat,
    responsesMode: profile?.responsesMode
  }
}

/**
 * A model pinned in Settings wins; otherwise the composer's selected Kun model
 * is used. A composer model that belongs to an external agent's own sign-in
 * cannot be called from here, so it resolves to `unsupported_model`.
 */
export function resolvePromptOptimizationTarget(
  settings: AppSettingsV1,
  selection?: PromptOptimizationSelection
): { ok: true; target: PromptOptimizationTarget } | { ok: false; message: string } {
  const runtime = resolveKunRuntimeSettings(settings)
  const pinned = runtime.promptOptimization
  if (pinned.providerId.trim() || pinned.model.trim()) {
    const provider = getModelProviderProfile(settings, pinned.providerId.trim() || runtime.providerId)
    return { ok: true, target: targetFor(settings, 'pinned', provider, pinned.model.trim()) }
  }
  if (!selection) {
    return { ok: true, target: targetFor(settings, 'default', getModelProviderProfile(settings, runtime.providerId), '') }
  }
  const provider = selection.providerId.trim() ? findExactProvider(settings, selection.providerId.trim()) : undefined
  if (!provider || EXTERNAL_AGENT_PROVIDER_KINDS.has(provider.kind ?? '')) {
    return { ok: false, message: 'The selected model is not a Kun provider model. Pick a Kun model or pin one in Settings.' }
  }
  return { ok: true, target: targetFor(settings, 'composer', provider, selection.model.trim()) }
}

/** Models sometimes wrap the whole answer in one fence despite the instructions. */
export function cleanOptimizedPromptText(text: string): string {
  const trimmed = text.trim()
  const fenced = /^```[\w-]*\n([\s\S]*?)\n```$/.exec(trimmed)
  return (fenced ? fenced[1] : trimmed).trim()
}

function sanitizedBaseUrl(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return '[invalid URL]'
  }
}

function failure(code: PromptOptimizationFailureCode, message: string): PromptOptimizationResult {
  return { ok: false, code, message }
}

export async function optimizePrompt(
  settings: AppSettingsV1,
  sourceText: string,
  options: PromptOptimizationOptions = {}
): Promise<PromptOptimizationResult> {
  const trimmed = sourceText.trim()
  if (!trimmed) return failure('empty', 'Prompt text is empty.')
  const runtime = resolveKunRuntimeSettings(settings)
  if (!runtime.promptOptimization.enabled) return failure('disabled', 'Prompt optimization is disabled.')
  const resolved = resolvePromptOptimizationTarget(settings, options.selection)
  if (!resolved.ok) return failure('unsupported_model', resolved.message)
  const target = resolved.target
  const viaRuntime = routesTextThroughRuntime()
  if (!viaRuntime && !target.apiKey) {
    return failure('failed', 'Prompt optimization model is missing an API key.')
  }
  if (!viaRuntime && !resolveCodexResponsesRequestAuth(target.baseUrl, target.apiKey).apiKey) {
    return failure('failed', 'ChatGPT subscription credentials are invalid. Please sign in again.')
  }

  const requestId = options.requestId || randomUUID()
  activeRequests.get(requestId)?.abort()
  const controller = new AbortController()
  activeRequests.set(requestId, controller)
  const timeoutMs = Math.min(runtime.promptOptimization.timeoutMs, MAX_PROMPT_OPTIMIZATION_TIMEOUT_MS)
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
  const startedAt = Date.now()
  // Never log the prompt text, credentials, or the model's answer.
  const detail = {
    requestId,
    source: target.source,
    providerId: target.providerId,
    model: target.model,
    endpointFormat: target.endpointFormat,
    baseUrl: sanitizedBaseUrl(target.baseUrl),
    transport: viaRuntime ? 'runtime' : 'direct',
    inputChars: trimmed.length
  }
  options.log?.info?.('prompt-enhance', 'Prompt enhancement started', detail)
  try {
    const result = await oneShotModelRequest({
      purpose: 'prompt-optimization',
      baseUrl: target.baseUrl,
      apiKey: target.apiKey,
      endpointFormat: target.endpointFormat,
      responsesMode: target.responsesMode,
      model: target.model,
      systemPrompt: resolveKunPromptOptimizationPrompt(runtime),
      userText: trimmed,
      timeoutMs: timeoutMs + RUNTIME_TIMEOUT_MARGIN_MS,
      proxyUrl: viaRuntime ? undefined : resolveProviderProxyUrl(settings, target.providerId),
      providerId: target.providerId,
      presetSource: getModelProviderProfile(settings, target.providerId).presetSource?.presetId,
      signal: controller.signal
    })
    const durationMs = Date.now() - startedAt
    if (controller.signal.aborted) {
      const code = timedOut ? 'timeout' : 'cancelled'
      options.log?.info?.('prompt-enhance', `Prompt enhancement ${code}`, { ...detail, durationMs })
      return failure(code, timedOut ? `Prompt optimization timed out after ${timeoutMs} ms.` : 'Prompt optimization was cancelled.')
    }
    const text = result.ok ? cleanOptimizedPromptText(result.text) : ''
    if (!result.ok || !text) {
      const message = result.ok ? 'Model request returned empty text.' : result.message
      options.log?.error?.('prompt-enhance', 'Prompt enhancement failed', {
        ...detail,
        durationMs,
        message: redactSecretText(message).slice(0, 300)
      })
      return failure('failed', message)
    }
    options.log?.info?.('prompt-enhance', 'Prompt enhancement finished', { ...detail, durationMs, outputChars: text.length })
    return { ok: true, text, model: target.model, providerId: target.providerId }
  } finally {
    clearTimeout(timer)
    if (activeRequests.get(requestId) === controller) activeRequests.delete(requestId)
  }
}
