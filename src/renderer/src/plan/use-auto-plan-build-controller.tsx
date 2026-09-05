import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { AppSettingsV1 } from '@shared/app-settings'
import { DEFAULT_GIT_BRANCH_PREFIX } from '@shared/app-settings'
import type { ChatBlock } from '../agent/types'
import { getProvider } from '../agent/registry'
import { loadThreadStates } from '../agent/thread-state-loader'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { useChatStore } from '../store/chat-store'
import type { SendMessageOverrides } from '../store/chat-store-types'
import { clearUnreadCompletion } from '../store/unread-completions'
import { runAutomaticSubmitLifecycle } from './auto-plan-build-submit-lifecycle'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import { getRuntimeErrorCode } from '../lib/format-runtime-error'
import { emitRendererSettingsChanged } from '../lib/keyboard-shortcut-settings'
import { AutoPlanBuildDialog } from '../components/plan/AutoPlanBuildDialog'
import { GUI_PLAN_RELATIVE_DIR } from './plan-path'
import { buildDraftGuiPlanTurnOverrides } from '../components/workbench-plan-controller'
import { createGuiPlanArtifact, type GuiPlanArtifact } from './plan-store'
import {
  extractPlanMetadataFromBlock,
  guiPlanMetaMatchesArtifact,
  type GuiPlanToolMeta
} from './plan-tool'
import { preparePlanBuild } from './prepare-plan-build'
import { usePlanWorktreePreferenceStore } from './plan-worktree-preference-store'
import { useAutoPlanBuildSettingsState } from './use-auto-plan-build-settings'
import {
  AutoPlanBuildRecoveryCoordinator,
  autoPlanBuildRecoveryThreadSignature
} from './auto-plan-build-recovery-coordinator'
import {
  activeAutoPlanBuildIntent,
  autoPlanBuildRequestFingerprint,
  clearAutoPlanBuildIntents,
  createAutoPlanBuildIntent,
  listAutoPlanBuildIntents,
  patchAutoPlanBuildIntent,
  removeAutoPlanBuildIntent,
  saveAutoPlanBuildIntent,
  type AutoPlanBuildIntentV1,
  type AutoPlanBuildSelection
} from './auto-plan-build-intents'

type AutoPlanTurnOverrides = Pick<
  SendMessageOverrides,
  | 'attachmentIds'
  | 'agentSurface'
  | 'attachments'
  | 'displayText'
  | 'fileReferences'
  | 'model'
  | 'providerId'
  | 'reasoningEffort'
  | 'serviceTier'
> & { workspaceRoot?: string }

type PendingDialog = {
  text: string
  overrides?: AutoPlanTurnOverrides
  onStarted: () => void
  onSubmitting?: () => void
  onRejected?: () => void
  settings: AppSettingsV1
}

export type AutoPlanBuildRequestResult = 'started' | 'dialog' | 'rejected'
export type RequestAutoPlanBuild = (input: {
  text: string
  overrides?: AutoPlanTurnOverrides
  onStarted: () => void
  onSubmitting?: () => void
  onRejected?: () => void
}) => Promise<AutoPlanBuildRequestResult>

const dispatchingIntentIds = new Set<string>()
const startingScopes = new Set<string>()
export const AUTO_PLAN_RECOVERY_MISMATCH_ERROR =
  'Automatic build recovery could not prove a matching successful plan result.'
export const LEGACY_AUTO_PLAN_DUPLICATE_ERROR =
  'This task already has an Automatic plan build waiting to finish.'

function normalizedPath(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+/g, '/').toLowerCase()
}

function planMetaMatchesIntent(meta: GuiPlanToolMeta, intent: AutoPlanBuildIntentV1): boolean {
  return guiPlanMetaMatchesArtifact(meta, intent) &&
    normalizeWorkspaceRoot(meta.workspaceRoot) === normalizeWorkspaceRoot(intent.workspaceRoot) &&
    normalizedPath(meta.relativePath) === normalizedPath(intent.relativePath)
}

function matchingSuccessfulPlan(
  blocks: readonly ChatBlock[],
  intent: AutoPlanBuildIntentV1
): { meta: GuiPlanToolMeta; turnId: string } | null {
  const scopedToTurn = Boolean(intent.planTurnId)
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block.kind !== 'tool' || block.status !== 'success') continue
    if (scopedToTurn && block.turnId !== intent.planTurnId) continue
    const meta = extractPlanMetadataFromBlock(block)
    if (!meta) continue
    const sameWorkspace =
      normalizeWorkspaceRoot(meta.workspaceRoot) === normalizeWorkspaceRoot(intent.workspaceRoot)
    if (!sameWorkspace) continue
    if (scopedToTurn) {
      // The runtime re-derives the draft plan filename from the model's
      // title, so the renderer-reserved relative path is only a hint. A plan
      // turn produces exactly one plan, so workspace parity within the scoped
      // turn is sufficient to identify the result.
      return { meta, turnId: block.turnId ?? '' }
    }
    if (planMetaMatchesIntent(meta, intent)) {
      return { meta, turnId: block.turnId ?? '' }
    }
  }
  return null
}

function recoverableMismatch(intent: AutoPlanBuildIntentV1): boolean {
  return intent.status === 'needs_attention' && intent.error === AUTO_PLAN_RECOVERY_MISMATCH_ERROR
}

function clearRecoveryMismatch(intent: AutoPlanBuildIntentV1): void {
  if (useChatStore.getState().activeThreadId !== intent.threadId) return
  if (useChatStore.getState().error === AUTO_PLAN_RECOVERY_MISMATCH_ERROR) {
    useChatStore.getState().setError(null)
  }
}

function clearLegacyDuplicateError(intent: AutoPlanBuildIntentV1 | null): void {
  const state = useChatStore.getState()
  if (
    intent &&
    intent.status !== 'needs_attention' &&
    state.error === LEGACY_AUTO_PLAN_DUPLICATE_ERROR
  ) state.setError(null)
}

function pendingUserInput(blocks: readonly ChatBlock[]): boolean {
  return blocks.some((block) => block.kind === 'user_input' && block.status === 'pending')
}

/**
 * Remove a stale plan-completion attention marker for the handoff thread when
 * Automatic mode advances from the plan turn into the build turn. The unread
 * policy already suppresses new intermediate markers, but an upgraded build or
 * a race can leave one behind; without this, the Dock badge would point at a
 * thread whose sidebar only shows "running".
 */
function clearAutoPlanHandoffUnread(threadId: string): void {
  const normalized = threadId.trim()
  if (!normalized) return
  const state = useChatStore.getState()
  const unreadThreadIds = clearUnreadCompletion(state.unreadThreadIds, normalized)
  if (unreadThreadIds !== state.unreadThreadIds) {
    useChatStore.setState({ unreadThreadIds })
  }
}

function admittedPlanIdentity(
  sourceThreadId: string,
  state: Pick<ReturnType<typeof useChatStore.getState>,
    'activeThreadId' | 'currentTurnId' | 'threads'>
): { threadId: string; planTurnId: string } {
  const threadId = sourceThreadId || state.activeThreadId?.trim() || ''
  const threadSummary = state.threads.find((thread) => thread.id === threadId)
  const planTurnId = (
    state.activeThreadId === threadId ? state.currentTurnId : null
  )?.trim() || threadSummary?.latestTurnId?.trim() || ''
  return { threadId, planTurnId }
}

function acquireAutomaticStartScope(scope: string): (() => void) | null {
  if (startingScopes.has(scope)) return null
  startingScopes.add(scope)
  return () => startingScopes.delete(scope)
}

async function routeExistingAutomaticIntent(
  existing: AutoPlanBuildIntentV1,
  pending: Omit<PendingDialog, 'settings'>,
  sendMessage: ReturnType<typeof useChatStore.getState>['sendMessage']
): Promise<boolean | null> {
  if (existing.status === 'needs_attention') return null
  const requestFingerprint = autoPlanBuildRequestFingerprint(pending.text)
  if (existing.requestFingerprint && existing.requestFingerprint === requestFingerprint) {
    pending.onSubmitting?.()
    pending.onStarted()
    return true
  }
  return runAutomaticSubmitLifecycle(pending, () => sendMessage(pending.text, 'agent', {
    ...pending.overrides,
    expectedThreadId: existing.threadId,
    orchestration: 'direct',
    agentSurface: 'code'
  }))
}

async function existingPlanPaths(workspaceRoot: string): Promise<string[]> {
  try {
    const result = await window.kunGui.listWorkspaceDirectory({
      workspaceRoot,
      path: GUI_PLAN_RELATIVE_DIR
    })
    if (!result.ok) return []
    return result.entries
      .filter((entry) => entry.type === 'file' && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => `${GUI_PLAN_RELATIVE_DIR}/${entry.name}`)
  } catch {
    return []
  }
}

async function loadPlan(meta: GuiPlanToolMeta, threadId: string): Promise<{
  plan: GuiPlanArtifact
  content: string
}> {
  const result = await window.kunGui.readWorkspaceFile({
    workspaceRoot: meta.workspaceRoot,
    path: meta.relativePath
  })
  if (!result.ok) throw new Error(result.message)
  const base = createGuiPlanArtifact({
    workspaceRoot: meta.workspaceRoot,
    threadId,
    relativePath: meta.relativePath,
    absolutePath: meta.absolutePath ?? result.path,
    sourceRequest: meta.sourceRequest ?? ''
  })
  return {
    plan: meta.title?.trim() ? { ...base, featureName: meta.title.trim() } : base,
    content: result.content
  }
}

function scheduledTaskMatches(
  task: AppSettingsV1['schedule']['tasks'][number],
  intent: AutoPlanBuildIntentV1,
  prompt: string
): boolean {
  return Boolean(intent.scheduled) &&
    task.sourcePlanId === intent.planId &&
    task.sourceThreadId === intent.threadId &&
    task.schedule.kind === 'at' &&
    task.schedule.atTime === intent.scheduled?.schedule.atTime &&
    task.prompt === prompt
}

async function sendDirectBuild(
  intent: AutoPlanBuildIntentV1,
  prepared: { prompt: string; displayText: string }
): Promise<void> {
  const state = useChatStore.getState()
  if (state.activeThreadId === intent.threadId && state.route === 'chat') {
    const sent = await state.sendMessage(prepared.prompt, 'agent', {
      clientRequestId: intent.buildClientRequestId,
      waitForRuntimeAdmission: true,
      expectedThreadId: intent.threadId,
      orchestration: 'direct',
      displayText: prepared.displayText,
      agentSurface: 'code'
    })
    if (sent) return
  }
  await getProvider().sendUserMessage(intent.threadId, prepared.prompt, {
    clientRequestId: intent.buildClientRequestId,
    mode: 'agent',
    orchestration: 'direct',
    displayText: prepared.displayText,
    agentSurface: 'code'
  })
}

async function prepareIntentBuild(
  intent: AutoPlanBuildIntentV1,
  meta: GuiPlanToolMeta
): Promise<{ plan: GuiPlanArtifact; prompt: string; title: string; displayText: string }> {
  const loaded = await loadPlan(meta, intent.threadId)
  const preference = usePlanWorktreePreferenceStore.getState()
  preference.initializePlan(intent.planId, intent.useWorktree, DEFAULT_GIT_BRANCH_PREFIX)
  preference.setUsePromptWorktree(intent.planId, intent.useWorktree)
  const settings = await rendererRuntimeClient.getSettings()
  const prepared = await preparePlanBuild({
    plan: loaded.plan,
    content: loaded.content,
    orchestration: 'direct',
    graphEnabled: false,
    usePromptWorktree: intent.useWorktree,
    branchPrefix: settings.gitBranchPrefix || DEFAULT_GIT_BRANCH_PREFIX,
    activeThreadId: intent.threadId,
    save: async () => true,
    currentPlanId: () => loaded.plan.id,
    currentThreadId: () => intent.threadId,
    getGitBranches: window.kunGui.getGitBranches
  })
  return {
    plan: loaded.plan,
    prompt: prepared.prompt,
    title: prepared.title,
    displayText: prepared.prompt.includes('<prompt_managed_worktree_protocol>')
      ? `${loaded.plan.featureName} (${prepared.displayText.match(/\((.+)\)$/)?.[1] ?? ''})`
      : `Direct build: ${loaded.plan.relativePath}`
  }
}

async function dispatchIntent(
  intent: AutoPlanBuildIntentV1,
  meta: GuiPlanToolMeta
): Promise<void> {
  if (dispatchingIntentIds.has(intent.id)) return
  dispatchingIntentIds.add(intent.id)
  patchAutoPlanBuildIntent(intent.id, { status: 'dispatching', error: '' })
  clearAutoPlanHandoffUnread(intent.threadId)
  try {
    if (intent.buildMode === 'scheduled') {
      const target = Date.parse(intent.scheduled?.schedule.atTime ?? '')
      if (!Number.isFinite(target) || target <= Date.now()) {
        throw new Error('The scheduled build time passed before planning finished. Choose a new time.')
      }
    }
    const prepared = await prepareIntentBuild(intent, meta)
    if (intent.buildMode === 'scheduled' && intent.scheduled) {
      const settings = await rendererRuntimeClient.getSettings({ forceRefresh: true })
      if (!settings.schedule.tasks.some((task) => scheduledTaskMatches(task, intent, prepared.prompt))) {
        const result = await window.kunGui.createScheduleTask({
          title: prepared.title,
          prompt: prepared.prompt,
          workspaceRoot: intent.workspaceRoot,
          sourcePlanId: intent.planId,
          sourceThreadId: intent.threadId,
          providerId: intent.scheduled.providerId,
          model: intent.scheduled.model,
          reasoningEffort: intent.scheduled.reasoningEffort,
          mode: 'agent',
          orchestration: 'direct',
          schedule: intent.scheduled.schedule
        })
        if (!result.ok) throw new Error(result.message)
      }
    } else {
      await sendDirectBuild(intent, prepared)
    }
    removeAutoPlanBuildIntent(intent.id)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = getRuntimeErrorCode(error)
    if (
      code === 'thread_busy' ||
      code === 'turn_in_progress' ||
      code === 'fetch_failed' ||
      code === 'runtime_unhealthy' ||
      code === 'runtime_offline' ||
      code === 'runtime_unavailable'
    ) {
      patchAutoPlanBuildIntent(intent.id, { status: 'planning', error: '' })
      return
    }
    patchAutoPlanBuildIntent(intent.id, { status: 'needs_attention', error: message })
    if (useChatStore.getState().activeThreadId === intent.threadId) {
      useChatStore.getState().setError(message)
    }
  } finally {
    dispatchingIntentIds.delete(intent.id)
  }
}

async function reconcileIntent(intent: AutoPlanBuildIntentV1): Promise<void> {
  if (!intent.threadId || dispatchingIntentIds.has(intent.id)) return
  const recoveringLegacyMismatch = recoverableMismatch(intent)
  if (recoveringLegacyMismatch) {
    patchAutoPlanBuildIntent(intent.id, { status: 'planning', error: '' })
    clearRecoveryMismatch(intent)
    intent = { ...intent, status: 'planning', error: '' }
  }
  const detail = await getProvider().getThreadDetail(intent.threadId, {
    priority: 'background'
  })
  if (pendingUserInput(detail.blocks) || detail.latestTurnStatus === 'running' || detail.threadStatus === 'running') {
    return
  }
  const matchingPlan = matchingSuccessfulPlan(detail.blocks, intent)
  if (matchingPlan) {
    clearRecoveryMismatch(intent)
    if (
      recoveringLegacyMismatch &&
      !intent.planTurnId &&
      matchingPlan.turnId &&
      detail.latestTurnId &&
      detail.latestTurnId !== matchingPlan.turnId
    ) {
      // The user moved on after the old renderer stopped. Do not replay an
      // Automatic build after a later manual/ordinary turn has already begun.
      removeAutoPlanBuildIntent(intent.id)
      return
    }
    await dispatchIntent(intent, matchingPlan.meta)
    return
  }
  const exactPlanTurnSettled = Boolean(
    intent.planTurnId &&
    detail.latestTurnId === intent.planTurnId &&
    detail.latestTurnStatus &&
    detail.latestTurnStatus !== 'running'
  )
  if (exactPlanTurnSettled) {
    const error = AUTO_PLAN_RECOVERY_MISMATCH_ERROR
    patchAutoPlanBuildIntent(intent.id, {
      status: 'needs_attention',
      error
    })
    if (useChatStore.getState().activeThreadId === intent.threadId) {
      useChatStore.getState().setError(error)
    }
  }
}

function automaticRecoveryErrorIsRetryable(error: unknown): boolean {
  if ((error as { retryable?: unknown } | null)?.retryable === true) return true
  return new Set([
    'fetch_failed',
    'internal_error',
    'provider_unavailable',
    'runtime_offline',
    'runtime_unavailable',
    'runtime_unhealthy',
    'thread_read_overloaded'
  ]).has(getRuntimeErrorCode(error) ?? '')
}

const automaticRecoveryCoordinator = new AutoPlanBuildRecoveryCoordinator({
  listIntents: listAutoPlanBuildIntents,
  intentIsEligible: (intent) =>
    intent.status !== 'needs_attention' || recoverableMismatch(intent),
  loadThreadStates: (threadIds) => loadThreadStates(getProvider(), threadIds),
  inspectIntent: reconcileIntent,
  errorIsRetryable: automaticRecoveryErrorIsRetryable,
  onError: (error) => {
    console.warn('[kun-gui] Automatic plan-build reconciliation will retry:', error)
  }
})

function requestAutomaticRecovery(): void {
  void automaticRecoveryCoordinator.request()
}

export function useAutoPlanBuildController({
  workspaceRoot,
  sendPlanTurn,
  setError
}: {
  workspaceRoot: string
  sendPlanTurn: (
    text: string,
    overrides?: AutoPlanTurnOverrides & {
      clientRequestId?: string
      guiPlan?: SendMessageOverrides['guiPlan']
      waitForRuntimeAdmission?: boolean
    }
  ) => Promise<boolean>
  setError: (message: string) => void
}): {
  requestAutoPlanBuild: RequestAutoPlanBuild
  dialog: ReactElement | null
  enabled: boolean
} {
  const autoSettingsState = useAutoPlanBuildSettingsState()
  const defaults = autoSettingsState.value
  const [pendingDialog, setPendingDialog] = useState<PendingDialog | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const threads = useChatStore((state) => state.threads)
  const threadLifecycleSignature = useMemo(
    () => autoPlanBuildRecoveryThreadSignature(threads),
    [threads]
  )
  const activeThreadId = useChatStore((state) => state.activeThreadId)
  const activeTurnId = useChatStore((state) => state.currentTurnId)
  const activeBusy = useChatStore((state) => state.busy)
  const runtimeConnection = useChatStore((state) => state.runtimeConnection)
  const activeLifecycleSignature = `${activeThreadId ?? ''}:${activeTurnId ?? ''}:${activeBusy}`

  useEffect(() => {
    if (!autoSettingsState.loaded || defaults.enabled) return
    automaticRecoveryCoordinator.reset()
    clearAutoPlanBuildIntents()
    setPendingDialog(null)
    if (useChatStore.getState().composerMode === 'auto') {
      useChatStore.getState().setComposerMode('agent')
    }
  }, [autoSettingsState.loaded, defaults.enabled])

  useEffect(() => {
    if (!autoSettingsState.loaded || !defaults.enabled || runtimeConnection !== 'ready') return
    requestAutomaticRecovery()
  }, [
    activeLifecycleSignature,
    autoSettingsState.loaded,
    defaults.enabled,
    runtimeConnection,
    threadLifecycleSignature
  ])

  useEffect(() => {
    if (!activeThreadId) return
    const attention = activeAutoPlanBuildIntent(activeThreadId)
    clearLegacyDuplicateError(attention)
    if (attention?.status === 'needs_attention' && attention.error && !recoverableMismatch(attention)) {
      setError(attention.error)
    }
  }, [activeLifecycleSignature, activeThreadId, setError, threadLifecycleSignature])

  const start = useCallback(async (
    pending: Omit<PendingDialog, 'settings'>,
    selection: AutoPlanBuildSelection
  ): Promise<boolean> => {
    const state = useChatStore.getState()
    const sourceThreadId = state.activeThreadId?.trim() ?? ''
    const targetWorkspace = normalizeWorkspaceRoot(
      pending.overrides?.workspaceRoot ||
      state.threads.find((thread) => thread.id === state.activeThreadId)?.workspace ||
      state.workspaceRoot ||
      workspaceRoot
    )
    if (!targetWorkspace) {
      setError('A workspace is required to start Automatic plan build.')
      return false
    }
    const startScope = sourceThreadId
      ? `thread:${sourceThreadId}`
      : `workspace:${targetWorkspace}`
    const releaseStartScope = acquireAutomaticStartScope(startScope)
    if (!releaseStartScope) return true
    try {
      if (sourceThreadId) {
        const existing = activeAutoPlanBuildIntent(sourceThreadId)
        if (existing?.status === 'needs_attention') removeAutoPlanBuildIntent(existing.id)
        else if (existing) {
          clearLegacyDuplicateError(existing)
          const routed = await routeExistingAutomaticIntent(existing, pending, state.sendMessage)
          if (routed !== null) return routed
        }
      }
      const draft = buildDraftGuiPlanTurnOverrides({
        request: pending.text,
        workspaceRoot: targetWorkspace,
        activeThreadId: sourceThreadId || null,
        existingRelativePaths: await existingPlanPaths(targetWorkspace)
      })
      const intent = createAutoPlanBuildIntent({
        planId: draft.guiPlan.planId,
        relativePath: draft.guiPlan.relativePath,
        workspaceRoot: targetWorkspace,
        threadId: sourceThreadId,
        requestText: pending.text,
        selection
      })
      if (!saveAutoPlanBuildIntent(intent)) {
        setError('Automatic plan build could not persist its recovery intent.')
        return false
      }
      const sent = await runAutomaticSubmitLifecycle(pending, () => sendPlanTurn(pending.text, {
        ...pending.overrides,
        workspaceRoot: targetWorkspace,
        guiPlan: draft.guiPlan,
        clientRequestId: intent.planClientRequestId,
        waitForRuntimeAdmission: true
      }))
      if (!sent) {
        removeAutoPlanBuildIntent(intent.id)
        return false
      }
      const admittedState = useChatStore.getState()
      const { threadId, planTurnId } = admittedPlanIdentity(sourceThreadId, admittedState)
      if (!threadId) {
        patchAutoPlanBuildIntent(intent.id, {
          status: 'needs_attention',
          error: 'Automatic plan turn was accepted without a task identity.'
        })
        return false
      }
      patchAutoPlanBuildIntent(intent.id, {
        threadId,
        planTurnId,
        status: 'planning',
        error: ''
      })
      requestAutomaticRecovery()
      return true
    } finally {
      releaseStartScope()
    }
  }, [sendPlanTurn, setError, workspaceRoot])

  const requestAutoPlanBuild = useCallback(async (input: {
    text: string
    overrides?: AutoPlanTurnOverrides
    onStarted: () => void
    onSubmitting?: () => void
    onRejected?: () => void
  }): Promise<AutoPlanBuildRequestResult> => {
    const settings = await rendererRuntimeClient.getSettings({ forceRefresh: true })
    const current = settings.agents.kun.lab.autoPlanBuild
    if (!current.enabled) {
      setError('Automatic plan build is disabled in Laboratory settings.')
      return 'rejected'
    }
    if (current.confirmation === 'defaults' && current.defaultBuildMode === 'direct') {
      return await start(input, {
        buildMode: 'direct',
        useWorktree: current.useWorktreeByDefault
      }) ? 'started' : 'rejected'
    }
    setDialogError('')
    setPendingDialog({ ...input, settings })
    return 'dialog'
  }, [setError, start])

  const submitDialog = useCallback(async (
    selection: AutoPlanBuildSelection,
    saveAsDefault: boolean
  ): Promise<void> => {
    if (!pendingDialog) return
    setSubmitting(true)
    setDialogError('')
    try {
      if (saveAsDefault) {
        const saved = await rendererRuntimeClient.setSettings({
          agents: {
            kun: {
              lab: {
                autoPlanBuild: {
                  confirmation: 'defaults',
                  defaultBuildMode: selection.buildMode,
                  useWorktreeByDefault: selection.useWorktree,
                  ...(selection.scheduled
                    ? {
                        scheduledDefaults: {
                          providerId: selection.scheduled.providerId,
                          model: selection.scheduled.model,
                          reasoningEffort: selection.scheduled.reasoningEffort,
                          timeZone: selection.scheduled.schedule.timeZone
                        }
                      }
                    : {})
                }
              }
            }
          }
        })
        emitRendererSettingsChanged(saved)
      }
      const started = await start(pendingDialog, selection)
      if (started) setPendingDialog(null)
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(false)
    }
  }, [pendingDialog, start])

  const dialog = useMemo(() => pendingDialog ? (
    <AutoPlanBuildDialog
      settings={pendingDialog.settings}
      defaults={pendingDialog.settings.agents.kun.lab.autoPlanBuild}
      submitting={submitting}
      error={dialogError}
      onClose={() => { if (!submitting) setPendingDialog(null) }}
      onSubmit={submitDialog}
    />
  ) : null, [dialogError, pendingDialog, submitDialog, submitting])

  return {
    requestAutoPlanBuild,
    dialog,
    enabled: autoSettingsState.loaded && defaults.enabled
  }
}

export const autoPlanBuildControllerTestApi = {
  acquireAutomaticStartScope,
  admittedPlanIdentity,
  clearLegacyDuplicateError,
  dispatchIntent,
  matchingSuccessfulPlan,
  planMetaMatchesIntent,
  reconcileIntent,
  routeExistingAutomaticIntent,
  scheduledTaskMatches,
  requestAutomaticRecovery,
  automaticRecoveryDiagnostics: () => automaticRecoveryCoordinator.diagnostics()
}

export function resetAutoPlanBuildControllerForTests(): void {
  automaticRecoveryCoordinator.reset()
  dispatchingIntentIds.clear()
  startingScopes.clear()
}
