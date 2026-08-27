import type {
  AgentProvider,
  ChatBlock,
  CompactionBlock,
  ThreadEventSink,
  ToolBlock,
  ToolEventPayload
} from '../agent/types'
import { DEFAULT_KUN_MODEL, MODEL_REASONING_EFFORTS } from '@shared/app-settings'
import type {
  ChatState,
  SideConversation,
  SideConversationDraftOptions,
  SidePanelState
} from './chat-store-types'
import {
  accountIdForComposerSelection,
  providerIdForComposerModel
} from './chat-store-helpers'
import { upsertUserBlock } from './chat-store-runtime-helpers'
import { monotonicToolStatus } from './chat-projection-reducer'
import { invalidateThreadSnapshot } from './thread-snapshot-cache'
import { serviceTierForComposerSelection } from '../components/chat/composer-fast-mode'
import {
  clearUnreadCompletion,
  completionIsCurrentlyVisible,
  markUnreadCompletion
} from './unread-completions'
import { unseenDeltaText } from './chat-projection-reducer-support'

export type SideContext = {
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void
  get: () => ChatState
  getProvider: () => AgentProvider
  /** i18n reference (kept loose; the host already imports the default). */
  t: (key: string) => string
  formatRuntimeError: (error: unknown) => string
  shouldOpenSettingsForError: (error: unknown) => boolean
}

type ActiveSideAbort = {
  sideId: string
  abort: AbortController
}

const sideAbortControllers = new Map<string, AbortController>()

function compactTitlePrefix(value: string): string {
  return Array.from(value.trim()).slice(0, 5).join('')
}

export function defaultSideTitle(parentTitle: string, parentThreadId: string): string {
  const trimmed = parentTitle.trim()
  if (trimmed) return `${compactTitlePrefix(trimmed)} · side`
  return `${parentThreadId.slice(0, 8)} · side`
}

export function defaultSideModel(state: ChatState, parentThreadId: string): string {
  const parent = state.threads.find((thread) => thread.id === parentThreadId)
  if (parent?.model) return parent.model
  if (state.composerModel) return state.composerModel
  return DEFAULT_KUN_MODEL
}

export function defaultSideProviderId(
  state: ChatState,
  parentThreadId: string,
  model: string
): string {
  const normalizedModel = model.trim().toLowerCase()
  const parent = state.threads.find((thread) => thread.id === parentThreadId)
  if (
    parent?.providerId?.trim() &&
    parent.model.trim().toLowerCase() === normalizedModel
  ) {
    return parent.providerId.trim()
  }
  if (
    state.composerProviderId.trim() &&
    state.composerModel.trim().toLowerCase() === normalizedModel
  ) {
    return state.composerProviderId.trim()
  }
  return providerIdForComposerModel(state.composerModelGroups, model)
}

export function sideReasoningEffortRequestValue(value: string): string | undefined {
  const normalized = value.trim().toLowerCase()
  return MODEL_REASONING_EFFORTS.includes(normalized as (typeof MODEL_REASONING_EFFORTS)[number])
    ? normalized
    : undefined
}

export function patchSide(
  state: ChatState,
  sideId: string,
  patch: (side: SideConversation) => SideConversation
): Partial<ChatState> {
  const current = state.sideConversations[sideId]
  if (!current) return {}
  return { sideConversations: { ...state.sideConversations, [sideId]: patch(current) } }
}

export function setSidePanel(panel: SidePanelState, patch: Partial<SidePanelState>): SidePanelState {
  return { ...panel, ...patch }
}

function flushSideLiveBlocks(side: SideConversation): { side: SideConversation; blocks: ChatBlock[] } {
  let nextBlocks = side.blocks
  let nextLiveReasoning = side.liveReasoning
  let nextLiveAssistant = side.liveAssistant
  if (nextLiveReasoning) {
    const block: ChatBlock = {
      kind: 'reasoning',
      id: side.liveReasoningItemId ?? `live_reasoning_${side.lastSeq || Date.now()}`,
      turnId: side.liveReasoningTurnId ?? side.turnId ?? undefined,
      createdAt: side.liveReasoningCreatedAt ?? new Date().toISOString(),
      text: nextLiveReasoning
    }
    nextBlocks = upsertSideTimelineBlock(nextBlocks, block)
    nextLiveReasoning = ''
  }
  if (nextLiveAssistant) {
    const block: ChatBlock = {
      kind: 'assistant',
      id: side.liveAssistantItemId ?? `live_assistant_${side.lastSeq || Date.now()}`,
      turnId: side.liveAssistantTurnId ?? side.turnId ?? undefined,
      createdAt: side.liveAssistantCreatedAt ?? new Date().toISOString(),
      text: nextLiveAssistant
    }
    nextBlocks = upsertSideTimelineBlock(nextBlocks, block)
    nextLiveAssistant = ''
  }
  if (nextBlocks === side.blocks) return { side, blocks: nextBlocks }
  return {
    side: {
      ...side,
      blocks: nextBlocks,
      liveReasoning: nextLiveReasoning,
      liveAssistant: nextLiveAssistant,
      liveReasoningItemId: undefined,
      liveReasoningTurnId: undefined,
      liveReasoningCreatedAt: undefined,
      liveAssistantItemId: undefined,
      liveAssistantTurnId: undefined,
      liveAssistantCreatedAt: undefined
    },
    blocks: nextBlocks
  }
}

function upsertSideTimelineBlock(blocks: ChatBlock[], incoming: ChatBlock): ChatBlock[] {
  const index = blocks.findIndex(
    (block) => block.kind === incoming.kind && block.id === incoming.id
  )
  if (index < 0) return [...blocks, incoming]
  const current = blocks[index]
  if (
    (
      (current.kind === 'assistant' && incoming.kind === 'assistant') ||
      (current.kind === 'reasoning' && incoming.kind === 'reasoning')
    ) &&
    current.turnId === incoming.turnId &&
    current.createdAt === incoming.createdAt &&
    current.text === incoming.text
  ) return blocks
  const next = [...blocks]
  next[index] = incoming
  return next
}

function buildSideSink(sideId: string, ctx: SideContext, sinceSeq = 0): ThreadEventSink {
  // Replayed or re-delivered deltas duplicate text already on screen;
  // drop anything at or below the subscription's replay floor.
  let appliedDeltaSeqFloor = sinceSeq
  return {
    onSeq: (seq) => {
      ctx.set((s) => patchSide(s, sideId, (side) => ({ ...side, lastSeq: Math.max(side.lastSeq, seq) })))
    },
    onUserMessage: (ev) => {
      ctx.set((s) =>
        patchSide(s, sideId, (side) => {
          const flushed = flushSideLiveBlocks(side)
          const blocks = upsertUserBlock(flushed.blocks, ev)
          return {
            ...flushed.side,
            blocks,
            busy: true,
            turnId: ev.turnId ?? side.turnId,
            userItemId: ev.itemId
          }
        })
      )
    },
    onDeltas: (rawDeltas) => {
      const deltas: typeof rawDeltas = []
      for (const delta of rawDeltas) {
        if (delta.threadId && delta.threadId !== sideId) continue
        if (typeof delta.seq === 'number') {
          if (delta.seq <= appliedDeltaSeqFloor) continue
          appliedDeltaSeqFloor = delta.seq
        }
        deltas.push(delta)
      }
      if (deltas.length === 0) return
      ctx.set((s) =>
        patchSide(s, sideId, (side) => {
          const seqs = deltas
            .map((delta) => delta.seq)
            .filter((value): value is number => typeof value === 'number')
          const lastSeq = seqs.length > 0 ? Math.max(side.lastSeq, ...seqs) : side.lastSeq
          let liveReasoning = side.liveReasoning
          let liveReasoningItemId = side.liveReasoningItemId
          let liveReasoningTurnId = side.liveReasoningTurnId
          let liveReasoningCreatedAt = side.liveReasoningCreatedAt
          let liveAssistant = side.liveAssistant
          let liveAssistantItemId = side.liveAssistantItemId
          let liveAssistantTurnId = side.liveAssistantTurnId
          let liveAssistantCreatedAt = side.liveAssistantCreatedAt
          let blocks = side.blocks
          for (const delta of deltas) {
            if (delta.kind === 'agent_reasoning') {
              const text = unseenDeltaText(
                delta,
                blocks,
                liveReasoning,
                liveReasoningItemId
              )
              if (!text) continue
              if (delta.itemId && liveReasoningItemId && delta.itemId !== liveReasoningItemId) {
                if (liveReasoning.trim()) {
                  blocks = upsertSideTimelineBlock(blocks, {
                    kind: 'reasoning',
                    id: liveReasoningItemId,
                    turnId: liveReasoningTurnId,
                    createdAt: liveReasoningCreatedAt,
                    text: liveReasoning
                  })
                }
                liveReasoning = ''
              }
              liveReasoningItemId = delta.itemId ?? liveReasoningItemId
              liveReasoningTurnId = delta.turnId ?? liveReasoningTurnId ?? side.turnId ?? undefined
              liveReasoningCreatedAt = delta.createdAt ?? liveReasoningCreatedAt
              liveReasoning += text
            } else {
              const text = unseenDeltaText(
                delta,
                blocks,
                liveAssistant,
                liveAssistantItemId
              )
              if (!text) continue
              if (delta.itemId && liveAssistantItemId && delta.itemId !== liveAssistantItemId) {
                if (liveAssistant.trim()) {
                  blocks = upsertSideTimelineBlock(blocks, {
                    kind: 'assistant',
                    id: liveAssistantItemId,
                    turnId: liveAssistantTurnId,
                    createdAt: liveAssistantCreatedAt,
                    text: liveAssistant
                  })
                }
                liveAssistant = ''
              }
              liveAssistantItemId = delta.itemId ?? liveAssistantItemId
              liveAssistantTurnId = delta.turnId ?? liveAssistantTurnId ?? side.turnId ?? undefined
              liveAssistantCreatedAt = delta.createdAt ?? liveAssistantCreatedAt
              liveAssistant += text
            }
          }
          return {
            ...side,
            blocks,
            lastSeq,
            liveReasoning,
            liveReasoningItemId,
            liveReasoningTurnId,
            liveReasoningCreatedAt,
            liveAssistant,
            liveAssistantItemId,
            liveAssistantTurnId,
            liveAssistantCreatedAt,
            busy: true
          }
        })
      )
    },
    onAssistantItem: (item) => {
      if (item.threadId !== sideId) return
      ctx.set((s) =>
        patchSide(s, sideId, (side) => {
          const block: ChatBlock = item.kind === 'agent_message'
            ? {
                kind: 'assistant',
                id: item.itemId,
                turnId: item.turnId,
                createdAt: item.createdAt,
                text: item.text
              }
            : {
                kind: 'reasoning',
                id: item.itemId,
                turnId: item.turnId,
                createdAt: item.createdAt,
                text: item.text
              }
          const next = { ...side, blocks: upsertSideTimelineBlock(side.blocks, block) }
          if (item.kind === 'agent_message' && side.liveAssistantItemId === item.itemId) {
            next.liveAssistant = ''
            next.liveAssistantItemId = undefined
            next.liveAssistantTurnId = undefined
            next.liveAssistantCreatedAt = undefined
          }
          if (item.kind === 'agent_reasoning' && side.liveReasoningItemId === item.itemId) {
            next.liveReasoning = ''
            next.liveReasoningItemId = undefined
            next.liveReasoningTurnId = undefined
            next.liveReasoningCreatedAt = undefined
          }
          return next
        })
      )
    },
    onTool: (ev: ToolEventPayload) => {
      ctx.set((s) =>
        patchSide(s, sideId, (side) => {
          const idx = side.blocks.findIndex((b) => b.kind === 'tool' && b.id === ev.itemId)
          let blocks: ChatBlock[]
          if (idx >= 0) {
            const cur = side.blocks[idx]
            if (cur.kind !== 'tool') return side
            const next: ToolBlock = {
              ...cur,
              turnId: ev.turnId ?? cur.turnId,
              summary: ev.summary || cur.summary,
              status: monotonicToolStatus(cur.status, ev.status),
              toolKind: ev.toolKind ?? cur.toolKind,
              detail: ev.detail ?? cur.detail,
              filePath: ev.filePath ?? cur.filePath,
              meta: ev.meta ?? cur.meta
            }
            blocks = [...side.blocks]
            blocks[idx] = next
          } else {
            const block: ToolBlock = {
              kind: 'tool',
              id: ev.itemId,
              turnId: ev.turnId,
              createdAt: ev.createdAt ?? new Date().toISOString(),
              summary: ev.summary,
              status: ev.status,
              toolKind: ev.toolKind,
              detail: ev.detail,
              filePath: ev.filePath,
              meta: ev.meta
            }
            blocks = [...side.blocks, block]
          }
          return { ...side, blocks, busy: true }
        })
      )
    },
    onCompaction: (ev) => {
      ctx.set((s) =>
        patchSide(s, sideId, (side) => {
          const index = side.blocks.findIndex(
            (block) => block.kind === 'compaction' && block.id === ev.itemId
          )
          const current = index >= 0 ? side.blocks[index] : undefined
          const block: CompactionBlock = {
            kind: 'compaction',
            id: ev.itemId,
            turnId: ev.turnId,
            createdAt: current?.kind === 'compaction'
              ? current.createdAt
              : ev.createdAt ?? new Date().toISOString(),
            summary: ev.summary || (current?.kind === 'compaction' ? current.summary : ''),
            status: ev.status,
            detail: ev.detail ?? (current?.kind === 'compaction' ? current.detail : undefined),
            auto: ev.auto ?? (current?.kind === 'compaction' ? current.auto : undefined),
            messagesBefore: ev.messagesBefore ?? (current?.kind === 'compaction' ? current.messagesBefore : undefined),
            messagesAfter: ev.messagesAfter ?? (current?.kind === 'compaction' ? current.messagesAfter : undefined)
          }
          const blocks = [...side.blocks]
          if (index >= 0) blocks[index] = block
          else blocks.push(block)
          return { ...side, blocks }
        })
      )
    },
    onApproval: (req) => {
      ctx.set((s) =>
        patchSide(s, sideId, (side) => ({
          ...side,
          blocks: [
            ...side.blocks,
            {
              kind: 'approval',
              id: `approval-${req.approvalId}`,
              turnId: req.turnId,
              createdAt: req.createdAt ?? new Date().toISOString(),
              approvalId: req.approvalId,
              summary: req.summary,
              toolName: req.toolName,
              status: 'pending',
              ...(req.meta ? { meta: req.meta } : {})
            }
          ]
        }))
      )
    },
    onApprovalStatus: (ev) => {
      ctx.set((s) =>
        patchSide(s, sideId, (side) => ({
          ...side,
          blocks: side.blocks.map((block) =>
            block.kind === 'approval' && block.approvalId === ev.approvalId
              ? {
                  ...block,
                  status: ev.status,
                  errorMessage: ev.errorMessage ?? block.errorMessage
                }
              : block
          )
        }))
      )
    },
    onApprovalReview: (ev) => {
      ctx.set((s) =>
        patchSide(s, sideId, (side) => {
          const id = `approval-review-${ev.reviewId}`
          const current = side.blocks.find(
            (block): block is Extract<ChatBlock, { kind: 'approval_review' }> =>
              block.kind === 'approval_review' && block.reviewId === ev.reviewId
          )
          return {
            ...side,
            blocks: upsertSideTimelineBlock(side.blocks, {
              kind: 'approval_review',
              id,
              reviewId: ev.reviewId,
              approvalId: ev.approvalId,
              turnId: ev.turnId ?? current?.turnId,
              createdAt: current?.createdAt ?? ev.createdAt ?? new Date().toISOString(),
              summary: ev.summary || current?.summary || 'Tool action',
              toolName: ev.toolName ?? current?.toolName,
              status: ev.status,
              decision: ev.decision ?? current?.decision,
              riskLevel: ev.riskLevel ?? current?.riskLevel,
              rationale: ev.rationale ?? current?.rationale
            })
          }
        })
      )
    },
    onUserInput: (req) => {
      ctx.set((s) =>
        patchSide(s, sideId, (side) => ({
          ...side,
          blocks: [
            ...side.blocks,
            {
              kind: 'user_input',
              id: req.itemId,
              turnId: req.turnId,
              createdAt: req.createdAt ?? new Date().toISOString(),
              requestId: req.requestId,
              questions: req.questions,
              ...(req.timeoutSeconds !== undefined ? { timeoutSeconds: req.timeoutSeconds } : {}),
              status: 'pending',
              live: true
            }
          ]
        }))
      )
    },
    onUserInputStatus: (ev) => {
      ctx.set((s) =>
        patchSide(s, sideId, (side) => ({
          ...side,
          blocks: side.blocks.map((block) =>
            block.kind === 'user_input' && block.id === ev.itemId
              ? {
                  ...block,
                  status: ev.status,
                  live: false,
                  ...(ev.answers ? { answers: ev.answers } : {})
                }
              : block
          )
        }))
      )
    },
    onGoal: () => {
      // Side conversations do not render goal chips yet.
    },
    onTodos: () => {
      // Side conversations do not render runtime todo chips yet.
    },
    onTurnComplete: () => {
      const completedTurnId = ctx.get().sideConversations[sideId]?.turnId
      ctx.set((s) => {
        const sidePatch = patchSide(s, sideId, (side) => {
          const flushed = flushSideLiveBlocks(side)
          return { ...flushed.side, busy: false, turnId: null }
        })
        return {
          ...sidePatch,
          unreadThreadIds: completionIsCurrentlyVisible(s, sideId)
            ? clearUnreadCompletion(s.unreadThreadIds, sideId)
            : markUnreadCompletion(s.unreadThreadIds, sideId)
        }
      })
      void reconcileCompletedSideTurn(sideId, completedTurnId, ctx)
    },
    onError: (err, options) => {
      const completedTurnId = ctx.get().sideConversations[sideId]?.turnId
      ctx.set((s) =>
        patchSide(s, sideId, (side) => ({
          ...side,
          busy: false,
          error: ctx.formatRuntimeError(err)
        }))
      )
      if (options?.terminal) void reconcileCompletedSideTurn(sideId, completedTurnId, ctx)
    },
    onUsage: (usage) => {
      // Side usage is reported only to keep lastSeq cursors consistent;
      // a per-thread usage counter can be wired here in the future.
      void usage
    }
  }
}

async function reconcileCompletedSideTurn(
  sideId: string,
  completedTurnId: string | null | undefined,
  ctx: SideContext
): Promise<void> {
  try {
    const detail = await ctx.getProvider().getThreadDetail(sideId)
    ctx.set((state) =>
      patchSide(state, sideId, (side) => {
        if (side.busy || side.turnId) return side
        const hasCompletedTurn = !completedTurnId || detail.blocks.some(
          (block) => block.turnId === completedTurnId
        )
        if (!hasCompletedTurn) return side
        return {
          ...side,
          blocks: detail.blocks,
          lastSeq: Math.max(side.lastSeq, detail.latestSeq),
          liveReasoning: '',
          liveAssistant: '',
          liveReasoningItemId: undefined,
          liveReasoningTurnId: undefined,
          liveReasoningCreatedAt: undefined,
          liveAssistantItemId: undefined,
          liveAssistantTurnId: undefined,
          liveAssistantCreatedAt: undefined
        }
      })
    )
  } catch {
    // The live projection remains visible; the next side-thread reload retries
    // from the persisted runtime snapshot.
  }
}

export function teardownSideSubscription(sideId: string): void {
  const ac = sideAbortControllers.get(sideId)
  if (ac) {
    ac.abort()
    sideAbortControllers.delete(sideId)
  }
}

export function startSideSubscription(sideId: string, sinceSeq: number, ctx: SideContext): void {
  teardownSideSubscription(sideId)
  const ac = new AbortController()
  sideAbortControllers.set(sideId, ac)
  const sink = buildSideSink(sideId, ctx, sinceSeq)
  const provider = ctx.getProvider()
  void provider.subscribeThreadEvents(sideId, sinceSeq, sink, ac.signal)
}

/**
 * Internal helper: tear down all side subscriptions. Used by the
 * `boot`/`unmount` path to avoid dangling SSE streams on app shutdown.
 */
export function teardownAllSideSubscriptions(): void {
  for (const ac of sideAbortControllers.values()) ac.abort()
  sideAbortControllers.clear()
}
