import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ChatBlock, ThreadTodoList } from '../agent/types'
import { useChatStore } from '../store/chat-store'
import type { ChatState } from '../store/chat-store-types'
import { buildRefinePlanPrompt } from '../plan/plan-prompts'
import { preparePlanBuild } from '../plan/prepare-plan-build'
import { normalizePlanTaskPath, planHasTaskCheckboxes } from '../plan/plan-task-checkboxes'
import { buildSddVerifyPrompt } from '../sdd/sdd-verify-prompt'
import { sddDraftRelativePathForPlanPath, sddDraftTraceRelativePath } from '@shared/sdd'
import { buildSddTraceSnapshot, parseSddRequirementBlocks } from '@shared/sdd-trace'
import {
  PLAN_BOARD_PREFERRED
} from './workbench-layout'
import {
  createGuiPlanArtifact,
  guiPlanMatchesContext,
  readRememberedGuiPlan,
  useGuiPlanStore,
  type GuiPlanArtifact
} from '../plan/plan-store'
import {
  GUI_PLAN_RELATIVE_DIR,
  nextAvailablePlanRelativePath,
  planFeatureNameFromRequest
} from '../plan/plan-path'
import { extractPlanMetadataFromBlock, guiPlanMetaMatchesArtifact, type GuiPlanToolMeta } from '../plan/plan-tool'
import { ensureGuiPlanLoadedFromMeta } from '../plan/load-plan-from-meta'
import type { PlanBuildOrchestration } from '../plan/plan-build'
import type { RightPanelMode } from './chat/WorkbenchTopBar'
import { BUILTIN_RIGHT_PANEL_IDS } from '../extensions/contribution-ids'
import type { GuiPlanMessageContext, SendMessageOverrides } from '../store/chat-store-types'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import { usePlanWorktreePreferenceStore } from '../plan/plan-worktree-preference-store'
import { usePlanWorktreePreference } from '../plan/use-plan-worktree-preference'

type PlanResultMatch = {
  blockId: string
  meta: GuiPlanToolMeta
}

type PlanTurnOverrides = Pick<
  SendMessageOverrides,
  | 'attachmentIds'
  | 'attachments'
  | 'clientRequestId'
  | 'displayText'
  | 'fileReferences'
  | 'guiPlan'
  | 'model'
  | 'providerId'
  | 'reasoningEffort'
  | 'waitForRuntimeAdmission'
> & {
  workspaceRoot?: string
}

type WorkbenchPlanControllerOptions = {
  blocks: ChatBlock[]
  busy: boolean
  mode: 'plan' | 'agent' | 'auto'
  route: ChatState['route']
  sendMessage: ChatState['sendMessage']
  setError: ChatState['setError']
  setComposerMode: ChatState['setComposerMode']
  setRightPanelMode: Dispatch<SetStateAction<RightPanelMode>>
  setRightSidebarWidth: Dispatch<SetStateAction<number>>
  t: (key: string, options?: Record<string, unknown>) => string
  workspaceRoot: string
  onPlanBuildStarted?: (plan: GuiPlanArtifact) => void | Promise<void>
}

function latestSuccessfulPlanBlock(blocks: ChatBlock[]): PlanResultMatch | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block.kind !== 'tool' || block.status !== 'success') continue
    const meta = extractPlanMetadataFromBlock(block)
    if (!meta) continue
    return { blockId: block.id, meta }
  }
  return null
}

export function resolvePlanTurnWorkspaceRoot(
  preferredWorkspaceRoot: string | undefined,
  fallbackWorkspaceRoot: string | undefined
): string {
  return normalizePlanWorkspaceRoot(preferredWorkspaceRoot) || normalizePlanWorkspaceRoot(fallbackWorkspaceRoot)
}

function normalizePlanWorkspaceRoot(value: string | undefined): string {
  return normalizeWorkspaceRoot(value).replaceAll('\\', '/').replace(/\/+$/, '')
}

export function planTodosForBuild(
  plan: GuiPlanArtifact,
  todos: ThreadTodoList | null
): Array<{ id: string; content: string; status: 'pending' | 'in_progress' | 'completed' }> {
  const planPath = normalizePlanTaskPath(plan.relativePath)
  return (todos?.items ?? [])
    .filter((item) =>
      item.source?.kind === 'plan' &&
      item.source.planId === plan.id &&
      normalizePlanTaskPath(item.source.relativePath) === planPath
    )
    .map(({ id, content, status }) => ({ id, content, status }))
}

export function resolveAssociatedGuiPlan(
  activePlan: GuiPlanArtifact | null,
  rememberedPlan: GuiPlanArtifact | null,
  workspaceRoot: string,
  activeThreadId: string | null
): GuiPlanArtifact | null {
  if (activePlan && guiPlanMatchesContext(activePlan, workspaceRoot, activeThreadId)) return activePlan
  if (rememberedPlan && guiPlanMatchesContext(rememberedPlan, workspaceRoot, activeThreadId)) return rememberedPlan
  return null
}

export function buildGuiPlanTurnOverrides(
  plan: GuiPlanArtifact | null,
  workspaceRoot: string,
  activeThreadId: string | null
): { guiPlan?: GuiPlanMessageContext } | undefined {
  if (plan && guiPlanMatchesContext(plan, workspaceRoot, activeThreadId)) {
    return {
      guiPlan: {
        operation: 'refine',
        workspaceRoot: plan.workspaceRoot,
        relativePath: plan.relativePath,
        planId: plan.id,
        sourceRequest: plan.sourceRequest,
        title: plan.featureName
      }
    }
  }
  return undefined
}

/**
 * Decide whether to auto-open the plan preview when a plan block loads.
 * Open only for a plan we just generated in *this* thread's plan turn: the
 * in-flight marker carries the thread id captured at send time, so honoring
 * it only while that thread is still active stops a plan turn started in
 * thread A from popping open thread B's old plan after a mid-turn switch.
 * A null marker (thread reload, or no plan turn in flight) never opens.
 */
export function shouldAutoOpenPlanPanel(
  inFlightThreadId: string | null,
  activeThreadId: string | null
): boolean {
  return inFlightThreadId !== null && inFlightThreadId === activeThreadId
}

export function buildDraftGuiPlanTurnOverrides(input: {
  request: string
  workspaceRoot: string
  activeThreadId: string | null
  existingRelativePaths?: Iterable<string>
}): { guiPlan: GuiPlanMessageContext } {
  const sourceRequest = input.request.trim()
  const featureName = planFeatureNameFromRequest(sourceRequest)
  const relativePath = nextAvailablePlanRelativePath(featureName, input.existingRelativePaths ?? [])
  const plan = createGuiPlanArtifact({
    workspaceRoot: input.workspaceRoot,
    threadId: input.activeThreadId,
    relativePath,
    sourceRequest
  })
  return {
    guiPlan: {
      operation: 'draft',
      workspaceRoot: plan.workspaceRoot,
      relativePath: plan.relativePath,
      planId: plan.id,
      sourceRequest: plan.sourceRequest,
      title: plan.featureName
    }
  }
}

export function useWorkbenchPlanController({
  blocks,
  busy,
  mode,
  route,
  sendMessage,
  setError,
  setComposerMode,
  setRightPanelMode,
  setRightSidebarWidth,
  t,
  workspaceRoot,
  onPlanBuildStarted
}: WorkbenchPlanControllerOptions) {
  const activeGuiPlan = useGuiPlanStore((s) => s.activePlan)
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  usePlanWorktreePreference(activeGuiPlan)
  const latestPlanBlock = useMemo(() => latestSuccessfulPlanBlock(blocks), [blocks])
  const planTurnInFlightThreadIdRef = useRef<string | null>(null)
  const lastLoadedPlanBlockIdRef = useRef<string | null>(null)

  const openGuiPlanPanel = useCallback((meta?: GuiPlanToolMeta): void => {
    setRightSidebarWidth((width) => Math.max(width, PLAN_BOARD_PREFERRED))
    setRightPanelMode(BUILTIN_RIGHT_PANEL_IDS.plan)
    // Card "open plan" must recover the plan when the store lost it (app
    // restart, another thread's plan taking over the registry); otherwise
    // the panel opens blank.
    if (!meta) return
    const current = useGuiPlanStore.getState().activePlan
    if (current && guiPlanMetaMatchesArtifact(meta, current)) return
    void ensureGuiPlanLoadedFromMeta(meta).catch((error) => {
      useGuiPlanStore.getState().setOperationStatus(
        'error',
        error instanceof Error ? error.message : String(error)
      )
    })
  }, [setRightPanelMode, setRightSidebarWidth])

  const savePlanContentToDisk = async (
    plan: GuiPlanArtifact,
    contentToSave: string
  ): Promise<boolean> => {
    const planStore = useGuiPlanStore.getState()
    const planId = plan.id
    const threadId = plan.threadId?.trim() || null
    planStore.setSaveStatusForPlan(planId, threadId, 'saving')
    try {
      const result = await window.kunGui.writeWorkspaceFile({
        workspaceRoot: plan.workspaceRoot,
        path: plan.relativePath,
        content: contentToSave
      })
      if (!result.ok) {
        useGuiPlanStore.getState().setSaveStatusForPlan(planId, threadId, 'error', result.message)
        return false
      }
      const chatState = useChatStore.getState()
      if (threadId && chatState.activeThreadId !== threadId) return false
      const hasLinkedTodos = (chatState.activeThreadTodos?.items ?? []).some((item) =>
        item.source?.kind === 'plan' && item.source.planId === plan.id
      )
      if (
        threadId &&
        chatState.activeThreadId === threadId &&
        chatState.runtimeConnection === 'ready' &&
        (hasLinkedTodos || planHasTaskCheckboxes(contentToSave))
      ) {
        const synced = await chatState.syncPlanTodosFromMarkdown(threadId, plan, contentToSave)
        if (!synced) {
          useGuiPlanStore.getState().setSaveStatusForPlan(
            planId,
            threadId,
            'error',
            t('planTodoSyncFailed')
          )
          return false
        }
      }
      const latest = useGuiPlanStore.getState()
      latest.markSavedForPlan(planId, threadId, contentToSave)
      return true
    } catch (error) {
      useGuiPlanStore.getState().setSaveStatusForPlan(
        planId,
        threadId,
        'error',
        error instanceof Error ? error.message : String(error)
      )
      return false
    }
  }

  const readExistingPlanRelativePaths = async (
    targetWorkspaceRoot: string
  ): Promise<string[]> => {
    try {
      const result = await window.kunGui.listWorkspaceDirectory({
        workspaceRoot: targetWorkspaceRoot,
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

  const sendPlanTurn = async (
    text: string,
    overrides?: PlanTurnOverrides
  ): Promise<boolean> => {
    const currentChatState = useChatStore.getState()
    const currentPlan = useGuiPlanStore.getState().activePlan
    const fallbackWorkspaceRoot =
      currentChatState.workspaceRoot || workspaceRoot || currentPlan?.workspaceRoot
    const targetWorkspaceRoot = resolvePlanTurnWorkspaceRoot(
      overrides?.workspaceRoot,
      fallbackWorkspaceRoot
    )
    if (!targetWorkspaceRoot) {
      setError(t('workspaceRequiredToCreateThread'))
      return false
    }
    const { workspaceRoot: _workspaceRoot, ...messageOverrides } = overrides ?? {}
    const activeThreadId = currentChatState.activeThreadId
    const associatedPlan = resolveAssociatedGuiPlan(
      currentPlan,
      readRememberedGuiPlan(targetWorkspaceRoot, activeThreadId),
      targetWorkspaceRoot,
      activeThreadId
    )
    const guiPlan = messageOverrides.guiPlan
      ?? buildGuiPlanTurnOverrides(associatedPlan, targetWorkspaceRoot, activeThreadId)?.guiPlan
      ?? buildDraftGuiPlanTurnOverrides({
        request: text,
        workspaceRoot: targetWorkspaceRoot,
        activeThreadId,
        existingRelativePaths: await readExistingPlanRelativePaths(targetWorkspaceRoot)
      }).guiPlan
    // Tag the in-flight plan turn with the thread it belongs to BEFORE awaiting
    // sendMessage. A fast response can land a create_plan block in `blocks`
    // before this Promise resolves; if we tagged only after the await, the
    // auto-open effect would see a null marker in that window and never open.
    // For a brand-new chat the id is null here and gets re-tagged below after
    // sendMessage creates the thread. A mid-await thread switch deliberately
    // leaves the original tag intact so the auto-open effect rejects it as a
    // cross-thread leak (see shouldAutoOpenPlanPanel).
    const initialActiveThreadId = currentChatState.activeThreadId
    planTurnInFlightThreadIdRef.current = initialActiveThreadId
    const sent = await sendMessage(text, 'plan', {
      ...messageOverrides,
      guiPlan
    })
    if (!sent) {
      planTurnInFlightThreadIdRef.current = null
    } else if (initialActiveThreadId === null) {
      planTurnInFlightThreadIdRef.current = useChatStore.getState().activeThreadId ?? null
    }
    return sent
  }

  const loadPlanFromMeta = useCallback(async (
    meta: PlanResultMatch['meta'],
    shouldOpen: boolean
  ): Promise<GuiPlanArtifact | null> => {
    // Force a reload: after a refine turn the file on disk is newer than
    // whatever the store currently holds.
    const plan = await ensureGuiPlanLoadedFromMeta(meta, { forceReload: true })
    if (plan && shouldOpen) openGuiPlanPanel()
    return plan
  }, [openGuiPlanPanel])

  const buildGuiPlan = async (
    orchestration: PlanBuildOrchestration,
    meta?: GuiPlanToolMeta
  ): Promise<void> => {
    // The card's build button carries its own plan meta: recover the plan
    // when the store is empty or points at a different plan, instead of
    // silently doing nothing.
    if (meta) {
      const current = useGuiPlanStore.getState().activePlan
      if (!current || !guiPlanMetaMatchesArtifact(meta, current)) {
        await ensureGuiPlanLoadedFromMeta(meta)
      }
    }
    const snapshot = useGuiPlanStore.getState()
    const plan = snapshot.activePlan
    if (!plan) {
      setError(t('planLoadFailed'))
      return
    }
    if (meta && !guiPlanMetaMatchesArtifact(meta, plan)) {
      setError(t('planLoadFailed'))
      return
    }
    const chatState = useChatStore.getState()
    if (chatState.runtimeConnection !== 'ready') {
      setError(t('runtimeActionNeedsConnection'))
      return
    }
    if (chatState.busy) {
      setError(t('composerQueuePlaceholder'))
      return
    }
    if (snapshot.saveStatus === 'saving') return
    if (orchestration === 'graph' && !chatState.graphEnabled) {
      setError(t('graphModeDisabledHint'))
      return
    }
    const preference = usePlanWorktreePreferenceStore.getState().plans[plan.id]
    try {
      const prepared = await preparePlanBuild({
        plan,
        content: snapshot.content,
        orchestration,
        graphEnabled: chatState.graphEnabled,
        usePromptWorktree: orchestration === 'direct' && preference?.initialized === true &&
          preference.usePromptWorktree,
        branchPrefix: preference?.branchPrefix ?? 'codex/',
        activeThreadId: chatState.activeThreadId,
        getPlanTodos: orchestration === 'direct'
          ? () => planTodosForBuild(plan, useChatStore.getState().activeThreadTodos)
          : undefined,
        save: savePlanContentToDisk,
        currentPlanId: () => useGuiPlanStore.getState().activePlan?.id,
        currentThreadId: () => useChatStore.getState().activeThreadId,
        getGitBranches: window.kunGui.getGitBranches
      })
      setComposerMode('agent')
      const displayText = prepared.prompt.includes('<prompt_managed_worktree_protocol>')
        ? t('planWorktreeBuildDisplay', { branch: prepared.displayText.match(/\((.+)\)$/)?.[1] ?? '', title: plan.featureName })
        : `${t(orchestration === 'graph' ? 'planBuildGraph' : 'planBuildDirect')}: ${plan.relativePath}`
      const sent = await sendMessage(prepared.prompt, 'agent', {
        displayText,
        orchestration: prepared.orchestration
      })
      if (sent) await onPlanBuildStarted?.(plan)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setError(message === 'Prompt Worktree requires a checked-out Git branch.'
        ? t('planWorktreeDetachedHead')
        : message)
    }
  }

  const handleGuiPlanCommand = async (request?: string): Promise<void> => {
    setComposerMode('plan')
    if (request?.trim()) {
      await sendPlanTurn(request.trim())
    }
  }

  // SDD acceptance turn: the agent verifies every requirement block's
  // acceptance criteria and updates requirement.md in place.
  const verifyGuiPlan = async (): Promise<void> => {
    const plan = useGuiPlanStore.getState().activePlan
    if (!plan) return
    const draftRelativePath = sddDraftRelativePathForPlanPath(plan.relativePath)
    if (!draftRelativePath) return
    if (useChatStore.getState().busy) {
      setError(t('composerQueuePlaceholder'))
      return
    }
    setComposerMode('agent')
    await sendMessage(
      buildSddVerifyPrompt({
        workspaceRoot: plan.workspaceRoot,
        draftRelativePath,
        planRelativePath: plan.relativePath
      }),
      'agent',
      { displayText: `${t('planVerify')}: ${draftRelativePath}` }
    )
  }

  // SDD incremental replan: feed only the changed requirement blocks back
  // into a refine turn, then re-baseline the trace snapshot.
  const replanChangedRequirements = async (changedIds: string[]): Promise<void> => {
    const snapshot = useGuiPlanStore.getState()
    const plan = snapshot.activePlan
    if (!plan || changedIds.length === 0) return
    const draftRelativePath = sddDraftRelativePathForPlanPath(plan.relativePath)
    if (!draftRelativePath) return
    if (useChatStore.getState().busy) {
      setError(t('composerQueuePlaceholder'))
      return
    }

    const requirement = await window.kunGui.readWorkspaceFile({
      workspaceRoot: plan.workspaceRoot,
      path: draftRelativePath
    })
    if (!requirement.ok) {
      setError(requirement.message)
      return
    }
    const lines = requirement.content.split(/\r?\n/)
    const changedBlocks = parseSddRequirementBlocks(requirement.content)
      .filter((block) => changedIds.includes(block.id))
      .map((block) => lines.slice(block.headingLineIndex, block.endLineIndex).join('\n'))
    const feedback = [
      `Requirements ${changedIds.join(', ')} changed after this plan was generated.`,
      'Update only the steps affected by these requirements. Keep all other steps and their covers tags unchanged, and keep every step linked with a covers tag.',
      '',
      'Latest requirement blocks:',
      '```markdown',
      changedBlocks.join('\n\n'),
      '```'
    ].join('\n')

    setComposerMode('plan')
    const sent = await sendPlanTurn(
      buildRefinePlanPrompt({
        feedback,
        currentPlan: snapshot.content,
        workspaceRoot: plan.workspaceRoot,
        planRelativePath: plan.relativePath
      }),
      {
        displayText: t('sddReplanButton'),
        workspaceRoot: plan.workspaceRoot,
        guiPlan: {
          operation: 'refine',
          workspaceRoot: plan.workspaceRoot,
          relativePath: plan.relativePath,
          planId: plan.id,
          sourceRequest: plan.sourceRequest,
          title: plan.featureName
        }
      }
    )
    if (sent) {
      const tracePath = sddDraftTraceRelativePath(draftRelativePath)
      if (tracePath) {
        await window.kunGui
          .writeWorkspaceFile({
            workspaceRoot: plan.workspaceRoot,
            path: tracePath,
            content: JSON.stringify(
              buildSddTraceSnapshot(requirement.content, plan.relativePath),
              null,
              2
            )
          })
          .catch(() => undefined)
      }
    }
  }

  useEffect(() => {
    if (route !== 'chat' && (mode === 'plan' || mode === 'auto')) {
      setComposerMode('agent')
    }
  }, [mode, route, setComposerMode])

  useEffect(() => {
    if (latestPlanBlock && lastLoadedPlanBlockIdRef.current === latestPlanBlock.blockId) return
    if (!latestPlanBlock) return
    lastLoadedPlanBlockIdRef.current = latestPlanBlock.blockId
    // Auto-open the preview only for a plan we just generated in this thread's
    // plan turn. Loading an old thread that merely contains a plan — or a plan
    // turn started in a different thread we've since switched away from — must
    // not pop the panel open and squeeze the chat on portrait/narrow screens.
    const shouldOpen = shouldAutoOpenPlanPanel(
      planTurnInFlightThreadIdRef.current,
      useChatStore.getState().activeThreadId
    )
    planTurnInFlightThreadIdRef.current = null
    void loadPlanFromMeta(latestPlanBlock.meta, shouldOpen).catch((error) => {
      useGuiPlanStore.getState().setOperationStatus(
        'error',
        error instanceof Error ? error.message : String(error)
      )
    })
  }, [latestPlanBlock, loadPlanFromMeta])

  useEffect(() => {
    if (!busy) planTurnInFlightThreadIdRef.current = null
  }, [busy])

  return {
    activeGuiPlan,
    buildGuiPlan,
    handleGuiPlanCommand,
    openGuiPlanPanel,
    replanChangedRequirements,
    sendPlanTurn,
    verifyGuiPlan
  }
}
