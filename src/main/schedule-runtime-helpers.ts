import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  DEFAULT_SCHEDULE_MODEL,
  getKunRuntimeSettings,
  getModelProviderSettings,
  modelProviderModelProfile,
  normalizeScheduleReasoningEffort,
  DEFAULT_SCHEDULE_REASONING_EFFORT
} from '../shared/app-settings'
import type {
  AppSettingsV1,
  ClawImChannelV1,
  ModelProviderProfileV1,
  ScheduleReasoningEffort,
  ScheduleRunMode,
  ScheduleRunResult,
  ScheduledTaskV1
} from '../shared/app-settings'
import type { JsonSettingsStore } from './settings-store'

export type RuntimeRequestResult = { ok: boolean; status: number; body: string }

export type RuntimeRequestFn = (
  settings: AppSettingsV1,
  pathAndQuery: string,
  init: { method?: string; body?: string; headers?: Record<string, string>; signal?: AbortSignal }
) => Promise<RuntimeRequestResult>

export type PowerSaveBlockerLike = {
  start: (type: 'prevent-app-suspension' | 'prevent-display-sleep') => number
  stop: (id: number) => void
  isStarted: (id: number) => boolean
}

export type PowerSaveControllerLike = {
  acquire: () => void
  release: () => void
  isActive: () => boolean
  reset: () => void
}

export type ScheduleRuntimeDeps = {
  store: JsonSettingsStore
  withModelCredentials?: (settings: AppSettingsV1) => Promise<AppSettingsV1>
  runtimeRequest: RuntimeRequestFn
  logError: (category: string, message: string, detail?: unknown) => void
  powerSaveBlocker?: PowerSaveBlockerLike
  /** Shared reference-counted blocker. When present it wins over powerSaveBlocker. */
  powerSaveController?: PowerSaveControllerLike
}

export type ThreadRecordJson = {
  id: string
  status?: string
}

export type TurnRecordJson = {
  id: string
  status?: string
  error?: string | null
  items?: TurnItemJson[]
}

export type TurnItemJson = {
  kind: string
  turnId?: string
  text?: string | null
  summary?: string
  detail?: string | null
}

export type ThreadDetailJson = {
  thread?: ThreadRecordJson
  id?: string
  status?: string
  turns?: TurnRecordJson[]
  items?: TurnItemJson[]
}

export type RunPromptOptions = {
  prompt: string
  title: string
  workspaceRoot: string
  /** Existing thread that should receive the scheduled turn instead of creating a new one. */
  threadId?: string
  model: string
  /** Optional provider id; routed via Kun's MultiProviderModelClient. */
  providerId?: string
  reasoningEffort: ScheduleReasoningEffort
  mode: ScheduleRunMode
  orchestration?: 'direct' | 'graph'
  clawChannel?: ClawImChannelV1 | null
  waitForResult: boolean
  responseTimeoutMs: number
  signal?: AbortSignal
}

export const SCHEDULER_INTERVAL_MS = 30_000
export const INTERNAL_BODY_LIMIT_BYTES = 1_000_000
export const TASK_RESPONSE_TIMEOUT_MS = 30 * 60_000

export function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export function runtimeErrorMessage(result: RuntimeRequestResult, fallback: string): string {
  const parsed = parseJsonObject(result.body)
  if (parsed) {
    const message = parsed.message
    if (typeof message === 'string' && message.trim()) return message.trim()
    const error = parsed.error
    if (typeof error === 'string' && error.trim()) return error.trim()
    if (typeof error === 'object' && error !== null) {
      const nested = (error as Record<string, unknown>).message
      if (typeof nested === 'string' && nested.trim()) return nested.trim()
    }
  }
  return result.body.trim() || fallback
}

export function isRunningStatus(status: string | undefined): boolean {
  return status === 'queued' || status === 'in_progress' || status === 'started' || status === 'running'
}

export function latestAssistantText(
  detail: ThreadDetailJson,
  options: { turnId?: string } = {}
): string {
  const turnId = options.turnId?.trim()
  const items = turnId
    ? threadItems(detail).filter((item) => item.turnId === turnId)
    : threadItems(detail)
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item.kind !== 'assistant_text' && item.kind !== 'agent_message') continue
    const text = (item.text ?? item.detail ?? item.summary ?? '').trim()
    if (text) return text
  }
  return ''
}

function threadItems(detail: ThreadDetailJson): TurnItemJson[] {
  const turns = Array.isArray(detail.turns) ? detail.turns : []
  const singleTurnId = turns.length === 1 ? turns[0].id : ''
  const topLevelItems = Array.isArray(detail.items)
    ? detail.items.map((item) => ({ ...item, turnId: item.turnId || singleTurnId || undefined }))
    : []
  const turnItems = turns.flatMap((turn) =>
    Array.isArray(turn.items)
      ? turn.items.map((item) => ({ ...item, turnId: item.turnId || turn.id }))
      : []
  )
  return [...topLevelItems, ...turnItems]
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted || ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function normalizeTaskModel(model: string): string | undefined {
  const trimmed = model.trim()
  return trimmed && trimmed.toLowerCase() !== 'auto' ? trimmed : undefined
}

export function summarizeTaskResult(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return 'Completed'
  return trimmed.length > 1_000 ? `${trimmed.slice(0, 1_000)}...` : trimmed
}

export function computeScheduleNextRunAt(task: ScheduledTaskV1, from: Date): string {
  if (!task.enabled || task.schedule.kind === 'manual') return ''
  if (task.schedule.kind === 'at') {
    return task.schedule.atTime.trim()
  }
  if (task.schedule.kind === 'interval') {
    return new Date(from.getTime() + task.schedule.everyMinutes * 60_000).toISOString()
  }

  const [hourRaw, minuteRaw] = task.schedule.timeOfDay.split(':')
  const hour = Number(hourRaw)
  const minute = Number(minuteRaw)
  const next = new Date(from)
  next.setSeconds(0, 0)
  next.setHours(Number.isFinite(hour) ? hour : 9, Number.isFinite(minute) ? minute : 0, 0, 0)
  if (next.getTime() <= from.getTime()) {
    next.setDate(next.getDate() + 1)
  }
  return next.toISOString()
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function nestedRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload)
  })
  res.end(payload)
}

export async function readRequestBody(req: IncomingMessage): Promise<string> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > INTERNAL_BODY_LIMIT_BYTES) {
      throw new Error('Request body is too large.')
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function internalUrl(settings: AppSettingsV1): string {
  return `http://127.0.0.1:${settings.schedule.internal.port}`
}

export function hasEnabledScheduledTask(settings: AppSettingsV1): boolean {
  return settings.schedule.tasks.some((task) => task.enabled && task.schedule.kind !== 'manual')
}

// ---------------------------------------------------------------------------
// Shared model resolution + prompt execution primitives.
//
// These were extracted from ScheduleRuntime so the WorkflowRuntime AI-agent
// node runs a prompt through the exact same Kun-runtime path as a scheduled
// task. ScheduleRuntime now delegates to them (behavior-preserving).
// ---------------------------------------------------------------------------

export type ScheduleModelConfig = {
  providerId: string
  model: string
  reasoningEffort: ScheduleReasoningEffort
}

const SCHEDULE_REASONING_EFFORT_SET = new Set<ScheduleReasoningEffort>([
  'auto',
  'off',
  'low',
  'medium',
  'high',
  'max'
])

function isScheduleReasoningEffort(value: string): value is ScheduleReasoningEffort {
  return SCHEDULE_REASONING_EFFORT_SET.has(value as ScheduleReasoningEffort)
}

function modelIdsMatch(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

function providerHasModel(provider: Pick<ModelProviderProfileV1, 'models'>, model: string): boolean {
  return provider.models.some((candidate) => modelIdsMatch(candidate, model))
}

function firstConcreteProviderModel(provider: Pick<ModelProviderProfileV1, 'models'> | null): string {
  return provider?.models.find((model) => normalizeTaskModel(model))?.trim() ?? DEFAULT_SCHEDULE_MODEL
}

function resolveReasoningForModel(
  provider: Pick<ModelProviderProfileV1, 'modelProfiles'> | null,
  model: string,
  reasoningEffort: ScheduleReasoningEffort | string | null | undefined
): ScheduleReasoningEffort {
  const requested = normalizeScheduleReasoningEffort(reasoningEffort)
  const profile = provider ? modelProviderModelProfile(provider, model) : undefined
  const supported = profile?.reasoning?.supportedEfforts.filter(isScheduleReasoningEffort) ?? []
  if (supported.length === 0) return requested
  if (supported.includes(requested)) return requested
  const profileDefault = profile?.reasoning?.defaultEffort
  if (profileDefault && isScheduleReasoningEffort(profileDefault) && supported.includes(profileDefault)) {
    return profileDefault
  }
  return supported.includes(DEFAULT_SCHEDULE_REASONING_EFFORT)
    ? DEFAULT_SCHEDULE_REASONING_EFFORT
    : supported[0] ?? DEFAULT_SCHEDULE_REASONING_EFFORT
}

/**
 * Resolve provider/model/reasoning for a prompt run. `fallbackProviderId` lets
 * callers supply a feature-specific default (schedule vs workflow) consulted
 * after the requested/runtime providers.
 */
export function resolveScheduleModelConfig(
  settings: AppSettingsV1,
  input: {
    providerId?: string | null
    model?: string | null
    reasoningEffort?: ScheduleReasoningEffort | string | null
  },
  fallbackProviderId = ''
): ScheduleModelConfig {
  const providers = getModelProviderSettings(settings).providers
  const requestedProviderId = input.providerId?.trim() || ''
  const requestedModel = normalizeTaskModel(input.model ?? '')
  const runtimeProviderId = getKunRuntimeSettings(settings).providerId.trim()
  const extraProviderId = fallbackProviderId.trim()
  const provider =
    providers.find((item) => item.id === requestedProviderId) ??
    (requestedModel ? providers.find((item) => providerHasModel(item, requestedModel)) : undefined) ??
    providers.find((item) => item.id === runtimeProviderId) ??
    (extraProviderId ? providers.find((item) => item.id === extraProviderId) : undefined) ??
    providers[0] ??
    null
  const model =
    requestedModel && (!provider || providerHasModel(provider, requestedModel))
      ? requestedModel
      : firstConcreteProviderModel(provider)
  return {
    providerId: provider?.id ?? requestedProviderId,
    model,
    reasoningEffort: resolveReasoningForModel(provider, model, input.reasoningEffort)
  }
}

export type RunPromptViaRuntimeOptions = {
  /** Final prompt to send (callers apply any prefixing/persona). */
  prompt: string
  title: string
  /** Resolved workspace path (callers apply the default fallback). */
  workspaceRoot: string
  /** Existing thread that should receive the scheduled turn instead of creating a new one. */
  threadId?: string
  model: string
  /**
   * Optional provider id override. Forwarded to Kun's `POST /v1/threads` so
   * the thread (and every turn on it) routes its model request through the
   * kun-config `serve.providers[providerId]` HTTP client. Omitted or
   * matching the runtime's bound provider → use the runtime default (no
   * behavior change).
   */
  providerId?: string
  reasoningEffort: ScheduleReasoningEffort | ''
  mode: ScheduleRunMode
  orchestration?: 'direct' | 'graph'
  waitForResult: boolean
  responseTimeoutMs: number
  signal?: AbortSignal
}

export async function runPromptViaRuntime(
  deps: { runtimeRequest: RuntimeRequestFn },
  settings: AppSettingsV1,
  options: RunPromptViaRuntimeOptions
): Promise<ScheduleRunResult> {
  options.signal?.throwIfAborted()
  const workspace = options.workspaceRoot.trim()
  if (workspace) {
    try {
      if (!(await stat(workspace)).isDirectory()) {
        return { ok: false, message: `Workspace is not a directory: ${workspace}` }
      }
    } catch {
      return { ok: false, message: `Workspace directory is unavailable: ${workspace}` }
    }
  }
  const model = normalizeTaskModel(options.model) ?? (settings.agents.kun.model.trim() || DEFAULT_SCHEDULE_MODEL)
  const providerId = options.providerId?.trim()
  const existingThreadId = options.threadId?.trim()
  let threadId = existingThreadId ?? ''
  if (!threadId) {
    const create = await deps.runtimeRequest(settings, '/v1/threads', {
      method: 'POST',
      ...(options.signal ? { signal: options.signal } : {}),
      body: JSON.stringify({
        workspace,
        model,
        mode: options.mode,
        ...(providerId ? { providerId } : {}),
        ...(options.title.trim() ? { title: options.title.trim() } : {})
      })
    })
    if (!create.ok) return { ok: false, message: runtimeErrorMessage(create, 'Failed to create thread.') }
    const thread = JSON.parse(create.body) as ThreadRecordJson
    threadId = thread.id
  }

  const turnBody: Record<string, unknown> = {
    prompt: options.prompt,
    mode: options.mode,
    clientSurface: 'api',
    // Headless turns — nobody can answer a user_input prompt; a turn that asks
    // one hangs until the response timeout.
    disableUserInput: true,
    orchestration: options.orchestration ?? 'direct'
  }
  if (model) turnBody.model = model
  if (providerId) turnBody.providerId = providerId
  if (options.reasoningEffort) turnBody.reasoningEffort = options.reasoningEffort
  const turn = await deps.runtimeRequest(
    settings,
    `/v1/threads/${encodeURIComponent(threadId)}/turns`,
    {
      method: 'POST',
      body: JSON.stringify(turnBody),
      ...(options.signal ? { signal: options.signal } : {})
    }
  )
  if (!turn.ok) return { ok: false, message: runtimeErrorMessage(turn, 'Failed to start turn.') }

  const parsedTurn = parseJsonObject(turn.body)
  const turnId = asString(nestedRecord(parsedTurn?.turn).id) || asString(parsedTurn?.turnId)
  if (!turnId) {
    return { ok: false, message: 'Failed to start turn: missing turn id.' }
  }
  if (!options.waitForResult) {
    return { ok: true, threadId, turnId, message: 'Started' }
  }

  const text = await waitForAssistantTextViaRuntime(
    deps,
    settings,
    threadId,
    turnId,
    options.responseTimeoutMs,
    options.signal
  )
  return { ok: true, threadId, turnId, text, message: text || 'Completed' }
}

export async function waitForAssistantTextViaRuntime(
  deps: { runtimeRequest: RuntimeRequestFn },
  settings: AppSettingsV1,
  threadId: string,
  turnId: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let lastText = ''
  while (Date.now() < deadline) {
    await sleep(1_500, signal)
    signal?.throwIfAborted()
    const detailRes = await deps.runtimeRequest(
      settings,
      `/v1/threads/${encodeURIComponent(threadId)}`,
      { method: 'GET', ...(signal ? { signal } : {}) }
    )
    signal?.throwIfAborted()
    if (!detailRes.ok) {
      throw new Error(runtimeErrorMessage(detailRes, 'Failed to read thread result.'))
    }
    const detail = JSON.parse(detailRes.body) as ThreadDetailJson
    lastText = latestAssistantText(detail, { turnId }) || lastText
    const targetTurn = Array.isArray(detail.turns)
      ? detail.turns.find((turn) => turn.id === turnId)
      : undefined
    if (!targetTurn) continue
    if (isRunningStatus(targetTurn.status)) continue
    if (targetTurn.status === 'failed' || targetTurn.status === 'aborted') {
      const error = targetTurn.error?.trim()
      throw new Error(error || `Agent turn ${targetTurn.status}.`)
    }
    if (targetTurn.status === 'completed' && lastText) return lastText
  }
  if (lastText) return lastText
  throw new Error('Timed out waiting for agent response.')
}
