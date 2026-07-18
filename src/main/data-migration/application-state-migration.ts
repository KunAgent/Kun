import {
  normalizeAppSettings,
  normalizeScheduledTask,
  normalizeWorkflow,
  type AppSettingsV1,
  type ScheduledTaskV1,
  type WorkflowV1
} from '../../shared/app-settings'
import type {
  DataMigrationSourcePlatform,
  ImportedWorkspaceTrustReset,
  RestoredRendererState
} from '../../shared/data-migration'
import { rebindDataMigrationReferences } from './import-planner'

export type { ImportedWorkspaceTrustReset, RestoredRendererState } from '../../shared/data-migration'

export function applyPortableSettingsMigration(
  current: AppSettingsV1,
  portable: unknown
): AppSettingsV1 {
  assertNoImportedTrustOrSecrets(portable)
  const value = asRecord(portable)
  const write = asRecord(value.write)
  const design = asRecord(value.design)
  return normalizeAppSettings({
    ...current,
    ...(isLocale(value.locale) ? { locale: value.locale } : {}),
    ...(isTheme(value.theme) ? { theme: value.theme } : {}),
    ...(typeof value.uiFontScale === 'number' ? { uiFontScale: value.uiFontScale as AppSettingsV1['uiFontScale'] } : {}),
    ...(typeof value.chatContentMaxWidthPx === 'number'
      ? { chatContentMaxWidthPx: value.chatContentMaxWidthPx as AppSettingsV1['chatContentMaxWidthPx'] }
      : {}),
    ...(typeof value.cursorSpotlight === 'boolean' ? { cursorSpotlight: value.cursorSpotlight } : {}),
    ...(typeof value.cursorSpotlightColor === 'string' ? { cursorSpotlightColor: value.cursorSpotlightColor } : {}),
    notifications: {
      ...current.notifications,
      ...(typeof asRecord(value.notifications).turnComplete === 'boolean'
        ? { turnComplete: asRecord(value.notifications).turnComplete as boolean }
        : {})
    },
    appBehavior: {
      ...current.appBehavior,
      ...(isCloseAction(asRecord(value.appBehavior).closeAction)
        ? { closeAction: asRecord(value.appBehavior).closeAction }
        : {})
    },
    ...(typeof value.gitBranchPrefix === 'string' ? { gitBranchPrefix: value.gitBranchPrefix } : {}),
    ...(typeof value.codePromptPrefix === 'string' ? { codePromptPrefix: value.codePromptPrefix } : {}),
    ...(Array.isArray(value.disabledSkillIds)
      ? { disabledSkillIds: value.disabledSkillIds.filter((item): item is string => typeof item === 'string') }
      : {}),
    write: {
      ...current.write,
      ...(typeof write.autoSaveEnabled === 'boolean' ? { autoSaveEnabled: write.autoSaveEnabled } : {}),
      ...(typeof write.autoSaveDelayMs === 'number' ? { autoSaveDelayMs: write.autoSaveDelayMs } : {}),
      ...(isRecord(write.typography) ? { typography: { ...current.write.typography, ...write.typography } } : {}),
      ...(Array.isArray(write.agentPresets) ? { agentPresets: write.agentPresets as AppSettingsV1['write']['agentPresets'] } : {})
    },
    design: {
      ...current.design,
      ...pickDefined(design, [
        'brandColor', 'tone', 'designSystemPreset', 'designType', 'designGuidelines', 'radius', 'density',
        'fontStyle', 'implementStackHint', 'injectIntoCode', 'publishDesignSystem', 'defaultViewport',
        'defaultCanvasView', 'canvasBackground', 'liveRefresh', 'deviceFrame'
      ])
    }
  } as AppSettingsV1)
}

export function restoreSemanticRendererState(input: {
  state: unknown
  workspacePathMap: Readonly<Record<string, string>>
  threadIdMap: Readonly<Record<string, string>>
  sourcePlatform: DataMigrationSourcePlatform
}): RestoredRendererState {
  assertNoImportedTrustOrSecrets(input.state)
  const state = asRecord(input.state)
  const semantic = {
    design: arrayValue(state.design),
    write: arrayValue(state.write),
    plans: arrayValue(state.plans),
    sdd: arrayValue(state.sdd),
    forks: arrayValue(state.forks),
    threads: arrayValue(state.threads),
    composer: asRecord(state.composer),
    workspaces: arrayValue(state.workspaces)
  }
  const rebound = rebindDataMigrationReferences({
    value: semantic,
    component: 'renderer-state',
    schemaVersion: 1,
    workspacePathMap: input.workspacePathMap,
    threadIdMap: input.threadIdMap,
    sourcePlatform: input.sourcePlatform
  })
  const value = asRecord(rebound.value)
  return {
    schemaVersion: 1,
    design: arrayValue(value.design),
    write: arrayValue(value.write),
    plans: arrayValue(value.plans),
    sdd: arrayValue(value.sdd),
    forks: arrayValue(value.forks),
    threads: arrayValue(value.threads),
    composer: asRecord(value.composer),
    workspaces: arrayValue(value.workspaces),
    unresolvedReferences: rebound.unresolved
  }
}

export function importDisabledAutomations(input: {
  current: AppSettingsV1
  automations: unknown
  workspacePathMap: Readonly<Record<string, string>>
  nowIso: string
}): AppSettingsV1 {
  assertNoImportedTrustOrSecrets(input.automations)
  const automations = asRecord(input.automations)
  const existingWorkflowIds = new Set(input.current.workflow.workflows.map((workflow) => workflow.id))
  const existingScheduleIds = new Set(input.current.schedule.tasks.map((task) => task.id))
  const workflows = arrayValue(automations.workflows).map((value, index) => {
    const raw = sanitizeAutomationBindings(asRecord(value)) as Partial<WorkflowV1>
    const id = collisionFreeId(typeof raw.id === 'string' ? raw.id : `workflow-${index + 1}`, existingWorkflowIds)
    existingWorkflowIds.add(id)
    const normalized = normalizeWorkflow({
      ...raw,
      id,
      enabled: false,
      callableByAgent: false,
      env: [],
      runs: [],
      lastRunAt: '',
      nextRunAt: '',
      lastStatus: 'idle',
      lastMessage: ''
    }, index, input.nowIso)
    return rewriteAutomationWorkspacePaths(normalized, input.workspacePathMap) as WorkflowV1
  })
  const schedules = arrayValue(automations.schedules).map((value, index) => {
    const raw = sanitizeAutomationBindings(asRecord(value)) as Partial<ScheduledTaskV1>
    const id = collisionFreeId(typeof raw.id === 'string' ? raw.id : `task-${index + 1}`, existingScheduleIds)
    existingScheduleIds.add(id)
    const normalized = normalizeScheduledTask({
      ...raw,
      id,
      enabled: false,
      clawChannelId: '',
      providerId: '',
      lastThreadId: '',
      lastRunAt: '',
      nextRunAt: '',
      lastStatus: 'idle',
      lastMessage: ''
    }, index, input.nowIso)
    return rewriteAutomationWorkspacePaths(normalized, input.workspacePathMap) as ScheduledTaskV1
  })
  return normalizeAppSettings({
    ...input.current,
    workflow: {
      ...input.current.workflow,
      workflows: [...input.current.workflow.workflows, ...workflows],
      // Imported definitions exist for review only. Existing global preference remains unchanged;
      // individual definitions are always disabled and never hook-bound here.
      hookTriggers: input.current.workflow.hookTriggers
    },
    schedule: {
      ...input.current.schedule,
      tasks: [...input.current.schedule.tasks, ...schedules]
    }
  })
}

export function importedWorkspaceTrustResets(workspaceRoots: readonly string[]): ImportedWorkspaceTrustReset[] {
  return [...new Set(workspaceRoots.map((root) => root.trim()).filter(Boolean))].map((workspaceRoot) => ({
    workspaceRoot,
    trusted: false,
    disabledCapabilities: [
      'hooks', 'commands', 'extensions', 'schedules', 'workflows', 'connect-channels', 'external-actions'
    ]
  }))
}

export function assertNoImportedTrustOrSecrets(value: unknown): void {
  const forbidden: string[] = []
  const walk = (current: unknown, pointer: string) => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => walk(item, `${pointer}/${index}`))
      return
    }
    if (!current || typeof current !== 'object') return
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      const next = `${pointer}/${key}`
      if (/(?:password|passphrase|secret|credential|oauth|apiKey|accessToken|refreshToken|runtimeToken|approval|trustedWorkspaceRoots|permissionGrants)/i.test(key)) {
        forbidden.push(next)
      }
      walk(child, next)
    }
  }
  walk(value, '')
  if (forbidden.length > 0) throw new Error(`imported application state contains forbidden trust or secret fields: ${forbidden.join(', ')}`)
}

function rewriteAutomationWorkspacePaths(value: unknown, map: Readonly<Record<string, string>>): unknown {
  if (Array.isArray(value)) return value.map((item) => rewriteAutomationWorkspacePaths(item, map))
  if (!value || typeof value !== 'object') return value
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof child === 'string' && /workspaceRoot/i.test(key)) output[key] = map[child] ?? child
    else output[key] = rewriteAutomationWorkspacePaths(child, map)
  }
  return output
}

function sanitizeAutomationBindings(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAutomationBindings)
  if (!value || typeof value !== 'object') return value
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/^(?:providerId|channelId|clawChannelId|webhookSecret)$/i.test(key)) {
      output[key] = ''
      continue
    }
    if (/^(?:enabled|callableByAgent)$/i.test(key)) {
      output[key] = false
      continue
    }
    if (/^(?:runs|runHistory|pendingApprovals)$/i.test(key)) {
      output[key] = []
      continue
    }
    output[key] = sanitizeAutomationBindings(child)
  }
  return output
}

function collisionFreeId(id: string, existing: ReadonlySet<string>): string {
  if (!existing.has(id)) return id
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = `${id}-imported-${index}`
    if (!existing.has(candidate)) return candidate
  }
  throw new Error(`unable to allocate imported automation id: ${id}`)
}

function pickDefined(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.flatMap((key) => source[key] === undefined ? [] : [[key, source[key]]]))
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function isLocale(value: unknown): value is AppSettingsV1['locale'] {
  return value === 'en' || value === 'zh'
}

function isTheme(value: unknown): value is AppSettingsV1['theme'] {
  return value === 'system' || value === 'light' || value === 'dark'
}

function isCloseAction(value: unknown): value is NonNullable<AppSettingsV1['appBehavior']['closeAction']> {
  return value === 'ask' || value === 'tray' || value === 'quit'
}
