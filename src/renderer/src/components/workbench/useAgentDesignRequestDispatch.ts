import { useEffect, useRef, useState } from 'react'
import type { NormalizedThread } from '../../agent/types'
import type { DesignOpenRequestMetadata } from '../../agent/design-open-request'
import { useChatStore } from '../../store/chat-store'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import type { DesignTaskProfileSelection } from '../../design/design-task-profile-input'
import { canvasLiveTurnOutcome } from '../../design/canvas/canvas-turn-outcome'
import { canvasTerminalOutcomeFor } from '../../design/canvas/canvas-turn-terminal-registry'
import {
  AGENT_DESIGN_SESSION_ID,
  agentDesignPassPrompt,
  partitionTurnRequests,
  queuedDesignOpenBlocks,
  useAgentDesignRequestStore,
  type DesignOpenBlockRef
} from '../../design/agent-design-requests'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import type { DesignTaskComposerProfile } from '../chat/FloatingComposerTaskProfile'
import type { SendDesignPromptOptions } from '../design/useDesignPromptController'
import { DEFAULT_WORKBENCH_DESIGN_PROFILE } from './workbench-task-intent'

const OUTCOME_RETRY_MS = 400
const OUTCOME_MAX_RETRIES = 20
const RUNNING_SETTLE_MS = 1_500

export function agentDesignProfileSelection(
  base: DesignTaskComposerProfile | undefined,
  request: Pick<DesignOpenRequestMetadata, 'target' | 'medium'>,
  imageGenerationAvailable: boolean
): DesignTaskProfileSelection {
  const profile = base ?? DEFAULT_WORKBENCH_DESIGN_PROFILE
  const medium = request.medium ?? profile.outputMedium
  return {
    outputMedium: medium === 'image' && !imageGenerationAvailable ? 'html' : medium,
    target: request.target ?? profile.target,
    preset: profile.preset,
    ...(profile.presetSource ? { presetSource: profile.presetSource } : {})
  }
}

type DispatchOptions = {
  activeThreadId: string | null
  busy: boolean
  runtimeConnection: string
  threads: readonly NormalizedThread[]
  workspaceRoot: string
  profile?: DesignTaskComposerProfile
  imageGenerationAvailable?: boolean
  sendDesignPrompt: (value: string, options?: SendDesignPromptOptions) => Promise<boolean>
}

/**
 * Runs the Design pass a Code reply asked for with `design_open`.
 *
 * A request is armed only when its reply finished in this window, and starts
 * once the conversation is idle (after any queued user messages) and the reply
 * completed. A stopped or failed reply never starts a pass; the transcript
 * card offers a manual start instead.
 */
export function useAgentDesignRequestDispatch(options: DispatchOptions): void {
  const { activeThreadId, busy, runtimeConnection } = options
  const blocks = useChatStore((state) => state.blocks)
  const currentTurnId = useChatStore((state) => state.currentTurnId)
  const queuedCount = useChatStore((state) => state.queuedMessages.length)
  const records = useAgentDesignRequestStore((state) => state.records)
  const manualStarts = useAgentDesignRequestStore((state) => state.manualStarts)
  const [outcomeTick, setOutcomeTick] = useState(0)
  const retriesRef = useRef(new Map<string, number>())
  const dispatchingRef = useRef(false)
  const latestRef = useRef(options)
  latestRef.current = options

  useEffect(() => {
    if (!activeThreadId) return
    const store = useAgentDesignRequestStore.getState()
    for (const ref of queuedDesignOpenBlocks(blocks)) {
      const turnId = ref.block.turnId?.trim()
      if (!turnId || store.records[ref.request.requestId]) continue
      const live = (busy && turnId === currentTurnId) || Boolean(canvasTerminalOutcomeFor(turnId))
      if (!live) continue
      store.setPhase(ref.request.requestId, { threadId: activeThreadId, turnId, phase: 'waiting' })
    }
  }, [activeThreadId, blocks, busy, currentTurnId])

  useEffect(() => {
    if (busy) return
    const store = useAgentDesignRequestStore.getState()
    for (const record of Object.values(records)) {
      if (
        record.phase === 'running' &&
        record.sessionId === AGENT_DESIGN_SESSION_ID &&
        record.threadId === activeThreadId &&
        Date.now() - record.updatedAt > RUNNING_SETTLE_MS
      ) {
        store.setPhase(record.requestId, { threadId: record.threadId, turnId: record.turnId, phase: 'ready' })
      }
    }
  }, [activeThreadId, busy, records])

  useEffect(() => {
    if (busy || !activeThreadId || runtimeConnection !== 'ready' || dispatchingRef.current) return
    if (queuedCount > 0) return
    const store = useAgentDesignRequestStore.getState()
    const refs = queuedDesignOpenBlocks(blocks)
    const threadId = activeThreadId

    const dispatch = async (ref: DesignOpenBlockRef, turnId: string): Promise<void> => {
      const requestId = ref.request.requestId
      dispatchingRef.current = true
      store.setPhase(requestId, { threadId, turnId, phase: 'starting' })
      try {
        const latest = latestRef.current
        const thread = latest.threads.find((candidate) => candidate.id === threadId)
        const workspace = normalizeWorkspaceRoot(thread?.workspace || latest.workspaceRoot)
        const designStore = useDesignWorkspaceStore.getState()
        if (workspace && normalizeWorkspaceRoot(designStore.workspaceRoot) !== workspace) {
          designStore.setWorkspaceRoot(workspace)
          await useDesignWorkspaceStore.getState().loadDesignSettings()
        }
        const selection = agentDesignProfileSelection(
          latest.profile,
          ref.request,
          latest.imageGenerationAvailable === true
        )
        if (!thread?.designProfile) {
          useDesignWorkspaceStore.getState().updateDesignContext({
            designTarget: selection.target,
            designSystemPreset: selection.preset
          })
        }
        const sent = await latest.sendDesignPrompt(agentDesignPassPrompt(ref.request), {
          displayText: ref.request.title,
          drawingTitle: ref.request.title,
          profileSelection: selection,
          allowMultiPage: false,
          messageSource: 'design_continuation',
          ignoreComposerAttachments: true
        })
        const error = sent
          ? undefined
          : useDesignWorkspaceStore.getState().fileError || useChatStore.getState().error || undefined
        store.setPhase(requestId, {
          threadId,
          turnId,
          phase: sent ? 'running' : 'failed',
          ...(error ? { error } : {})
        })
      } catch (error) {
        store.setPhase(requestId, {
          threadId,
          turnId,
          phase: 'failed',
          error: error instanceof Error ? error.message : String(error)
        })
      } finally {
        dispatchingRef.current = false
      }
    }

    for (const requestId of store.takeManualStarts()) {
      const ref = refs.find((candidate) => candidate.request.requestId === requestId)
      const turnId = ref?.block.turnId?.trim()
      if (!ref || !turnId) continue
      void dispatch(ref, turnId)
      return
    }

    const waitingTurnIds = [...new Set(Object.values(store.records)
      .filter((record) =>
        record.phase === 'waiting' &&
        record.threadId === threadId &&
        record.sessionId === AGENT_DESIGN_SESSION_ID
      )
      .map((record) => record.turnId))]
    for (const turnId of waitingTurnIds) {
      const outcome = canvasLiveTurnOutcome({ threads: latestRef.current.threads, threadId, turnId })
      const { run, skip } = partitionTurnRequests(refs, turnId)
      if (outcome === 'unknown') {
        const retries = retriesRef.current.get(turnId) ?? 0
        if (retries < OUTCOME_MAX_RETRIES) {
          retriesRef.current.set(turnId, retries + 1)
          const timer = window.setTimeout(() => setOutcomeTick((tick) => tick + 1), OUTCOME_RETRY_MS)
          return () => window.clearTimeout(timer)
        }
      }
      retriesRef.current.delete(turnId)
      for (const ref of skip) {
        store.setPhase(ref.request.requestId, { threadId, turnId, phase: 'skipped' })
      }
      const runPhase = run ? store.records[run.request.requestId]?.phase : undefined
      if (outcome !== 'completed' || !run || (runPhase && runPhase !== 'waiting')) {
        for (const record of Object.values(store.records)) {
          if (record.turnId === turnId && record.phase === 'waiting') {
            store.setPhase(record.requestId, { threadId, turnId, phase: 'cancelled' })
          }
        }
        continue
      }
      void dispatch(run, turnId)
      return
    }
    return undefined
  }, [activeThreadId, blocks, busy, manualStarts, outcomeTick, queuedCount, records, runtimeConnection])
}
