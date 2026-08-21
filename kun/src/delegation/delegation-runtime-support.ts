import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  ModelReasoningEffort,
  SubagentProfileConfig,
  SubagentToolPolicy,
  type SubagentMode
} from '../contracts/capabilities.js'
import {
  ApprovalPolicySchema,
  ApprovalReviewerSchema,
  DEFAULT_APPROVAL_REVIEWER,
  SandboxModeSchema,
  type ApprovalPolicy,
  type ApprovalReviewer,
  type SandboxMode
} from '../contracts/policy.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { UsageSnapshot } from '../contracts/usage.js'
import type { TurnClientSurface } from '../contracts/turns.js'
import {
  ChildRunActivity,
  type ChildRunActivity as ChildRunActivityValue,
  type RuntimeEvent
} from '../contracts/events.js'
import type { EventBus } from '../ports/event-bus.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { TurnService } from '../services/turn-service.js'
import type { PptWorkflowScope } from '../ports/tool-host.js'
import { loadWorkspaceAgentProfiles } from './workspace-agents.js'
import type { SubagentRoutingDocument } from './subagent-router.js'
import { BUILTIN_SUBAGENT_PROFILES } from './builtin-profiles.js'
import { BUILTIN_AGENT_CATALOG_BY_ID } from './builtin-agent-catalog.js'
import { resolveTurnClientSurface } from '../loop/turn-context-resolver.js'
import { AtomicJsonFile, isManagerAtomicJsonPath } from '../extensions/atomic-json.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'
import {
  ChildSecuritySnapshot,
  ChildRunRecord,
  type ChildRunAggregate,
  type ChildRunExecutor,
  type ChildRunLifecycleMetadata,
  type ChildReturnFormat
} from './delegation-runtime-contracts.js'
import type { MaterializedChildResult } from './child-result-materializer.js'
import { hasResumableChildSnapshot } from './delegation-proactive-retry.js'

export function childPptWorkflowSnapshot(scope: PptWorkflowScope): {
  workflowId: string
  stage: 'direction' | 'review' | 'build'
  previewMode: 'image-first' | 'editable'
  directionGate?: NonNullable<PptWorkflowScope['directionGate']>
} {
  const stage = scope.stage ?? (
    scope.action === 'approve_and_build'
      ? 'build'
      : scope.action === 'revise_directions' || scope.directionGate?.required === true
        ? 'direction'
        : 'review'
  )
  return {
    workflowId: scope.workflowId,
    stage,
    previewMode: scope.previewMode,
    ...(scope.directionGate ? { directionGate: scope.directionGate } : {})
  }
}


export function resolveChildModelSelection(input: {
  explicitModel?: string
  explicitProviderId?: string
  profileModel?: string
  profileProviderId?: string
  inheritedModel?: string
  inheritedProviderId?: string
}): { model?: string; providerId?: string } {
  return (
    completeModelProviderPair('explicit child override', input.explicitModel, input.explicitProviderId) ??
    completeModelProviderPair('subagent profile', input.profileModel, input.profileProviderId) ??
    completeModelProviderPair(
      'inherited parent selection',
      input.inheritedModel,
      input.inheritedProviderId,
      { allowDefaultProvider: true }
    ) ??
    {}
  )
}

export function sameModelRoute(
  selected: { model?: string; providerId?: string },
  inheritedModel: string | undefined,
  inheritedProviderId: string | undefined
): boolean {
  return (
    selected.model === inheritedModel?.trim() &&
    (selected.providerId ?? '') === (inheritedProviderId?.trim() ?? '')
  )
}

export function completeModelProviderPair(
  source: string,
  rawModel: string | undefined,
  rawProviderId: string | undefined,
  options: { allowDefaultProvider?: boolean } = {}
): { model: string; providerId?: string } | undefined {
  const model = rawModel?.trim()
  const providerId = rawProviderId?.trim()
  if (!model && !providerId) return undefined
  // A normal parent turn on the runtime's default provider has an effective
  // model but no explicit providerId. Preserve that selection as one source;
  // absence here means "runtime default", not a field to fill from elsewhere.
  if (model && !providerId && options.allowDefaultProvider) return { model }
  if (!model || !providerId) {
    const missing = model ? 'providerId' : 'model'
    throw new Error(
      `${source} must configure model and providerId together; missing ${missing}`
    )
  }
  return { model, providerId }
}

export function toUsageSnapshot(usage: ChildRunRecord['usage']): UsageSnapshot {
  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    cachedTokens: usage.cachedTokens,
    cacheHitTokens: usage.cacheHitTokens,
    cacheMissTokens: usage.cacheMissTokens,
    cacheHitRate: usage.cacheHitRate ?? null,
    turns: usage.turns ?? 0,
    costUsd: usage.costUsd,
    costCny: usage.costCny,
    cacheSavingsUsd: usage.cacheSavingsUsd,
    cacheSavingsCny: usage.cacheSavingsCny,
    tokenEconomySavingsTokens: usage.tokenEconomySavingsTokens,
    tokenEconomySavingsUsd: usage.tokenEconomySavingsUsd,
    tokenEconomySavingsCny: usage.tokenEconomySavingsCny
  }
}

export function aggregateChildRuns(records: readonly ChildRunRecord[]): ChildRunAggregate[] {
  const buckets = new Map<string, ChildRunAggregate>()
  for (const record of records) {
    const label = record.label?.trim() || undefined
    const model = record.model?.trim() || undefined
    const key = `${label ?? 'unlabeled'}:${model ?? 'default'}`
    const bucket = buckets.get(key) ?? {
      key,
      ...(label ? { label } : {}),
      ...(model ? { model } : {}),
      runs: 0,
      completed: 0,
      failed: 0,
      aborted: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      averageTotalTokens: 0
    }
    bucket.runs += 1
    if (record.status === 'completed') bucket.completed += 1
    else if (record.status === 'failed') bucket.failed += 1
    else if (record.status === 'aborted') bucket.aborted += 1
    bucket.promptTokens += record.usage.promptTokens
    bucket.completionTokens += record.usage.completionTokens
    bucket.totalTokens += record.usage.totalTokens
    if (record.usage.costUsd !== undefined) bucket.costUsd = (bucket.costUsd ?? 0) + record.usage.costUsd
    if (record.usage.costCny !== undefined) bucket.costCny = (bucket.costCny ?? 0) + record.usage.costCny
    bucket.averageTotalTokens = bucket.runs > 0 ? bucket.totalTokens / bucket.runs : 0
    bucket.averageCostUsd = bucket.costUsd !== undefined && bucket.runs > 0 ? bucket.costUsd / bucket.runs : undefined
    bucket.averageCostCny = bucket.costCny !== undefined && bucket.runs > 0 ? bucket.costCny / bucket.runs : undefined
    buckets.set(key, bucket)
  }
  return [...buckets.values()].sort((a, b) =>
    b.runs - a.runs ||
    b.totalTokens - a.totalTokens ||
    a.key.localeCompare(b.key)
  )
}

export async function executeWithParentSignal<T>(
  parentSignal: AbortSignal,
  execute: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  if (parentSignal.aborted) throw new Error('child run aborted')
  return execute(parentSignal)
}

export const USER_INITIATED_CHILD_ABORT_REASON = 'kun:user-stop'

export function abortChildForUser(controller: AbortController): void {
  controller.abort(USER_INITIATED_CHILD_ABORT_REASON)
}

export function isUserInitiatedChildAbort(signal: AbortSignal): boolean {
  return signal.aborted && signal.reason === USER_INITIATED_CHILD_ABORT_REASON
}

export function childAbortOutcome(
  signal: AbortSignal,
  runtimeRestart: boolean,
  error: unknown
): { terminationReason: 'user_stop' | 'manual_stop' | 'runtime_restart'; error: string } {
  const userStop = isUserInitiatedChildAbort(signal)
  return {
    terminationReason: runtimeRestart ? 'runtime_restart' : userStop ? 'user_stop' : 'manual_stop',
    error: userStop ? 'Subagent was stopped by the user.' : errorMessage(error)
  }
}

export function childContractError(
  returnFormat: ChildReturnFormat,
  evidence: string[] | undefined
): string | undefined {
  if (returnFormat === 'evidence' && !evidence?.some((item) => item.trim().length > 0)) {
    return 'child contract requires evidence but none was returned'
  }
  return undefined
}

export function buildFailedChildRecord(
  current: ChildRunRecord,
  input: {
    signal: AbortSignal
    runtimeRestart: boolean
    abort: ReturnType<typeof childAbortOutcome>
    parentTurnId: string
    childId: string
    startedAt: string
    finishedAt: string
    childResult?: MaterializedChildResult
    usage?: ChildRunRecord['usage']
    toolInvocations?: number
    failure?: import('../contracts/subagent-retry.js').ChildRunFailure
    previewChars: number
  }
): ChildRunRecord {
  const childResult = input.childResult
  const ownedDirectionBundle = ownedPptChildBundle(childResult?.directionBundle, input.childId)
    ? childResult?.directionBundle
    : undefined
  const ownedReviewBundle = ownedPptChildBundle(childResult?.reviewBundle, input.childId)
    ? childResult?.reviewBundle
    : undefined
  return ChildRunRecord.parse({
    ...current,
    status: input.runtimeRestart ? 'failed' : input.signal.aborted ? 'aborted' : 'failed',
    terminationReason: input.signal.aborted || input.runtimeRestart
      ? input.abort.terminationReason
      : 'child_error',
    resumable: hasResumableChildSnapshot(current),
    failure: input.failure,
    ...(childResult ? {
      summary: childResult.summary,
      summaryTruncated: childResult.summaryTruncated,
      resultRef: childResult.resultRef,
      resultUnavailableReason: childResult.resultUnavailableReason
    } : {}),
    ...(ownedDirectionBundle !== undefined ? {
      directionBundle: ownedDirectionBundle,
      directionBundleParentTurnId: input.parentTurnId
    } : {}),
    ...(ownedReviewBundle !== undefined ? {
      reviewBundle: ownedReviewBundle,
      reviewBundleParentTurnId: input.parentTurnId
    } : {}),
    ...(childResult?.deckArtifact !== undefined ? {
      deckArtifact: childResult.deckArtifact,
      deckArtifactParentTurnId: input.parentTurnId
    } : {}),
    ...(childResult?.evidencePack !== undefined ? { evidencePack: childResult.evidencePack } : {}),
    // Failed/aborted children keep the usage they accrued before failure
    // (issue #1155); a child that never reached a model request reports zero.
    ...(input.usage !== undefined ? { usage: input.usage } : {}),
    ...(input.toolInvocations !== undefined ? { toolInvocations: input.toolInvocations } : {}),
    error: input.abort.error.slice(0, input.previewChars),
    durationMs: (current.durationMs ?? 0) + Math.max(0, Date.parse(input.finishedAt) - Date.parse(input.startedAt)),
    updatedAt: input.finishedAt
  })
}

function ownedPptChildBundle(value: unknown, childId: string): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    (value as Record<string, unknown>).childId === childId
}

export function fingerprintProfile(profile: SubagentProfileConfig): string {
  return createHash('sha256')
    .update(JSON.stringify(profile, Object.keys(profile).sort()))
    .digest('hex')
}

export async function notifyLifecycle(
  callback: ((childId: string, profile?: string, metadata?: ChildRunLifecycleMetadata) => Promise<void> | void) | undefined,
  record: ChildRunRecord
): Promise<void> {
  try {
    await callback?.(record.id, record.profile, childLifecycleMetadata(record))
  } catch {
    // Lifecycle updates are observational; persisted child state remains the
    // authority and a renderer disconnect must not consume a scheduler slot.
  }
}

export function childLifecycleMetadata(record: ChildRunRecord): ChildRunLifecycleMetadata {
  return {
    ...(record.model ? { model: record.model } : {}),
    ...(record.providerId ? { providerId: record.providerId } : {}),
    ...(record.accountId ? { accountId: record.accountId } : {}),
    ...(record.reasoningEffort ? { reasoningEffort: record.reasoningEffort } : {}),
    ...(record.profile ? { profile: record.profile } : {}),
    ...(record.profileSnapshot?.name ? { profileName: record.profileSnapshot.name } : {})
  }
}

export function normalizeInheritedReasoningEffort(value: string | undefined): z.infer<typeof ModelReasoningEffort> {
  const parsed = ModelReasoningEffort.safeParse(value?.trim().toLowerCase())
  return parsed.success ? parsed.data : 'auto'
}

export function formatDetachedChildDisplayText(record: ChildRunRecord): string {
  const label = record.label?.trim() || record.profile?.trim() || record.id
  if (record.terminationReason === 'user_stop') {
    return `Background subagent ${label} was stopped by the user`
  }
  return `Background subagent ${label} ${record.status}`
}

export function childActivityFromEvent(
  event: RuntimeEvent,
  previous?: ChildRunActivityValue
): ChildRunActivityValue | undefined {
  let phase: ChildRunActivityValue['phase'] | undefined
  let label: string | undefined
  let toolName: string | undefined
  switch (event.kind) {
    case 'turn_started':
      phase = 'starting'
      label = 'Waiting for model'
      break
    case 'assistant_reasoning_delta':
      phase = 'thinking'
      label = 'Thinking'
      break
    case 'assistant_text_delta':
      phase = 'responding'
      label = 'Writing response'
      break
    case 'tool_call_started':
      if (event.item.kind !== 'tool_call') break
      phase = 'tool'
      toolName = event.item.toolName
      label = event.item.summary?.trim() || `Running ${event.item.toolName}`
      break
    case 'tool_call_finished':
      phase = 'starting'
      label = 'Processing tool result'
      break
    case 'model_request_retry':
      phase = 'retrying'
      label = `Retrying model request ${event.attempt}/${event.maxAttempts}`
      break
    case 'tool_result_upload_wait':
      phase = 'waiting'
      label = 'Waiting for tool results'
      break
    case 'compaction_started':
      phase = 'compacting'
      label = event.summary?.trim() || 'Compacting context'
      break
    case 'compaction_completed':
      phase = 'starting'
      label = 'Continuing'
      break
    case 'approval_requested':
      phase = 'waiting'
      toolName = event.toolName
      label = 'Waiting for approval'
      break
    case 'pipeline_stage':
      if (event.stage !== 'pre_send') break
      phase = 'starting'
      label = event.label?.trim() || 'Calling model'
      break
    case 'item_created':
    case 'item_updated':
    case 'item_completed':
      if (event.item.kind === 'assistant_reasoning' && event.item.status === 'running') {
        phase = 'thinking'
        label = 'Thinking'
      } else if (event.item.kind === 'assistant_text' && event.item.status === 'running') {
        phase = 'responding'
        label = 'Writing response'
      } else if (event.item.kind === 'tool_call' && event.item.status === 'running') {
        phase = 'tool'
        toolName = event.item.toolName
        label = event.item.summary?.trim() || `Running ${event.item.toolName}`
      }
      break
    default:
      break
  }
  if (!phase || !label) return undefined
  const normalizedLabel = label.replace(/\s+/gu, ' ').trim().slice(0, 500)
  if (!normalizedLabel) return undefined
  if (
    previous?.phase === phase &&
    previous.label === normalizedLabel &&
    previous.toolName === toolName
  ) {
    return undefined
  }
  return ChildRunActivity.parse({
    phase,
    label: normalizedLabel,
    ...(toolName ? { toolName: toolName.slice(0, 256) } : {}),
    startedAt: event.timestamp,
    updatedAt: event.timestamp
  })
}

export function sameChildActivity(
  left: ChildRunActivityValue | undefined,
  right: ChildRunActivityValue
): boolean {
  return left?.phase === right.phase &&
    left.label === right.label &&
    left.toolName === right.toolName &&
    left.startedAt === right.startedAt &&
    left.updatedAt === right.updatedAt
}

export function addChildUsage(
  previous: ChildRunRecord['usage'],
  next: ChildRunRecord['usage'] | undefined
): ChildRunRecord['usage'] {
  if (!next) return previous
  const add = (key: keyof ChildRunRecord['usage']): number | undefined => {
    const left = previous[key]
    const right = next[key]
    return typeof left === 'number' || typeof right === 'number'
      ? (typeof left === 'number' ? left : 0) + (typeof right === 'number' ? right : 0)
      : undefined
  }
  return ChildRunRecord.shape.usage.parse({
    promptTokens: add('promptTokens') ?? 0,
    completionTokens: add('completionTokens') ?? 0,
    totalTokens: add('totalTokens') ?? 0,
    ...(add('cachedTokens') !== undefined ? { cachedTokens: add('cachedTokens') } : {}),
    ...(add('cacheHitTokens') !== undefined ? { cacheHitTokens: add('cacheHitTokens') } : {}),
    ...(add('cacheMissTokens') !== undefined ? { cacheMissTokens: add('cacheMissTokens') } : {}),
    ...(add('turns') !== undefined ? { turns: add('turns') } : {}),
    ...(add('costUsd') !== undefined ? { costUsd: add('costUsd') } : {}),
    ...(add('costCny') !== undefined ? { costCny: add('costCny') } : {}),
    ...(add('cacheSavingsUsd') !== undefined ? { cacheSavingsUsd: add('cacheSavingsUsd') } : {}),
    ...(add('cacheSavingsCny') !== undefined ? { cacheSavingsCny: add('cacheSavingsCny') } : {}),
    ...(add('tokenEconomySavingsTokens') !== undefined ? { tokenEconomySavingsTokens: add('tokenEconomySavingsTokens') } : {}),
    ...(add('tokenEconomySavingsUsd') !== undefined ? { tokenEconomySavingsUsd: add('tokenEconomySavingsUsd') } : {}),
    ...(add('tokenEconomySavingsCny') !== undefined ? { tokenEconomySavingsCny: add('tokenEconomySavingsCny') } : {}),
    cacheHitRate: next.cacheHitRate ?? previous.cacheHitRate
  })
}

export function persistedReviewIdentityError(
  value: unknown,
  childId: string,
  workflowId: string
): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return `child run ${childId} has no persisted PPT review workflow`
  }
  const bundle = value as Record<string, unknown>
  if (bundle.childId !== childId) return `child run ${childId} has a mismatched PPT review owner`
  if (bundle.workflowId !== workflowId) return `child run ${childId} does not own PPT workflow ${workflowId}`
  return ''
}

export function persistedPptWorkflowIdentityError(
  reviewBundle: unknown,
  directionBundle: unknown,
  childId: string,
  workflowId: string,
  persistedWorkflowId?: string
): string {
  if (persistedWorkflowId) {
    return persistedWorkflowId === workflowId
      ? ''
      : `child run ${childId} does not own PPT workflow ${workflowId}`
  }
  const bundles = [reviewBundle, directionBundle].filter((value) =>
    value !== undefined && value !== null)
  if (bundles.length === 0) return `child run ${childId} has no persisted PPT workflow`
  for (const value of bundles) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return `child run ${childId} has an invalid persisted PPT workflow`
    }
    const bundle = value as Record<string, unknown>
    if (bundle.childId !== childId) return `child run ${childId} has a mismatched PPT workflow owner`
    if (bundle.workflowId !== workflowId) return `child run ${childId} does not own PPT workflow ${workflowId}`
  }
  return ''
}

export function subtractChildUsage(
  next: ChildRunRecord['usage'],
  previous: ChildRunRecord['usage']
): ChildRunRecord['usage'] {
  const difference = (key: keyof ChildRunRecord['usage']): number | undefined => {
    const right = next[key]
    const left = previous[key]
    if (typeof right !== 'number' && typeof left !== 'number') return undefined
    return Math.max(0, (typeof right === 'number' ? right : 0) - (typeof left === 'number' ? left : 0))
  }
  return ChildRunRecord.shape.usage.parse({
    promptTokens: difference('promptTokens') ?? 0,
    completionTokens: difference('completionTokens') ?? 0,
    totalTokens: difference('totalTokens') ?? 0,
    ...(difference('cachedTokens') !== undefined ? { cachedTokens: difference('cachedTokens') } : {}),
    ...(difference('cacheHitTokens') !== undefined ? { cacheHitTokens: difference('cacheHitTokens') } : {}),
    ...(difference('cacheMissTokens') !== undefined ? { cacheMissTokens: difference('cacheMissTokens') } : {}),
    ...(difference('turns') !== undefined ? { turns: difference('turns') } : {}),
    ...(difference('costUsd') !== undefined ? { costUsd: difference('costUsd') } : {}),
    ...(difference('costCny') !== undefined ? { costCny: difference('costCny') } : {}),
    ...(difference('cacheSavingsUsd') !== undefined ? { cacheSavingsUsd: difference('cacheSavingsUsd') } : {}),
    ...(difference('cacheSavingsCny') !== undefined ? { cacheSavingsCny: difference('cacheSavingsCny') } : {}),
    ...(difference('tokenEconomySavingsTokens') !== undefined
      ? { tokenEconomySavingsTokens: difference('tokenEconomySavingsTokens') }
      : {}),
    ...(difference('tokenEconomySavingsUsd') !== undefined
      ? { tokenEconomySavingsUsd: difference('tokenEconomySavingsUsd') }
      : {}),
    ...(difference('tokenEconomySavingsCny') !== undefined
      ? { tokenEconomySavingsCny: difference('tokenEconomySavingsCny') }
      : {}),
    cacheHitRate: next.cacheHitRate
  })
}

export function intersectChildSecurity(
  stored: ChildSecuritySnapshot,
  current: ChildSecuritySnapshot
): ChildSecuritySnapshot {
  if (resolve(stored.sandboxRoot) !== resolve(current.sandboxRoot)) {
    throw new Error('resumed child workspace does not match the current parent workspace')
  }
  return ChildSecuritySnapshot.parse({
    sandboxRoot: stored.sandboxRoot,
    ...intersectOptionalList('allowedModelProviderIds', stored, current),
    ...intersectOptionalList('allowedModelIds', stored, current),
    ...intersectOptionalList('allowedProviderIds', stored, current),
    ...intersectOptionalList('allowedToolNames', stored, current),
    ...intersectOptionalList('allowedSkillIds', stored, current),
    ...intersectOptionalPaths('allowedReadPaths', stored, current),
    ...intersectOptionalPaths('allowedWritePaths', stored, current),
    ...intersectOptionalList('allowedArtifactIds', stored, current),
    ...unionOptionalList('blockedProviderIds', stored, current),
    ...unionOptionalList('blockedToolNames', stored, current),
    ...unionOptionalList('blockedSkillIds', stored, current),
    instructionsEnabled:
      stored.instructionsEnabled !== false && current.instructionsEnabled !== false,
    memoryEnabled: stored.memoryEnabled && current.memoryEnabled
  })
}

type SecurityListKey =
  | 'allowedModelProviderIds'
  | 'allowedModelIds'
  | 'allowedProviderIds'
  | 'allowedToolNames'
  | 'allowedSkillIds'
  | 'allowedReadPaths'
  | 'allowedWritePaths'
  | 'allowedArtifactIds'
  | 'blockedProviderIds'
  | 'blockedToolNames'
  | 'blockedSkillIds'

function intersectOptionalList<K extends SecurityListKey>(
  key: K,
  stored: ChildSecuritySnapshot,
  current: ChildSecuritySnapshot
): Partial<Pick<ChildSecuritySnapshot, K>> {
  const left = stored[key] as string[] | undefined
  const right = current[key] as string[] | undefined
  const values = left === undefined
    ? right
    : right === undefined
      ? left
      : left.filter((value) => right.includes(value))
  return values === undefined ? {} : { [key]: [...new Set(values)] } as Partial<Pick<ChildSecuritySnapshot, K>>
}

function unionOptionalList<K extends SecurityListKey>(
  key: K,
  stored: ChildSecuritySnapshot,
  current: ChildSecuritySnapshot
): Partial<Pick<ChildSecuritySnapshot, K>> {
  const left = stored[key] as string[] | undefined
  const right = current[key] as string[] | undefined
  return left === undefined && right === undefined
    ? {}
    : { [key]: [...new Set([...(left ?? []), ...(right ?? [])])] } as Partial<Pick<ChildSecuritySnapshot, K>>
}

function intersectOptionalPaths<K extends 'allowedReadPaths' | 'allowedWritePaths'>(
  key: K,
  stored: ChildSecuritySnapshot,
  current: ChildSecuritySnapshot
): Partial<Pick<ChildSecuritySnapshot, K>> {
  const left = stored[key]
  const right = current[key]
  if (left === undefined) {
    return right === undefined ? {} : { [key]: [...new Set(right)] } as Partial<Pick<ChildSecuritySnapshot, K>>
  }
  if (right === undefined) return { [key]: [...new Set(left)] } as Partial<Pick<ChildSecuritySnapshot, K>>
  const values = left.flatMap((storedPath) => right.flatMap((currentPath) => {
    const storedAbsolute = securityPath(storedPath, stored.sandboxRoot)
    const currentAbsolute = securityPath(currentPath, current.sandboxRoot)
    if (pathContains(storedAbsolute, currentAbsolute)) return [currentPath]
    if (pathContains(currentAbsolute, storedAbsolute)) return [storedPath]
    return []
  }))
  return { [key]: [...new Set(values)] } as Partial<Pick<ChildSecuritySnapshot, K>>
}

function securityPath(path: string, sandboxRoot: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(sandboxRoot, path)
}

function pathContains(parent: string, candidate: string): boolean {
  const outside = relative(parent, candidate)
  return outside === '' || (!outside.startsWith('..') && !isAbsolute(outside))
}

export function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
}

export const defaultExecutor: ChildRunExecutor = async (input) => {
  return { summary: `Child result: ${input.prompt}` }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Non-negative millisecond delta between two ISO timestamps (0 when unparseable). */
export function elapsedMs(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso)
  const to = Date.parse(toIso)
  if (Number.isNaN(from) || Number.isNaN(to)) return 0
  return Math.max(0, to - from)
}
