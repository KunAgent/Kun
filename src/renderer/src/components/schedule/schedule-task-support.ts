import {
  DEFAULT_SCHEDULE_MODEL,
  DEFAULT_SCHEDULE_REASONING_EFFORT,
  SCHEDULE_REASONING_EFFORT_IDS,
  type AppSettingsV1,
  type ClawImChannelV1,
  type ModelProviderModelProfileV1,
  type ModelProviderProfileV1,
  type ScheduleKind,
  type ScheduleReasoningEffort,
  type ScheduledTaskV1
} from '@shared/app-settings'
import { getKunRuntimeSettings } from '@shared/app-settings-kun-defaults'
import {
  getModelProviderSettings,
  isComposerChatModelId,
  listNonTextModelIds,
  modelProfileSupportsTextChat,
  modelProviderModelProfile
} from '@shared/app-settings-provider-core'

export type TaskFilter = 'all' | 'enabled' | 'running' | 'done'
export type ScheduleClientMode = 'code' | 'im'
export type ScheduleModelProviderOption = {
  providerId: string
  label: string
  modelIds: string[]
  modelProfiles?: Record<string, ModelProviderModelProfileV1>
  provider: ModelProviderProfileV1
}
export type TaskDialogState =
  | { mode: 'create'; draft: ScheduledTaskV1 }
  | { mode: 'edit'; taskId: string; draft: ScheduledTaskV1 }

export const SCHEDULE_FILTERS: TaskFilter[] = ['all', 'enabled', 'running', 'done']
export const SCHEDULE_KIND_OPTIONS: ScheduleKind[] = ['daily', 'at', 'interval', 'manual']
export const SCHEDULE_REASONING_OPTIONS: ScheduleReasoningEffort[] = [...SCHEDULE_REASONING_EFFORT_IDS]
export const EMPTY_SCHEDULE_TASKS: ScheduledTaskV1[] = []
export const TIME_HOURS = Array.from({ length: 24 }, (_item, index) => String(index).padStart(2, '0'))
export const TIME_MINUTES = Array.from({ length: 60 }, (_item, index) => String(index).padStart(2, '0'))
export const RESULT_PREVIEW_CHAR_THRESHOLD = 360
export const RESULT_PREVIEW_LINE_THRESHOLD = 5

export function modelIdsEqual(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

export function firstConcreteScheduleModel(modelIds: readonly string[], fallback = DEFAULT_SCHEDULE_MODEL): string {
  return modelIds.find((model) => model.trim() && model.trim().toLowerCase() !== 'auto') ?? fallback
}

export function scheduleModelProviderOptions(settings: AppSettingsV1): ScheduleModelProviderOption[] {
  const nonTextModelIds = listNonTextModelIds(settings)
  return getModelProviderSettings(settings).providers
    .map((provider) => {
      const modelIds = provider.models
        .map((model) => model.trim())
        .filter((model) =>
          isComposerChatModelId(model, nonTextModelIds) &&
          modelProfileSupportsTextChat(modelProviderModelProfile(provider, model))
        )
      return {
        providerId: provider.id,
        label: provider.name.trim() || provider.id,
        modelIds,
        modelProfiles: provider.modelProfiles,
        provider
      }
    })
    .filter((provider) => provider.modelIds.length > 0)
}

export function resolveScheduleModelSelection(
  providers: readonly ScheduleModelProviderOption[],
  providerId: string | undefined,
  model: string | undefined
): { providerId: string; model: string } {
  const requestedProviderId = providerId?.trim() ?? ''
  const requestedModel = model?.trim() ?? ''
  const providerById = providers.find((provider) => provider.providerId === requestedProviderId)
  const providerByModel = requestedModel && requestedModel.toLowerCase() !== 'auto'
    ? providers.find((provider) => provider.modelIds.some((id) => modelIdsEqual(id, requestedModel)))
    : undefined
  const provider = providerById ?? providerByModel ?? providers[0]
  if (!provider) {
    return {
      providerId: requestedProviderId,
      model: requestedModel && requestedModel.toLowerCase() !== 'auto' ? requestedModel : DEFAULT_SCHEDULE_MODEL
    }
  }
  const selectedModel =
    requestedModel &&
    requestedModel.toLowerCase() !== 'auto' &&
    provider.modelIds.some((id) => modelIdsEqual(id, requestedModel))
      ? requestedModel
      : firstConcreteScheduleModel(provider.modelIds)
  return {
    providerId: provider.providerId,
    model: selectedModel
  }
}

export function preferredScheduleProviderId(
  settings: AppSettingsV1,
  providers: readonly ScheduleModelProviderOption[],
  configuredProviderId: string | undefined
): string {
  const configured = configuredProviderId?.trim() ?? ''
  if (providers.some((provider) => provider.providerId === configured)) return configured
  const runtimeProviderId = getKunRuntimeSettings(settings).providerId.trim()
  if (providers.some((provider) => provider.providerId === runtimeProviderId)) return runtimeProviderId
  return providers[0]?.providerId ?? ''
}

export function isScheduleReasoningEffort(value: string): value is ScheduleReasoningEffort {
  return SCHEDULE_REASONING_OPTIONS.includes(value as ScheduleReasoningEffort)
}

export function scheduleReasoningOptionsForModel(
  profile: Pick<ModelProviderModelProfileV1, 'reasoning'> | undefined
): ScheduleReasoningEffort[] {
  const supported = profile?.reasoning?.supportedEfforts
    .filter(isScheduleReasoningEffort) ?? []
  if (supported.length === 0) return SCHEDULE_REASONING_OPTIONS
  return SCHEDULE_REASONING_OPTIONS.filter((effort) => supported.includes(effort))
}

export function resolveScheduleReasoningSelection(
  value: ScheduleReasoningEffort | undefined,
  profile: Pick<ModelProviderModelProfileV1, 'reasoning'> | undefined
): ScheduleReasoningEffort {
  const options = scheduleReasoningOptionsForModel(profile)
  if (value && options.includes(value)) return value
  const defaultEffort = profile?.reasoning?.defaultEffort
  if (defaultEffort && isScheduleReasoningEffort(defaultEffort) && options.includes(defaultEffort)) {
    return defaultEffort
  }
  return options.includes(DEFAULT_SCHEDULE_REASONING_EFFORT)
    ? DEFAULT_SCHEDULE_REASONING_EFFORT
    : options[0] ?? DEFAULT_SCHEDULE_REASONING_EFFORT
}

export function scheduleModelProfileForSelection(
  provider: ScheduleModelProviderOption | null | undefined,
  model: string
): ModelProviderModelProfileV1 | undefined {
  return provider?.modelProfiles ? modelProviderModelProfile({ modelProfiles: provider.modelProfiles }, model) : undefined
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function newScheduledTask(workspaceRoot: string, defaults?: Partial<ScheduledTaskV1>): ScheduledTaskV1 {
  const now = nowIso()
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `schedule-${Date.now()}`,
    title: '',
    enabled: true,
    prompt: '',
    workspaceRoot,
    clawChannelId: '',
    providerId: '',
    model: DEFAULT_SCHEDULE_MODEL,
    reasoningEffort: DEFAULT_SCHEDULE_REASONING_EFFORT,
    orchestration: 'direct',
    priority: 0,
    dependsOn: [],
    useWorktree: false,
    schedule: {
      kind: 'daily',
      everyMinutes: 60,
      timeOfDay: '09:00',
      atTime: ''
    },
    createdAt: now,
    updatedAt: now,
    lastRunAt: '',
    nextRunAt: '',
    lastStatus: 'idle',
    lastMessage: '',
    lastThreadId: '',
    ...defaults,
    mode: 'agent'
  }
}

export function dateTimeLocalValueFromIso(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (part: number): string => String(part).padStart(2, '0')
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes())
  ].join('')
}

export function isoFromDateTimeLocalValue(value: string): string {
  if (!value.trim()) return ''
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}

export function scheduleTaskSummary(
  task: ScheduledTaskV1,
  t: (key: string, values?: Record<string, unknown>) => string
): string {
  if (task.schedule.kind === 'at') {
    const timeZone = task.schedule.timeZone
    return t('scheduleAt', {
      datetime: task.schedule.atTime
        ? new Intl.DateTimeFormat(undefined, {
            ...(timeZone ? { timeZone } : {}),
            dateStyle: 'medium',
            timeStyle: 'short'
          }).format(new Date(task.schedule.atTime)) + (timeZone ? ` (${timeZone})` : '')
        : '-'
    })
  }
  if (task.schedule.kind === 'interval') {
    return t('scheduleEvery', { minutes: task.schedule.everyMinutes })
  }
  if (task.schedule.kind === 'daily') {
    return t('scheduleDailyAt', { time: task.schedule.timeOfDay })
  }
  return t('scheduleManual')
}

export function scheduleReasoningLabel(
  value: ScheduleReasoningEffort,
  t: (key: string, values?: Record<string, unknown>) => string
): string {
  return t(`scheduleReasoning_${value}`)
}

export function clawChannelDisplayName(channel: ClawImChannelV1): string {
  return channel.agentProfile.name.trim() || channel.label.trim() || channel.provider
}

export function scheduleImProviderLabel(
  channel: Pick<ClawImChannelV1, 'provider' | 'platformCredential'>,
  t: (key: string, values?: Record<string, unknown>) => string
): string {
  if (channel.provider === 'weixin') return t('scheduleImProviderWeixin')
  if (channel.platformCredential?.kind === 'feishu' && channel.platformCredential.domain === 'lark') {
    return t('scheduleImProviderLark')
  }
  return t('scheduleImProviderFeishu')
}

export function scheduleImChannelOptionLabel(
  channel: ClawImChannelV1,
  t: (key: string, values?: Record<string, unknown>) => string
): string {
  return `${clawChannelDisplayName(channel)} (${scheduleImProviderLabel(channel, t)})`
}

export function configuredScheduleImChannels(channels: ClawImChannelV1[]): ClawImChannelV1[] {
  return channels.filter((channel) => channel.enabled)
}

export function preferredScheduleImChannel(channels: ClawImChannelV1[]): ClawImChannelV1 | null {
  const configured = configuredScheduleImChannels(channels)
  return configured.find((channel) => channel.provider === 'weixin') ??
    configured.find((channel) => channel.provider === 'feishu') ??
    configured[0] ??
    null
}

export function scheduledTaskClawLabel(
  task: Pick<ScheduledTaskV1, 'clawChannelId'>,
  channels: ClawImChannelV1[],
  t: (key: string, values?: Record<string, unknown>) => string
): string {
  const channelId = task.clawChannelId.trim()
  if (!channelId) return ''
  const channel = channels.find((item) => item.id === channelId)
  return channel
    ? t('scheduleClawAgentLabel', { name: scheduleImChannelOptionLabel(channel, t) })
    : t('scheduleClawAgentMissing')
}

export function validateScheduledTaskDraft(
  task: ScheduledTaskV1,
  t: (key: string, values?: Record<string, unknown>) => string,
  now = new Date()
): string | null {
  if (!task.title.trim()) return t('scheduleTaskNameRequired')
  if (task.title.trim().length > 50) return t('scheduleTaskNameTooLong')
  if (!task.prompt.trim()) return t('scheduleTaskPromptRequired')
  if (task.prompt.length > 8_000) return t('scheduleTaskPromptTooLong')
  if (task.schedule.kind === 'interval' && (!Number.isFinite(task.schedule.everyMinutes) || task.schedule.everyMinutes < 1)) {
    return t('scheduleIntervalInvalid')
  }
  if (task.schedule.kind === 'daily' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(task.schedule.timeOfDay)) {
    return t('scheduleDailyTimeInvalid')
  }
  if (task.schedule.kind === 'at') {
    const runAt = Date.parse(task.schedule.atTime)
    if (!Number.isFinite(runAt)) return t('scheduleAtTimeInvalid')
    if (task.enabled && runAt <= now.getTime()) return t('scheduleAtTimePast')
  }
  return null
}

export function filterScheduledTasks(tasks: ScheduledTaskV1[], filter: TaskFilter): ScheduledTaskV1[] {
  const filtered = tasks.filter((task) => {
    if (filter === 'enabled') return task.enabled
    if (filter === 'running') return task.lastStatus === 'queued' || task.lastStatus === 'running'
    if (filter === 'done') return task.lastStatus === 'success' || task.lastStatus === 'error'
    return true
  })
  return [...filtered].sort((a, b) => {
    const aNext = Date.parse(a.nextRunAt)
    const bNext = Date.parse(b.nextRunAt)
    if (Number.isFinite(aNext) && Number.isFinite(bNext)) return aNext - bNext
    if (Number.isFinite(aNext)) return -1
    if (Number.isFinite(bNext)) return 1
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  })
}

export function scheduledTaskLastThreadId(task: Pick<ScheduledTaskV1, 'lastThreadId'>): string {
  return task.lastThreadId.trim()
}

export function scheduledTaskResultIsExpandable(message: string): boolean {
  const trimmed = message.trim()
  if (!trimmed) return false
  return trimmed.length > RESULT_PREVIEW_CHAR_THRESHOLD ||
    trimmed.split(/\r?\n/u).length > RESULT_PREVIEW_LINE_THRESHOLD
}

export function formatDateTime(value: string, fallback: string): string {
  if (!value.trim()) return fallback
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return fallback
  return date.toLocaleString()
}

export function statusTone(status: ScheduledTaskV1['lastStatus']): string {
  if (status === 'queued') return 'bg-sky-500/15 text-sky-800 dark:text-sky-100'
  if (status === 'running') return 'bg-amber-500/15 text-amber-900 dark:text-amber-100'
  if (status === 'success') return 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-100'
  if (status === 'error') return 'bg-red-500/15 text-red-700 dark:text-red-100'
  return 'bg-ds-subtle text-ds-muted'
}
