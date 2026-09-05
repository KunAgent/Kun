import type { ScheduleReasoningEffort } from '@shared/app-settings'
import { browserStorage } from '../lib/browser-storage'

export type AutoPlanScheduledSelection = {
  providerId: string
  model: string
  reasoningEffort: ScheduleReasoningEffort
  schedule: { kind: 'at'; atTime: string; timeZone: string }
}

export type AutoPlanBuildSelection = {
  buildMode: 'direct' | 'scheduled'
  useWorktree: boolean
  scheduled?: AutoPlanScheduledSelection
}

export type AutoPlanBuildIntentStatus = 'planning' | 'dispatching' | 'needs_attention'

export type AutoPlanBuildIntentV1 = AutoPlanBuildSelection & {
  version: 1
  id: string
  planId: string
  relativePath: string
  workspaceRoot: string
  threadId: string
  /** Exact admitted plan turn. Empty only for intents persisted by older builds. */
  planTurnId: string
  planClientRequestId: string
  buildClientRequestId: string
  /** Bounded identity for duplicate composer submissions; never stores prompt text. */
  requestFingerprint: string
  status: AutoPlanBuildIntentStatus
  error: string
  createdAt: string
  updatedAt: string
}

type RegistryV1 = { version: 1; intents: Record<string, AutoPlanBuildIntentV1> }

const STORAGE_KEY = 'kun.autoPlanBuild.intents.v1'
export const MAX_AUTO_PLAN_BUILD_INTENTS = 100

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function reasoning(value: unknown): ScheduleReasoningEffort | null {
  return value === 'auto' || value === 'off' || value === 'low' ||
    value === 'medium' || value === 'high' || value === 'max'
    ? value
    : null
}

function scheduledSelection(value: unknown): AutoPlanScheduledSelection | undefined {
  if (!record(value) || !record(value.schedule)) return undefined
  const providerId = text(value.providerId)
  const model = text(value.model)
  const effort = reasoning(value.reasoningEffort)
  const atTime = text(value.schedule.atTime)
  const timeZone = text(value.schedule.timeZone)
  if (!providerId || !model || !effort || value.schedule.kind !== 'at' || !atTime || !timeZone) {
    return undefined
  }
  return {
    providerId,
    model,
    reasoningEffort: effort,
    schedule: { kind: 'at', atTime, timeZone }
  }
}

export function normalizeAutoPlanBuildIntent(value: unknown): AutoPlanBuildIntentV1 | null {
  if (!record(value) || value.version !== 1) return null
  const id = text(value.id)
  const planId = text(value.planId)
  const relativePath = text(value.relativePath)
  const workspaceRoot = text(value.workspaceRoot)
  const planClientRequestId = text(value.planClientRequestId)
  const buildClientRequestId = text(value.buildClientRequestId)
  const createdAt = text(value.createdAt)
  const updatedAt = text(value.updatedAt)
  const buildMode = value.buildMode === 'scheduled' ? 'scheduled' : value.buildMode === 'direct' ? 'direct' : null
  const status = value.status === 'planning' || value.status === 'dispatching' || value.status === 'needs_attention'
    ? value.status
    : null
  const scheduled = scheduledSelection(value.scheduled)
  if (!id || !planId || !relativePath || !workspaceRoot || !planClientRequestId ||
    !buildClientRequestId || !createdAt || !updatedAt || !buildMode || !status ||
    (buildMode === 'scheduled' && !scheduled)) return null
  return {
    version: 1,
    id,
    planId,
    relativePath,
    workspaceRoot,
    threadId: text(value.threadId),
    planTurnId: text(value.planTurnId),
    planClientRequestId,
    buildClientRequestId,
    requestFingerprint: text(value.requestFingerprint),
    buildMode,
    useWorktree: value.useWorktree === true,
    ...(scheduled ? { scheduled } : {}),
    status,
    error: typeof value.error === 'string' ? value.error : '',
    createdAt,
    updatedAt
  }
}

export function normalizeAutoPlanBuildRegistry(value: unknown): RegistryV1 {
  if (!record(value) || value.version !== 1 || !record(value.intents)) {
    return { version: 1, intents: {} }
  }
  const entries = Object.values(value.intents)
    .map(normalizeAutoPlanBuildIntent)
    .filter((intent): intent is AutoPlanBuildIntentV1 => Boolean(intent))
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
    .slice(-MAX_AUTO_PLAN_BUILD_INTENTS)
  return { version: 1, intents: Object.fromEntries(entries.map((intent) => [intent.id, intent])) }
}

function readRegistry(): RegistryV1 {
  const storage = browserStorage()
  if (!storage) return { version: 1, intents: {} }
  try {
    const raw = storage.getItem(STORAGE_KEY)
    return raw ? normalizeAutoPlanBuildRegistry(JSON.parse(raw)) : { version: 1, intents: {} }
  } catch {
    return { version: 1, intents: {} }
  }
}

function writeRegistry(registry: RegistryV1): boolean {
  try {
    const storage = browserStorage()
    if (!storage) return false
    storage.setItem(STORAGE_KEY, JSON.stringify(normalizeAutoPlanBuildRegistry(registry)))
    return true
  } catch {
    // A storage failure must not broaden execution; the caller keeps the draft.
    return false
  }
}

function requestId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
}

export function listAutoPlanBuildIntents(): AutoPlanBuildIntentV1[] {
  return Object.values(readRegistry().intents).sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

export function activeAutoPlanBuildIntent(threadId: string): AutoPlanBuildIntentV1 | null {
  const normalized = threadId.trim()
  return listAutoPlanBuildIntents().find((intent) => intent.threadId === normalized) ?? null
}

/**
 * True when a turn completion is the intermediate plan turn of an Automatic
 * plan-and-build flow rather than the final user-facing outcome. The intent
 * registry persists the exact admitted `planTurnId`; matching on it (rather
 * than the thread alone) keeps the final build turn and ordinary turns from
 * being treated as "still waiting for the build to start".
 */
export function isAutoPlanIntermediatePlanCompletion(
  threadId: string | null | undefined,
  turnId: string | null | undefined
): boolean {
  const normalizedThread = threadId?.trim() ?? ''
  if (!normalizedThread) return false
  const normalizedTurn = turnId?.trim() ?? ''
  return listAutoPlanBuildIntents().some((intent) => {
    if (intent.threadId !== normalizedThread) return false
    // A plan that already needs attention must never be silently hidden as
    // an "in progress" handoff.
    if (intent.status === 'needs_attention') return false
    if (intent.planTurnId) return intent.planTurnId === normalizedTurn
    // Legacy intents persisted before plan-turn identity existed match by
    // thread only while still dispatchable; they are removed as soon as the
    // plan result is matched, so the final build turn is never caught here.
    return true
  })
}

export function createAutoPlanBuildIntent(input: {
  planId: string
  relativePath: string
  workspaceRoot: string
  threadId?: string | null
  requestText?: string
  selection: AutoPlanBuildSelection
  now?: number
}): AutoPlanBuildIntentV1 {
  const timestamp = new Date(input.now ?? Date.now()).toISOString()
  const id = requestId('auto-plan')
  return {
    version: 1,
    id,
    planId: input.planId,
    relativePath: input.relativePath,
    workspaceRoot: input.workspaceRoot,
    threadId: input.threadId?.trim() ?? '',
    planTurnId: '',
    planClientRequestId: requestId('auto-plan-turn'),
    buildClientRequestId: requestId('auto-build-turn'),
    requestFingerprint: autoPlanBuildRequestFingerprint(input.requestText ?? ''),
    buildMode: input.selection.buildMode,
    useWorktree: input.selection.useWorktree,
    ...(input.selection.scheduled ? { scheduled: input.selection.scheduled } : {}),
    status: 'planning',
    error: '',
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

export function autoPlanBuildRequestFingerprint(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `v1:${value.length}:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function saveAutoPlanBuildIntent(intent: AutoPlanBuildIntentV1): boolean {
  const registry = readRegistry()
  registry.intents[intent.id] = intent
  return writeRegistry(registry)
}

export function patchAutoPlanBuildIntent(
  id: string,
  patch: Partial<Pick<AutoPlanBuildIntentV1, 'threadId' | 'planTurnId' | 'status' | 'error'>>
): AutoPlanBuildIntentV1 | null {
  const registry = readRegistry()
  const current = registry.intents[id]
  if (!current) return null
  const next = normalizeAutoPlanBuildIntent({
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  })
  if (!next) return null
  registry.intents[id] = next
  return writeRegistry(registry) ? next : null
}

export function removeAutoPlanBuildIntent(id: string): void {
  const registry = readRegistry()
  delete registry.intents[id]
  writeRegistry(registry)
}

export function clearAutoPlanBuildIntents(): void {
  writeRegistry({ version: 1, intents: {} })
}

export function resetAutoPlanBuildIntentsForTests(): void {
  clearAutoPlanBuildIntents()
}
