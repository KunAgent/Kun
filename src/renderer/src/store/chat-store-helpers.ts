import type { NormalizedThread } from '../agent/types'
import { DEFAULT_COMPOSER_MODEL_IDS } from '@shared/default-composer-models'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import {
  CLAW_MODEL_IDS,
  MODEL_REASONING_EFFORTS,
  isComposerChatModelId,
  modelProfileSupportsTextChat,
  type ModelReasoningEffort
} from '@shared/app-settings'
import type { WriteAssistantMessageContext } from './chat-store-types'
import type { WriteTurnContext } from '../agent/write-turn-context'
import {
  isClawWorkspacePath,
  isInternalDeepSeekGuiWorkspace,
  isInternalTemporaryWorkspace,
  normalizeWorkspaceRoot,
  workspaceRootIdentityKey
} from '../lib/workspace-path'
import { shouldOmitFromCodeWorkspaceRoots } from '../lib/worktree-project-path'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'
import {
  loadThreadComposerModeMap,
  loadThreadComposerSelectionMap,
  saveThreadComposerModeMap,
  saveThreadComposerSelectionMap
} from './chat-store-helper-storage'

export { normalizeTurnModelMap } from './chat-store-helper-storage'

/**
 * Map the renderer-only Write routing context to the runtime-persistable
 * reference. `threadId` is intentionally dropped: the turn already owns the
 * thread, and the runtime has no renderer thread registry.
 */
export function toWriteTurnContext(
  context: WriteAssistantMessageContext | undefined
): WriteTurnContext | undefined {
  if (!context) return undefined
  return {
    workspaceRoot: context.workspaceRoot,
    documentPath: context.activeFilePath,
    ...(Number.isInteger(context.documentEpoch) ? { documentEpoch: context.documentEpoch } : {}),
    ...(Number.isInteger(context.contentRevision) ? { contentRevision: context.contentRevision } : {}),
    ...(context.whiteboardId ? { whiteboardId: context.whiteboardId } : {}),
    ...(Number.isInteger(context.whiteboardRevision)
      ? { whiteboardRevision: context.whiteboardRevision }
      : {}),
    ...(context.expectedSha256 ? { expectedSha256: context.expectedSha256 } : {})
  }
}

const COMPOSER_MODEL_STORAGE_KEY = 'kun.composerModel'
const COMPOSER_PROVIDER_STORAGE_KEY = 'kun.composerProviderId'
const COMPOSER_PERSONA_STORAGE_KEY = 'kun.composerPersonaId'
const COMPOSER_REASONING_EFFORT_STORAGE_KEY = 'kun.composerReasoningEffortByModel.v1'
const COMPOSER_FAST_MODE_STORAGE_KEY = 'kun.composerFastMode.v1'
const COMPOSER_MODE_STORAGE_KEY = 'kun.composerMode'
const COMPOSER_ISOLATION_STORAGE_KEY = 'kun.composerIsolation'
const CODE_WORKSPACE_ROOTS_STORAGE_KEY = 'kun.codeWorkspaceRoots.v1'
export const MAX_CODE_WORKSPACE_ROOTS = 30
export const MAX_THREAD_COMPOSER_SELECTIONS = 500
export const MAX_COMPOSER_REASONING_EFFORTS = 500
export const MAX_TURN_MODEL_LABELS = 500
export const DEFAULT_COMPOSER_CONTEXT_WINDOW_TOKENS = 256_000
const LEGACY_COMPOSER_REASONING_EFFORTS: readonly ModelReasoningEffort[] = [
  'off',
  'low',
  'medium',
  'high',
  'max'
]

/** Renderer composer intent. `auto` is translated into plan/agent runtime turns. */
export type ComposerPlanMode = 'plan' | 'agent' | 'auto'

export type ThreadComposerSelection = {
  model: string
  providerId: string
  /** ADE harness pinned for this thread's next turns (12 §7.2). */
  harnessId?: string
  /** Credential path selected with the harness (native-login / kun-gateway …). */
  credentialMode?: string
  source?: 'user' | 'default'
}

export const CLAW_COMPOSER_MODEL_IDS = [...CLAW_MODEL_IDS]

export function readStoredComposerModel(allowedIds: readonly string[]): string {
  const raw = readBrowserStorageItem(COMPOSER_MODEL_STORAGE_KEY)
  if (raw === null) return ''
  if (raw === '') return ''
  if (allowedIds.includes(raw)) return raw
  return ''
}

export function persistComposerModel(model: string): void {
  writeBrowserStorageItem(COMPOSER_MODEL_STORAGE_KEY, model)
}

export function readStoredComposerIsolation(): 'local' | 'worktree' {
  return readBrowserStorageItem(COMPOSER_ISOLATION_STORAGE_KEY) === 'worktree'
    ? 'worktree'
    : 'local'
}

export function persistComposerIsolation(isolation: 'local' | 'worktree'): void {
  writeBrowserStorageItem(COMPOSER_ISOLATION_STORAGE_KEY, isolation)
}

export function readStoredComposerProviderId(
  modelGroups: readonly ModelProviderModelGroup[],
  modelId: string
): string {
  const raw = readBrowserStorageItem(COMPOSER_PROVIDER_STORAGE_KEY)
  const providerId = raw?.trim() ?? ''
  if (!providerId) return ''
  const group = modelGroups.find((item) => item.providerId === providerId)
  if (!group) return ''
  const model = modelId.trim()
  if (!model) return providerId
  return modelGroupHasModel(group, model) ? providerId : ''
}

export function persistComposerProviderId(providerId: string): void {
  const normalized = providerId.trim()
  if (normalized) {
    writeBrowserStorageItem(COMPOSER_PROVIDER_STORAGE_KEY, normalized)
  } else {
    writeBrowserStorageItem(COMPOSER_PROVIDER_STORAGE_KEY, '')
  }
}

export function readStoredComposerReasoningEffort(
  modelId: string,
  providerId = ''
): ModelReasoningEffort {
  const key = composerReasoningEffortStorageKey(modelId, providerId)
  if (!key) return 'max'
  return loadComposerReasoningEffortMap()[key] ?? 'max'
}

export function persistComposerReasoningEffort(
  modelId: string,
  providerId: string,
  effort: ModelReasoningEffort
): void {
  const key = composerReasoningEffortStorageKey(modelId, providerId)
  if (!key || !MODEL_REASONING_EFFORTS.includes(effort)) return
  const map = loadComposerReasoningEffortMap()
  delete map[key]
  map[key] = effort
  writeBrowserStorageItem(
    COMPOSER_REASONING_EFFORT_STORAGE_KEY,
    JSON.stringify(Object.fromEntries(Object.entries(map).slice(-MAX_COMPOSER_REASONING_EFFORTS)))
  )
}

export function readStoredComposerFastMode(): boolean {
  return readBrowserStorageItem(COMPOSER_FAST_MODE_STORAGE_KEY) === 'true'
}

export function persistComposerFastMode(enabled: boolean): void {
  writeBrowserStorageItem(COMPOSER_FAST_MODE_STORAGE_KEY, enabled ? 'true' : 'false')
}

/**
 * The stored id is not validated against the preset catalog here: settings load
 * after the store initializes, and a preset deleted while selected resolves to
 * an empty persona at send time (`resolveCodeAgentPersona`).
 */
export function readStoredComposerPersonaId(): string {
  return readBrowserStorageItem(COMPOSER_PERSONA_STORAGE_KEY)?.trim() ?? ''
}

export function persistComposerPersonaId(presetId: string): void {
  writeBrowserStorageItem(COMPOSER_PERSONA_STORAGE_KEY, presetId.trim())
}

export function composerReasoningEffortForSelection(
  modelGroups: readonly ModelProviderModelGroup[],
  modelId: string,
  providerId = ''
): ModelReasoningEffort {
  const stored = readStoredComposerReasoningEffort(modelId, providerId)
  const profile = modelProfileForComposerSelection(modelGroups, modelId, providerId)
  const resolved = profile?.reasoning
    ? profile.reasoning.supportedEfforts.includes(stored)
      ? stored
      : profile.reasoning.defaultEffort
    : LEGACY_COMPOSER_REASONING_EFFORTS.includes(stored)
      ? stored
      : 'max'
  persistComposerReasoningEffort(modelId, providerId, resolved)
  return resolved
}

export function normalizeComposerReasoningEffortMap(
  raw: unknown
): Record<string, ModelReasoningEffort> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const entries: Array<[string, ModelReasoningEffort]> = []
  for (const [rawKey, rawValue] of Object.entries(raw as Record<string, unknown>)) {
    const key = rawKey.trim()
    if (!key || typeof rawValue !== 'string') continue
    const effort = rawValue.trim().toLowerCase() as ModelReasoningEffort
    if (!MODEL_REASONING_EFFORTS.includes(effort)) continue
    entries.push([key, effort])
  }
  return Object.fromEntries(entries.slice(-MAX_COMPOSER_REASONING_EFFORTS))
}

function composerReasoningEffortStorageKey(modelId: string, providerId: string): string {
  const model = normalizeComposerModelId(modelId)
  if (!model) return ''
  return JSON.stringify([providerId.trim().toLowerCase(), model])
}

function loadComposerReasoningEffortMap(): Record<string, ModelReasoningEffort> {
  try {
    const raw = readBrowserStorageItem(COMPOSER_REASONING_EFFORT_STORAGE_KEY)
    if (!raw) return {}
    return normalizeComposerReasoningEffortMap(JSON.parse(raw))
  } catch {
    return {}
  }
}

export function readThreadComposerSelection(threadId: string): ThreadComposerSelection | null {
  const thread = threadId.trim()
  if (!thread) return null
  return loadThreadComposerSelectionMap()[thread] ?? null
}

export function normalizeComposerPlanMode(raw: unknown): ComposerPlanMode | null {
  if (raw === 'plan' || raw === 'agent' || raw === 'auto') return raw
  return null
}

export function readStoredComposerMode(): ComposerPlanMode {
  const raw = readBrowserStorageItem(COMPOSER_MODE_STORAGE_KEY)
  return normalizeComposerPlanMode(raw) ?? 'agent'
}

export function persistComposerMode(mode: ComposerPlanMode): void {
  writeBrowserStorageItem(COMPOSER_MODE_STORAGE_KEY, mode)
}

export function normalizeThreadComposerModeMap(raw: unknown): Record<string, ComposerPlanMode> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const entries: Array<[string, ComposerPlanMode]> = []
  for (const [rawKey, rawValue] of Object.entries(raw as Record<string, unknown>)) {
    const key = rawKey.trim()
    const mode = normalizeComposerPlanMode(rawValue)
    if (!key || !mode) continue
    entries.push([key, mode])
  }
  return Object.fromEntries(entries.slice(-MAX_THREAD_COMPOSER_SELECTIONS))
}

export function readThreadComposerMode(threadId: string): ComposerPlanMode | null {
  const thread = threadId.trim()
  if (!thread) return null
  return loadThreadComposerModeMap()[thread] ?? null
}

export function rememberThreadComposerMode(threadId: string, mode: ComposerPlanMode): void {
  const thread = threadId.trim()
  if (!thread) return
  const map = loadThreadComposerModeMap()
  delete map[thread]
  map[thread] = mode
  saveThreadComposerModeMap(map)
}

export function composerModeForThread(
  thread: Pick<NormalizedThread, 'id' | 'mode'> | null | undefined,
  storedMode: ComposerPlanMode | null
): ComposerPlanMode {
  if (storedMode) return storedMode
  if (thread?.mode.trim() === 'plan') return 'plan'
  return 'agent'
}

export function rememberThreadComposerSelection(
  threadId: string,
  model: string,
  providerId = '',
  source: NonNullable<ThreadComposerSelection['source']> = 'user',
  harness?: { harnessId?: string; credentialMode?: string }
): void {
  const thread = threadId.trim()
  const nextModel = model.trim()
  if (!thread || !nextModel) return
  const map = loadThreadComposerSelectionMap()
  delete map[thread]
  map[thread] = {
    model: nextModel,
    providerId: providerId.trim(),
    ...(harness?.harnessId?.trim() ? { harnessId: harness.harnessId.trim() } : {}),
    ...(harness?.credentialMode?.trim() ? { credentialMode: harness.credentialMode.trim() } : {}),
    source
  }
  saveThreadComposerSelectionMap(map)
}

/** Harness-only update preserving the stored model/provider selection. */
export function rememberThreadComposerHarness(
  threadId: string,
  harnessId: string,
  credentialMode?: string
): void {
  const thread = threadId.trim()
  if (!thread) return
  const map = loadThreadComposerSelectionMap()
  const existing = map[thread] ?? { model: '', providerId: '' }
  delete map[thread]
  map[thread] = {
    ...existing,
    harnessId: harnessId.trim(),
    ...(credentialMode?.trim() ? { credentialMode: credentialMode.trim() } : {})
  }
  saveThreadComposerSelectionMap(map)
}

export function normalizeThreadComposerSelectionMap(raw: unknown): Record<string, ThreadComposerSelection> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const entries: Array<[string, ThreadComposerSelection]> = []
  for (const [rawKey, rawValue] of Object.entries(raw as Record<string, unknown>)) {
    const key = rawKey.trim()
    if (!key || !rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) continue
    const value = rawValue as Record<string, unknown>
    const model = typeof value.model === 'string' ? value.model.trim() : ''
    const providerId = typeof value.providerId === 'string' ? value.providerId.trim() : ''
    const harnessId = typeof value.harnessId === 'string' ? value.harnessId.trim() : ''
    const credentialMode = typeof value.credentialMode === 'string' ? value.credentialMode.trim() : ''
    const source = value.source === 'user' || value.source === 'default'
      ? value.source
      : undefined
    // Harness-only entries are legal for ADE threads whose model rides the
    // harness's own catalog rather than the provider pick list.
    if (!model && !harnessId) continue
    entries.push([key, {
      model,
      providerId,
      ...(harnessId ? { harnessId } : {}),
      ...(credentialMode ? { credentialMode } : {}),
      ...(source ? { source } : {})
    }])
  }
  return Object.fromEntries(entries.slice(-MAX_THREAD_COMPOSER_SELECTIONS))
}

export function providerIdForComposerModel(
  modelGroups: readonly ModelProviderModelGroup[],
  modelId: string
): string {
  const model = modelId.trim()
  if (!model) return ''
  return modelGroups.find((group) => modelGroupHasModel(group, model))?.providerId ?? ''
}

export function accountIdForComposerSelection(
  modelGroups: readonly ModelProviderModelGroup[] | undefined,
  providerId: string,
  modelId: string
): string {
  const provider = providerId.trim()
  const model = modelId.trim()
  if (!provider || !model) return ''
  const group = modelGroups?.find((candidate) => candidate.providerId === provider)
  if (!group || !modelGroupHasModel(group, model)) return ''
  return group.accountId?.trim() ?? ''
}

export function resolveComposerContextWindowTokens(
  modelGroups: readonly ModelProviderModelGroup[],
  modelId: string,
  providerId: string
): number | undefined {
  if (!modelId.trim()) return undefined
  const profile = modelProfileForComposerSelection(modelGroups, modelId, providerId)
  if (typeof profile?.contextWindowTokens === 'number' && profile.contextWindowTokens > 0) {
    return profile.contextWindowTokens
  }
  return DEFAULT_COMPOSER_CONTEXT_WINDOW_TOKENS
}

function modelProfileForComposerSelection(
  modelGroups: readonly ModelProviderModelGroup[],
  modelId: string,
  providerId: string
): ReturnType<typeof modelProfileForComposerModel> {
  const selectedProviderId = providerId.trim()
  const selectedGroup = selectedProviderId
    ? modelGroups.find((group) => group.providerId === selectedProviderId)
    : undefined
  if (selectedGroup && modelGroupHasModel(selectedGroup, modelId)) {
    return modelProfileForComposerModel(selectedGroup, modelId)
  }
  for (const group of modelGroups) {
    if (!modelGroupHasModel(group, modelId)) continue
    const profile = modelProfileForComposerModel(group, modelId)
    if (profile) return profile
  }
  return undefined
}

function modelGroupHasModel(group: ModelProviderModelGroup, modelId: string): boolean {
  const normalized = normalizeComposerModelId(modelId)
  if (!normalized) return false
  return group.modelIds.some((id) => normalizeComposerModelId(id) === normalized) ||
    Boolean(modelProfileForComposerModel(group, modelId)?.aliases?.some(
      (alias: string) => normalizeComposerModelId(alias) === normalized
    ))
}

export function composerModelAllowed(pickList: readonly string[], modelId: string): boolean {
  const normalized = normalizeComposerModelId(modelId)
  if (!normalized) return false
  return pickList.some((id) => normalizeComposerModelId(id) === normalized)
}

export function composerModelSelectable(
  pickList: readonly string[],
  modelGroups: readonly ModelProviderModelGroup[],
  modelId: string,
  providerId = ''
): boolean {
  if (!composerModelAllowed(pickList, modelId)) return false
  if (!isComposerChatModelId(modelId)) return false
  const provider = providerId.trim()
  const group = provider
    ? modelGroups.find((item) => item.providerId === provider && modelGroupHasModel(item, modelId))
    : modelGroups.find((item) => modelGroupHasModel(item, modelId))
  if (provider && !group) return false
  if (!group) return true
  return modelProfileSupportsTextChat(modelProfileForComposerModel(group, modelId))
}

export function providerIdMatchesComposerModel(
  modelGroups: readonly ModelProviderModelGroup[],
  providerId: string,
  modelId: string
): boolean {
  const provider = providerId.trim()
  if (!provider) return false
  const group = modelGroups.find((item) => item.providerId === provider)
  return group ? modelGroupHasModel(group, modelId) : false
}

function modelProfileForComposerModel(
  group: Pick<ModelProviderModelGroup, 'modelProfiles'>,
  modelId: string
): NonNullable<ModelProviderModelGroup['modelProfiles']>[string] | undefined {
  const model = modelId.trim()
  const key = normalizeComposerModelId(model)
  if (!key) return undefined
  const profiles = group.modelProfiles ?? {}
  const direct = profiles[key] ?? profiles[model]
  if (direct) return direct
  return Object.values(profiles).find((profile) =>
    profile.aliases?.some((alias) => normalizeComposerModelId(alias) === key)
  )
}

function normalizeComposerModelId(modelId: string): string {
  return modelId.trim().toLowerCase()
}

export function compactCodeWorkspaceRoots(workspaceRoots: readonly (string | undefined | null)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const workspaceRoot of workspaceRoots) {
    const normalized = normalizeWorkspaceRoot(workspaceRoot ?? '').replace(/[\\/]+$/, '')
    if (!normalized) continue
    if (isInternalTemporaryWorkspace(normalized)) continue
    if (isInternalDeepSeekGuiWorkspace(normalized)) continue
    if (isClawWorkspacePath(normalized)) continue
    if (shouldOmitFromCodeWorkspaceRoots(normalized)) continue
    const key = workspaceRootIdentityKey(normalized)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(normalized)
  }
  return out.slice(0, MAX_CODE_WORKSPACE_ROOTS)
}

function workspaceIdentityKeySet(workspaceRoots: readonly (string | undefined | null)[]): Set<string> {
  const keys = new Set<string>()
  for (const workspaceRoot of workspaceRoots) {
    const key = workspaceRootIdentityKey(normalizeWorkspaceRoot(workspaceRoot ?? ''))
    if (key) keys.add(key)
  }
  return keys
}

export function reconcileCodeWorkspaceRoots(options: {
  currentRoots: readonly (string | undefined | null)[]
  codeThreadWorkspaceRoots: readonly (string | undefined | null)[]
  writeWorkspaceRoots: readonly (string | undefined | null)[]
  preservedWorkspaceRoots?: readonly (string | undefined | null)[]
}): string[] {
  const writeKeys = workspaceIdentityKeySet(options.writeWorkspaceRoots)
  if (writeKeys.size === 0) {
    return compactCodeWorkspaceRoots([
      ...options.codeThreadWorkspaceRoots,
      ...options.currentRoots,
      ...(options.preservedWorkspaceRoots ?? [])
    ])
  }

  const codeThreadKeys = workspaceIdentityKeySet(options.codeThreadWorkspaceRoots)
  const preservedKeys = workspaceIdentityKeySet(options.preservedWorkspaceRoots ?? [])
  const retainedCurrentRoots = options.currentRoots.filter((workspaceRoot) => {
    const key = workspaceRootIdentityKey(normalizeWorkspaceRoot(workspaceRoot ?? ''))
    if (!key) return false
    if (!writeKeys.has(key)) return true
    return codeThreadKeys.has(key) || preservedKeys.has(key)
  })

  return compactCodeWorkspaceRoots([
    ...options.codeThreadWorkspaceRoots,
    ...retainedCurrentRoots,
    ...(options.preservedWorkspaceRoots ?? [])
  ])
}

export function readCodeWorkspaceRoots(): string[] {
  try {
    const raw = readBrowserStorageItem(CODE_WORKSPACE_ROOTS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return compactCodeWorkspaceRoots(parsed.filter((item): item is string => typeof item === 'string'))
  } catch {
    return []
  }
}

export function saveCodeWorkspaceRoots(workspaceRoots: readonly string[]): void {
  writeBrowserStorageItem(
    CODE_WORKSPACE_ROOTS_STORAGE_KEY,
    JSON.stringify(compactCodeWorkspaceRoots(workspaceRoots))
  )
}

export function rememberCodeWorkspaceRoots(
  currentRoots: readonly string[],
  workspaceRoots: readonly (string | undefined | null)[]
): string[] {
  const next = compactCodeWorkspaceRoots([...workspaceRoots, ...currentRoots])
  saveCodeWorkspaceRoots(next)
  return next
}

export function forgetCodeWorkspaceRoot(
  currentRoots: readonly string[],
  workspaceRoot: string
): string[] {
  const normalized = normalizeWorkspaceRoot(workspaceRoot)
  const key = workspaceRootIdentityKey(normalized)
  const next = compactCodeWorkspaceRoots(
    currentRoots.filter((root) => workspaceRootIdentityKey(normalizeWorkspaceRoot(root)) !== key)
  )
  saveCodeWorkspaceRoots(next)
  return next
}

export function mergeComposerPickList(upstreamOk: boolean, upstreamIds: string[]): string[] {
  const ordered = new Set<string>()
  for (const id of DEFAULT_COMPOSER_MODEL_IDS) {
    ordered.add(id)
  }
  if (upstreamOk) {
    for (const id of upstreamIds) {
      const trimmed = id.trim()
      if (trimmed && trimmed !== 'auto') ordered.add(trimmed)
    }
  }
  return [...ordered].sort((a, b) => a.localeCompare(b))
}

export function fallbackComposerModel(
  pickList: readonly string[],
  runtimeDefault: string,
  modelGroups: readonly ModelProviderModelGroup[] = []
): string {
  const allowed = new Set(pickList)
  const preferred = runtimeDefault.trim()
  if (preferred && preferred.toLowerCase() !== 'auto' && allowed.has(preferred)) return preferred
  const firstProviderModel = firstSelectableProviderModel(pickList, modelGroups)
  if (firstProviderModel) return firstProviderModel
  return DEFAULT_COMPOSER_MODEL_IDS.find((id) => allowed.has(id)) ?? pickList[0] ?? ''
}

function firstSelectableProviderModel(
  pickList: readonly string[],
  modelGroups: readonly ModelProviderModelGroup[]
): string {
  for (const group of modelGroups) {
    for (const modelId of group.modelIds) {
      const model = modelId.trim()
      if (model && composerModelSelectable(pickList, modelGroups, model)) return model
    }
  }
  return ''
}

export {
  newClawChannel,
  normalizeClawComposerModel,
  activeClawChannel,
  clawThreadIdsFromChannels,
  clawThreadTitleLooksManaged,
  isClawThread,
  optimisticUserModelLabel,
  rememberTurnModel,
  hydrateBlockModelLabels
} from './chat-store-helper-claw'
