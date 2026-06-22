import {
  DEFAULT_SCHEDULE_INTERNAL_PORT,
  DEFAULT_SCHEDULE_MODEL,
  MIN_KUN_LOCAL_PORT,
  type ScheduleSettingsPatchV1,
  type ScheduleSettingsV1,
  type ScheduledTaskV1
} from './app-settings-types'
import {
  compactStrings,
  normalizeAtTime,
  normalizeBoolean,
  normalizePositiveInteger,
  normalizeRunMode,
  normalizeScheduleKind,
  normalizeScheduleReasoningEffort,
  normalizeStatus,
  normalizeTimeOfDay
} from './app-settings-normalizers'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeScheduleInternalPort(value: unknown, fallback: number): number {
  if (value === 8788) return DEFAULT_SCHEDULE_INTERNAL_PORT
  return normalizePositiveInteger(value, fallback, MIN_KUN_LOCAL_PORT, 65_535)
}

export function normalizeScheduledTask(
  task: Partial<ScheduledTaskV1>,
  index: number,
  now: string
): ScheduledTaskV1 {
  const schedule = task.schedule
  const model = normalizeScheduleModel(task.model)
  return {
    id: typeof task.id === 'string' && task.id.trim() ? task.id.trim() : `task-${index + 1}`,
    title: typeof task.title === 'string' && task.title.trim() ? task.title.trim() : `Task ${index + 1}`,
    enabled: normalizeBoolean(task.enabled, true),
    prompt: typeof task.prompt === 'string' ? task.prompt : '',
    workspaceRoot: typeof task.workspaceRoot === 'string' ? task.workspaceRoot.trim() : '',
    clawChannelId: typeof task.clawChannelId === 'string' ? task.clawChannelId.trim() : '',
    providerId: typeof task.providerId === 'string' ? task.providerId.trim() : '',
    model,
    reasoningEffort: normalizeScheduleReasoningEffort(task.reasoningEffort),
    mode: normalizeRunMode(task.mode),
    priority: normalizePositiveInteger(task.priority, 0, 0, 100),
    dependsOn: compactStrings(task.dependsOn).filter((id) => id !== task.id),
    useWorktree: normalizeBoolean(task.useWorktree, false),
    schedule: {
      kind: normalizeScheduleKind(schedule?.kind),
      everyMinutes: normalizePositiveInteger(schedule?.everyMinutes, 60, 1, 10_080),
      timeOfDay: normalizeTimeOfDay(schedule?.timeOfDay),
      atTime: normalizeAtTime(schedule?.atTime)
    },
    createdAt: typeof task.createdAt === 'string' && task.createdAt ? task.createdAt : now,
    updatedAt: typeof task.updatedAt === 'string' && task.updatedAt ? task.updatedAt : now,
    lastRunAt: typeof task.lastRunAt === 'string' ? task.lastRunAt : '',
    nextRunAt: typeof task.nextRunAt === 'string' ? task.nextRunAt : '',
    lastStatus: normalizeStatus(task.lastStatus),
    lastMessage: typeof task.lastMessage === 'string' ? task.lastMessage : '',
    lastThreadId: typeof task.lastThreadId === 'string' ? task.lastThreadId : ''
  }
}

export function defaultScheduleSettings(): ScheduleSettingsV1 {
  return {
    enabled: false,
    defaultWorkspaceRoot: '',
    providerId: '',
    model: DEFAULT_SCHEDULE_MODEL,
    mode: 'agent',
    promptPrefix: '',
    skills: {
      defaultNames: [],
      extraDirs: [],
      disabledDirs: []
    },
    keepAwake: false,
    internal: {
      port: DEFAULT_SCHEDULE_INTERNAL_PORT,
      secret: ''
    },
    tasks: []
  }
}

export function normalizeScheduleSettings(
  input: ScheduleSettingsPatchV1 | undefined
): ScheduleSettingsV1 {
  const defaults = defaultScheduleSettings()
  const source = isRecord(input) ? input as ScheduleSettingsPatchV1 : {}
  const skills = isRecord(source.skills) ? source.skills : defaults.skills
  const internal = isRecord(source.internal) ? source.internal : defaults.internal
  const now = new Date().toISOString()
  return {
    enabled: normalizeBoolean(source.enabled, defaults.enabled),
    defaultWorkspaceRoot:
      typeof source.defaultWorkspaceRoot === 'string' ? source.defaultWorkspaceRoot.trim() : '',
    providerId: typeof source.providerId === 'string' ? source.providerId.trim() : '',
    model: normalizeScheduleModel(source.model),
    mode: normalizeRunMode(source.mode),
    promptPrefix: typeof source.promptPrefix === 'string' ? source.promptPrefix : '',
    skills: {
      defaultNames: compactStrings(skills.defaultNames),
      extraDirs: compactStrings(skills.extraDirs),
      disabledDirs: compactStrings(skills.disabledDirs)
    },
    keepAwake: normalizeBoolean(source.keepAwake, defaults.keepAwake),
    internal: {
      port: normalizeScheduleInternalPort(internal.port, defaults.internal.port),
      secret: typeof internal.secret === 'string' ? internal.secret.trim() : ''
    },
    tasks: Array.isArray(source.tasks)
      ? source.tasks
        .filter(isRecord)
        .map((task, index) => normalizeScheduledTask(task as Partial<ScheduledTaskV1>, index, now))
      : []
  }
}

function normalizeScheduleModel(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_SCHEDULE_MODEL
  const trimmed = value.trim()
  return trimmed && trimmed.toLowerCase() !== 'auto' ? trimmed : DEFAULT_SCHEDULE_MODEL
}

export function mergeScheduleSettings(
  current: ScheduleSettingsV1,
  patch: ScheduleSettingsPatchV1 | undefined
): ScheduleSettingsV1 {
  if (!patch) return normalizeScheduleSettings(current)
  return normalizeScheduleSettings({
    ...current,
    ...patch,
    skills: {
      ...current.skills,
      ...(patch.skills ?? {})
    },
    internal: {
      ...current.internal,
      ...(patch.internal ?? {})
    },
    tasks: patch.tasks ?? current.tasks
  })
}
