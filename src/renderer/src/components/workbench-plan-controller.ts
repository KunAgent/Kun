import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ChatBlock } from '../agent/types'
import { useChatStore } from '../store/chat-store'
import type { ChatState } from '../store/chat-store-types'
import { buildPlanBuildPrompt, buildRefinePlanPrompt } from '../plan/plan-prompts'
import { buildSddVerifyPrompt } from '../sdd/sdd-verify-prompt'
import { sddDraftRelativePathForPlanPath, sddDraftTraceRelativePath } from '@shared/sdd'
import { buildSddTraceSnapshot, parseSddRequirementBlocks } from '@shared/sdd-trace'
import {
  CODE_PANEL_PREFERRED
} from './workbench-layout'
import {
  createGuiPlanArtifact,
  guiPlanMatchesContext,
  useGuiPlanStore,
  type GuiPlanArtifact
} from '../plan/plan-store'
import {
  GUI_PLAN_RELATIVE_DIR,
  nextAvailablePlanRelativePath,
  planFeatureNameFromRequest
} from '../plan/plan-path'
import { extractPlanMetadataFromBlock } from '../plan/plan-tool'
import type { PanelType } from './tool-sidebar/tool-sidebar-store'
import type { GuiPlanMessageContext, SendMessageOverrides } from '../store/chat-store-types'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'

type PlanResultMatch = {
  blockId: string
  meta: NonNullable<ReturnType<typeof extractPlanMetadataFromBlock>>
}

type PlanTurnOverrides = Pick<
  SendMessageOverrides,
  'attachmentIds' | 'attachments' | 'displayText' | 'fileReferences' | 'guiPlan' | 'model' | 'reasoningEffort'
> & {
  workspaceRoot?: string
}

type WorkbenchPlanControllerOptions = {
  blocks: ChatBlock[]
  busy: boolean
  mode: 'plan' | 'agent'
  route: ChatState['route']
  sendMessage: ChatState['sendMessage']
  setError: ChatState['setError']
  setComposerMode: ChatState['setComposerMode']
  openTab: (type: PanelType) => void
  setRightSidebarWidth: Dispatch<SetStateAction<number>>
  t: (key: string) => string
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
  openTab,
  setRightSidebarWidth,
  t,
  workspaceRoot,
  onPlanBuildStarted
}: WorkbenchPlanControllerOptions) {
  const activeGuiPlan = useGuiPlanStore((s) => s.activePlan)
  const latestPlanBlock = useMemo(() => latestSuccessfulPlanBlock(blocks), [blocks])
  const planTurnInFlightThreadIdRef = useRef<string | null>(null)
  const lastLoadedPlanBlockIdRef = useRef<string | null>(null)

  const openGuiPlanPanel = useCallback((): void => {
    setRightSidebarWidth((width) => Math.max(width, CODE_PANEL_PREFERRED))
    openTab('plan')
  }, [openTab, setRightSidebarWidth])

  const savePlanContentToDisk = async (
    plan: GuiPlanArtifact,
    contentToSave: string
  ): Promise<boolean> => {
    const planStore = useGuiPlanStore.getState()
    planStore.setSaveStatus('saving')
    try {
      const result = await window.kunGui.writeWorkspaceFile({
        workspaceRoot: plan.workspaceRoot,
        path: plan.relativePath,
        content: contentToSave
      })
      if (!result.ok) {
        useGuiPlanStore.getState().setSaveStatus('error', result.message)
        return false
      }
      const latest = useGuiPlanStore.getState()
      if (latest.activePlan?.id === plan.id) {
        latest.markSaved(contentToSave)
      }
      return true
    } catch (error) {
      useGuiPlanStore.getState().setSaveStatus(
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
    // Default to draft: an explicit guiPlan override (e.g. from SDD upgrade)
    // takes priority; otherwise we always start a fresh plan. Previously the
    // active plan was auto-detected as operation: 'refine', which caused new
    // composer requests to be treated as refinements of an old plan.
    const guiPlan = messageOverrides.guiPlan ?? buildDraftGuiPlanTurnOverrides({
      request: text,
      workspaceRoot: targetWorkspaceRoot,
      activeThreadId: currentChatState.activeThreadId,
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
  ): Promise<void> => {
    const result = await window.kunGui.readWorkspaceFile({
      workspaceRoot: meta.workspaceRoot,
      path: meta.relativePath
    })
    if (!result.ok) {
      useGuiPlanStore.getState().setOperationStatus('error', result.message)
      return
    }
    const base = createGuiPlanArtifact({
      workspaceRoot: meta.workspaceRoot,
      threadId: useChatStore.getState().activeThreadId,
      relativePath: meta.relativePath,
      absolutePath: meta.absolutePath ?? result.path,
      sourceRequest: meta.sourceRequest ?? ''
    })
    const plan = meta.title?.trim() ? { ...base, featureName: meta.title.trim() } : base
    useGuiPlanStore.getState().setActivePlan(plan, result.content)
    if (shouldOpen) openGuiPlanPanel()
  }, [openGuiPlanPanel])

  const buildGuiPlan = async (): Promise<void> => {
    const snapshot = useGuiPlanStore.getState()
    const plan = snapshot.activePlan
    if (!plan) return
    if (useChatStore.getState().busy) {
      setError(t('composerQueuePlaceholder'))
      return
    }
    const saved = await savePlanContentToDisk(plan, snapshot.content)
    if (!saved) return
    setComposerMode('agent')
    const prompt = buildPlanBuildPrompt(plan.relativePath)
    const sent = await sendMessage(prompt, 'agent', {
      displayText: `${t('planBuild')}: ${plan.relativePath}`
    })
    if (sent) {
      await onPlanBuildStarted?.(plan)
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
    if (route !== 'chat' && mode === 'plan') {
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
