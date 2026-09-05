import type {
  AppSettingsV1,
  ModelEndpointFormat,
  ScheduleReasoningEffort,
  ScheduleRunMode,
  ScheduledTaskV1
} from '../shared/app-settings'
import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_SCHEDULE_MODEL,
  DEFAULT_SCHEDULE_REASONING_EFFORT,
  getModelProviderProfile,
  getModelProviderSettings,
  isCustomModelEndpointFormat,
  modelEndpointPath,
  modelProviderModelProfile,
  normalizeModelProviderId,
  resolveKunRuntimeSettings,
  resolveModelEndpointFormat,
  resolveProviderProxyUrl
} from '../shared/app-settings'
import { fetchWithOptionalProxy } from './proxy-fetch'
import {
  codexResponsesLiteInput,
  resolveCodexResponsesRequestAuth,
  usesCodexResponsesLite,
  withCodexResponsesLiteHeader
} from './codex-responses-lite'

const SCHEDULED_TASK_CANDIDATE_RE =
  /(?:提醒|定时|闹钟|通知|叫我|叫醒|稍后|之后|到点|分钟后|小时后|秒后|天后|明天|后天|今晚|later|remind|reminder|alarm|timer|schedule|scheduled|tomorrow|tonight|in\s+\d+\s+(?:seconds?|minutes?|hours?|days?|weeks?))/iu

const ISO_WITH_TIMEZONE_RE = /(?:[zZ]|[+-]\d{2}:\d{2})$/u
const DETECTOR_TIMEOUT_MS = 12_000

type DetectionPayload = {
  shouldCreateTask?: boolean
  scheduleAt?: string
  reminderBody?: string
  taskName?: string
}

type DetectionRequestPayload = {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
  endpointFormat: ModelEndpointFormat
}

export type ParsedClawScheduledTaskRequest = {
  kind: 'create'
  sourceText: string
  reminderBody: string
  runAt: Date
  scheduleAt: string
  taskName: string
  taskPrompt: string
  confirmationText: string
}

function normalizeReminderBody(value: string): string {
  return value
    .trim()
    .replace(/^[,，:：\s]+/u, '')
    .replace(/[。！？!?~～\s]+$/u, '')
    .replace(/^(?:一下|一声|一下子)\s*/u, '')
    .trim()
}

function normalizeReminderName(value: string): string {
  const normalized = value
    .replace(/[。！？!?]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return 'Reminder'
  const compact = normalized.length > 20 ? normalized.slice(0, 20).trim() : normalized
  return /(?:提醒|reminder)$/iu.test(compact) ? compact : `${compact} reminder`
}

function buildTaskPrompt(body: string): string {
  if (!body) return '⏰ Reminder'
  if (body.startsWith('⏰')) return body
  if (/^提醒[:：]?/u.test(body)) return `⏰ ${body}`
  if (/^remind(?:er)?[:：]?\s*/iu.test(body)) return `⏰ ${body}`
  return `⏰ Reminder: ${body}`
}

function formatRelativeDelayLabel(now: Date, runAt: Date): string {
  const diffMs = Math.max(0, runAt.getTime() - now.getTime())
  const minuteMs = 60_000
  const hourMs = 3_600_000
  const dayMs = 86_400_000
  if (diffMs < minuteMs) {
    const seconds = Math.max(1, Math.round(diffMs / 1000))
    return `${seconds}s later`
  }
  if (diffMs < hourMs) {
    const minutes = Math.max(1, Math.round(diffMs / minuteMs))
    return `${minutes}min later`
  }
  if (diffMs < dayMs) {
    const hours = Math.max(1, Math.round(diffMs / hourMs))
    return `${hours}h later`
  }
  const days = Math.max(1, Math.round(diffMs / dayMs))
  return `${days}d later`
}

function formatConfirmationText(scheduleAt: string, runAt: Date, body: string, now: Date): string {
  const delayLabel = formatRelativeDelayLabel(now, runAt)
  const localText = runAt.toLocaleString()
  return `Scheduled. I will handle "${body}" at ${localText} (${delayLabel}).`
}

function extractFirstJsonObject(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/iu)
  const candidate = fencedMatch?.[1]?.trim() || trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  return candidate.slice(start, end + 1)
}

function parseDetectionPayload(raw: string): DetectionPayload | null {
  const json = extractFirstJsonObject(raw)
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as DetectionPayload
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function normalizeDetectedRequest(
  payload: DetectionPayload | null,
  sourceText: string,
  now = new Date()
): ParsedClawScheduledTaskRequest | null {
  if (!payload?.shouldCreateTask) return null
  const scheduleAt = typeof payload.scheduleAt === 'string' ? payload.scheduleAt.trim() : ''
  if (!scheduleAt || !ISO_WITH_TIMEZONE_RE.test(scheduleAt)) return null
  const runAt = new Date(scheduleAt)
  if (!Number.isFinite(runAt.getTime()) || runAt.getTime() <= now.getTime()) return null
  const reminderBody = normalizeReminderBody(typeof payload.reminderBody === 'string' ? payload.reminderBody : '')
  if (!reminderBody) return null
  const taskName =
    typeof payload.taskName === 'string' && payload.taskName.trim()
      ? normalizeReminderName(payload.taskName)
      : normalizeReminderName(reminderBody)
  return {
    kind: 'create',
    sourceText,
    reminderBody,
    runAt,
    scheduleAt,
    taskName,
    taskPrompt: buildTaskPrompt(reminderBody),
    confirmationText: formatConfirmationText(scheduleAt, runAt, reminderBody, now)
  }
}

function buildModelEndpointUrl(baseUrl: string, endpointFormat: ModelEndpointFormat): string {
  if (isCustomModelEndpointFormat(endpointFormat)) return exactModelEndpointUrl(baseUrl)
  const path = modelEndpointPath(endpointFormat)
  const normalized = baseUrl.replace(/\/+$/, '')
  if (!normalized) return `/v1/${path}`
  if (normalized.endsWith('/v1')) return `${normalized}/${path}`
  if (normalized.endsWith('/beta')) {
    return `${normalized.slice(0, -5)}/v1/${path}`
  }
  return `${normalized}/v1/${path}`
}

function exactModelEndpointUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  const query = trimmed.search(/[?#]/)
  if (query < 0) return trimmed.replace(/\/+$/, '')
  return `${trimmed.slice(0, query).replace(/\/+$/, '')}${trimmed.slice(query)}`
}

function buildDetectionPrompt(now: Date): string {
  return [
    'You are a structured extractor for one-shot reminder requests.',
    `Current local datetime: ${now.toISOString()}.`,
    'Return JSON only. No markdown. No prose.',
    'Decide whether the user is explicitly asking to create a one-time scheduled reminder or delayed task.',
    'If yes, return: {"shouldCreateTask":true,"scheduleAt":"ISO8601 with explicit timezone offset","reminderBody":"short reminder content","taskName":"short task name"}',
    'If no, return: {"shouldCreateTask":false}',
    'Rules:',
    '- Only return true when the user explicitly wants a future one-shot reminder/task.',
    '- `scheduleAt` must be a future absolute timestamp with timezone offset.',
    '- `reminderBody` should be concise and describe what should happen at that time.',
    '- If the time is ambiguous, missing, or recurring, return false.'
  ].join('\n\n')
}

function detectionModel(model: string): string {
  const trimmed = model.trim()
  return trimmed && trimmed !== DEFAULT_SCHEDULE_MODEL ? trimmed : 'deepseek-v4-flash'
}

function buildDetectionRequest(input: {
  baseUrl: string
  apiKey: string
  endpointFormat: ModelEndpointFormat
  model: string
  systemPrompt: string
  sourceText: string
  responsesMode?: 'lite'
}): DetectionRequestPayload | null {
  const endpointFormat = resolveModelEndpointFormat(input.endpointFormat, input.baseUrl)
  if (!endpointFormat) return null
  const auth = resolveCodexResponsesRequestAuth(input.baseUrl, input.apiKey)
  const responsesLite = usesCodexResponsesLite(input.baseUrl, input.responsesMode)
  const headers: Record<string, string> = withCodexResponsesLiteHeader({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${auth.apiKey}`,
    ...auth.headers
  }, responsesLite)
  if (endpointFormat === 'messages') {
    headers['x-api-key'] = auth.apiKey
    headers['anthropic-version'] = '2023-06-01'
  }
  if (endpointFormat === 'responses') {
    if (responsesLite) {
      return {
        url: buildModelEndpointUrl(input.baseUrl, input.endpointFormat),
        headers,
        endpointFormat,
        body: {
          model: input.model,
          input: codexResponsesLiteInput(input.systemPrompt, [{ role: 'user', content: input.sourceText }]),
          store: false,
          tool_choice: 'auto',
          parallel_tool_calls: false,
          reasoning: { context: 'all_turns' },
          text: { format: { type: 'json_object' } }
        }
      }
    }
    return {
      url: buildModelEndpointUrl(input.baseUrl, input.endpointFormat),
      headers,
      endpointFormat,
      body: {
        model: input.model,
        instructions: input.systemPrompt,
        input: input.sourceText,
        max_output_tokens: 300,
        text: { format: { type: 'json_object' } }
      }
    }
  }
  if (endpointFormat === 'messages') {
    return {
      url: buildModelEndpointUrl(input.baseUrl, input.endpointFormat),
      headers,
      endpointFormat,
      body: {
        model: input.model,
        system: input.systemPrompt,
        messages: [{ role: 'user', content: input.sourceText }],
        max_tokens: 300
      }
    }
  }
  return {
    url: buildModelEndpointUrl(input.baseUrl, input.endpointFormat),
    headers,
    endpointFormat,
    body: {
      model: input.model,
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: input.sourceText }
      ],
      max_tokens: 300,
      response_format: { type: 'json_object' }
    }
  }
}

function extractDetectionContent(rawJson: string, endpointFormat: ModelEndpointFormat): string {
  const parsed = JSON.parse(rawJson) as Record<string, unknown>
  if (endpointFormat === 'responses') {
    if (typeof parsed.output_text === 'string') return parsed.output_text.trim()
    const output = parsed.output
    if (!Array.isArray(output)) return ''
    return output.map((item) => {
      if (!item || typeof item !== 'object') return ''
      const content = (item as { content?: unknown }).content
      if (!Array.isArray(content)) return ''
      return content.map((block) =>
        block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string'
          ? (block as { text: string }).text
          : ''
      ).join('')
    }).join('').trim()
  }
  if (endpointFormat === 'messages') {
    const content = parsed.content
    if (!Array.isArray(content)) return ''
    return content.map((block) =>
      block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string'
        ? (block as { text: string }).text
        : ''
    ).join('').trim()
  }
  const choices = parsed.choices
  if (!Array.isArray(choices)) return ''
  const first = choices[0]
  return first && typeof first === 'object'
    ? String((first as { message?: { content?: unknown } }).message?.content ?? '').trim()
    : ''
}

export function looksLikeClawScheduledTaskCandidate(text: string): boolean {
  return SCHEDULED_TASK_CANDIDATE_RE.test(text.trim())
}

export async function detectClawScheduledTaskRequest(
  settings: AppSettingsV1,
  sourceText: string,
  modelHint: string,
  now = new Date(),
  providerIdHint?: string | null
): Promise<ParsedClawScheduledTaskRequest | null> {
  if (!looksLikeClawScheduledTaskCandidate(sourceText)) return null
  const runtime = resolveKunRuntimeSettings(settings)
  const requestedProviderId = normalizeModelProviderId(providerIdHint)
  const runtimeProvider = getModelProviderProfile(settings, runtime.providerId)
  const provider = requestedProviderId
    ? getModelProviderSettings(settings).providers.find((item) => item.id === requestedProviderId)
    : runtimeProvider
  if (!provider) return null
  const usesRuntimeRoute = provider.id === runtimeProvider.id
  const apiKey = usesRuntimeRoute ? runtime.apiKey.trim() : provider.apiKey.trim()
  if (!apiKey) return null
  const model = detectionModel(modelHint)
  const responsesMode = modelProviderModelProfile(provider, model)?.responsesMode
  const baseUrl = usesRuntimeRoute
    ? runtime.baseUrl
    : provider.baseUrl.trim() || DEFAULT_DEEPSEEK_BASE_URL
  const endpointFormat = usesRuntimeRoute ? runtime.endpointFormat : provider.endpointFormat
  if (!resolveCodexResponsesRequestAuth(baseUrl, apiKey).apiKey) return null
  const detectionRequest = buildDetectionRequest({
    baseUrl,
    apiKey,
    endpointFormat,
    model,
    systemPrompt: buildDetectionPrompt(now),
    sourceText,
    responsesMode
  })
  if (!detectionRequest) return null
  const response = await fetchWithOptionalProxy(detectionRequest.url, {
    method: 'POST',
    headers: detectionRequest.headers,
    body: JSON.stringify(detectionRequest.body),
    signal: AbortSignal.timeout(DETECTOR_TIMEOUT_MS)
  }, resolveProviderProxyUrl(settings, provider))
  const text = await response.text()
  if (!response.ok) return null
  let content = ''
  try {
    content = extractDetectionContent(text, detectionRequest.endpointFormat)
  } catch {
    return null
  }
  return normalizeDetectedRequest(parseDetectionPayload(content), sourceText, now)
}

export function buildScheduledTaskFromDetectedRequest(options: {
  request: ParsedClawScheduledTaskRequest
  workspaceRoot: string
  providerId?: string
  model: string
  reasoningEffort?: ScheduleReasoningEffort
  mode: ScheduleRunMode
  id: string
  now?: string
}): ScheduledTaskV1 {
  const now = options.now ?? new Date().toISOString()
  return {
    id: options.id,
    title: options.request.taskName,
    enabled: true,
    prompt: options.request.taskPrompt,
    workspaceRoot: options.workspaceRoot.trim(),
    clawChannelId: '',
    providerId: options.providerId?.trim() ?? '',
    model: options.model.trim() || DEFAULT_SCHEDULE_MODEL,
    reasoningEffort: options.reasoningEffort ?? DEFAULT_SCHEDULE_REASONING_EFFORT,
    mode: options.mode,
    schedule: {
      kind: 'at',
      everyMinutes: 60,
      timeOfDay: '09:00',
      atTime: options.request.scheduleAt
    },
    createdAt: now,
    updatedAt: now,
    lastRunAt: '',
    nextRunAt: options.request.scheduleAt,
    lastStatus: 'idle',
    lastMessage: '',
    lastThreadId: ''
  }
}
