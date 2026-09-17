import { codexReferenceRevision, sourceHistoryAllowed } from '../history-reference/codex-reference-state'
import { kunThreadPath, kunThreadTimelinePath } from '@shared/kun-endpoints'
import { runtimeErrorToError } from '@shared/runtime-error'
import type { ThreadDetail } from './types'
import type { CoreThreadTimelineJson } from './kun-contract'
import { chatBlockFromItem, goalFromCore, mergeChatBlocks, todosFromCore } from './kun-mapper'
import { restoredThreadLiveProjection } from './kun-runtime-thread-live-projection'
import { rendererRuntimeClient } from './runtime-client'
import { readRuntimeError, readRuntimeJson } from './kun-runtime-services'
import { buildTurnDurationByUserId, resolveRunningTurnStartedAtMs } from './thread-timing'

export async function getKunThreadDetail(threadId: string, options: {
  before?: string
  turnId?: string
  itemId?: string
  signal?: AbortSignal
  priority?: 'foreground' | 'background'
} = {}): Promise<ThreadDetail> {
  const historyRevision = codexReferenceRevision()
  const timelinePath = kunThreadTimelinePath(threadId, {
      ...(options.turnId ? { turnId: options.turnId } : {}),
      ...(options.itemId ? { itemId: options.itemId } : {}),
      ...(options.before ? { before: options.before } : {}),
      limit: 300
    })
  let response = await rendererRuntimeClient.runtimeRequest(
    historyRevision > 0 ? `${timelinePath}&historyRevision=${historyRevision}` : timelinePath,
    'GET',
    undefined,
    { signal: options.signal, priority: options.priority }
  )
  // A renderer can briefly outlive an older bundled runtime during a local
  // restart. Preserve initial hydration compatibility until that runtime is
  // replaced; older-page requests require the new timeline contract.
  if (
    !response.ok &&
    !options.before &&
    !options.turnId &&
    !options.itemId &&
    (response.status === 404 || response.status === 405)
  ) {
    response = await rendererRuntimeClient.runtimeRequest(
      kunThreadPath(threadId),
      'GET',
      undefined,
      { signal: options.signal, priority: options.priority }
    )
  }
  if (historyRevision !== codexReferenceRevision()) {
    if (options.before || options.turnId || options.itemId) throw new DOMException('History settings changed', 'AbortError')
    return getKunThreadDetail(threadId, options)
  }
  if (!response.ok) {
    const error = runtimeErrorToError(readRuntimeError(response.body, 'failed to load thread'))
    if (response.status === 503) Object.assign(error, { status: 503, retryable: true })
    throw error
  }
  const thread = readRuntimeJson<CoreThreadTimelineJson>(
    response.body,
    'runtime returned an invalid thread response'
  )
  const turns = (Array.isArray(thread.turns) ? thread.turns : [])
    .filter((turn) => sourceHistoryAllowed(turn.id) || !/^(codex|claude-code|opencode):/u.test(turn.id))
  const items = turns.filter((turn) => turn.status !== 'queued').flatMap((turn) =>
    (turn.items ?? []).map((item) => ({
      ...item,
      attachmentIds: turn.attachmentIds,
      activeSkillIds: turn.activeSkillIds,
      injectedMemoryIds: turn.injectedMemoryIds,
      injectedMemorySummaries: turn.injectedMemorySummaries,
      skillInjectionBytes: turn.skillInjectionBytes,
      injectedInstructionSources: turn.injectedInstructionSources,
      instructionInjectionBytes: turn.instructionInjectionBytes,
      mode: turn.mode === 'plan' || turn.mode === 'agent' ? turn.mode : undefined,
      guiDesignCanvas: turn.guiDesignCanvas,
      guiExcalidrawCanvas: turn.guiExcalidrawCanvas,
      guiDesignMode: turn.guiDesignMode,
      designProfile: item.designProfile ?? turn.designProfile,
      designDocumentTarget: item.designDocumentTarget ?? turn.designDocumentTarget,
      workspaceCheckpointId: item.workspaceCheckpointId ?? turn.workspaceCheckpointId
    }))
  )
  // Explicit null means this branch has no native turn yet. Source history
  // remains display-only even when a legacy response omits native metadata.
  const nativeTurns = turns.filter((turn) => !/^(codex|claude-code|opencode):/u.test(turn.id))
  const latestTurn = thread.latestTurn === undefined ? nativeTurns.at(-1) : thread.latestTurn
  const activeTurn = thread.activeTurn === undefined
    ? nativeTurns.find((turn) => turn.status === 'running') : thread.activeTurn
  const restoredLive = restoredThreadLiveProjection(
    items,
    activeTurn?.id,
    activeTurn?.status
  )
  const blocks = mergeChatBlocks(items.flatMap((item) => {
    if (restoredLive.liveItemIds.has(item.id)) return []
    const block = chatBlockFromItem(item)
    return block ? [block] : []
  }))
  // Re-derive the live ask-user flag from the runtime's pending gate so a
  // request the agent is still awaiting stays answerable after a rehydration
  // (thread switch, SSE recovery, restart) — and a stale `pending` item from a
  // finished thread, whose gate entry is gone, stays a read-only record (#606).
  const pendingUserInputIds = new Set(
    Array.isArray(thread.pendingUserInputIds) ? thread.pendingUserInputIds : []
  )
  if (pendingUserInputIds.size > 0) {
    for (const block of blocks) {
      if (block.kind === 'user_input' && pendingUserInputIds.has(block.requestId)) {
        block.live = true
      }
    }
  }
  // Manual approval history is event-sourced. A recovered snapshot includes
  // the currently live approval-gate ids, which distinguish an actionable
  // pending request from one that expired while the GUI was disconnected
  // (for example after an SSE 404).
  if (Array.isArray(thread.pendingApprovalIds)) {
    const pendingApprovalIds = new Set(thread.pendingApprovalIds)
    for (const block of blocks) {
      if (
        block.kind === 'approval' &&
        block.status === 'pending' &&
        !pendingApprovalIds.has(block.approvalId)
      ) {
        block.status = 'expired'
      }
    }
  }
  const latestTurnId = activeTurn?.id ?? latestTurn?.id
  // Prefer the active turn's opening user message: a long running turn may
  // push its own prompt to the front of the page (timeline anchor) while
  // later background/steering user items are appended after it. The anchor
  // keeps the real request visible; the reverse scan is the legacy fallback
  // for older runtimes that did not anchor the page.
  const latestUserMessageId = latestTurnId
    ? items.find(
        (item) => item.turnId === latestTurnId && item.kind === 'user_message'
      )?.id
    : undefined
  const resolvedLatestUserMessageId =
    latestUserMessageId ?? [...items].reverse().find((item) =>
      item.kind === 'user_message' && !/^(codex|claude-code|opencode):/u.test(item.turnId ?? ''))?.id
  return {
    ...(thread.activeTurn !== undefined ? { activeTurn: thread.activeTurn ? {
      id: thread.activeTurn.id, status: thread.activeTurn.status,
      orchestration: thread.activeTurn.orchestration === 'graph' ? 'graph' as const : 'direct' as const
    } : null } : {}),
    blocks,
    latestSeq: thread.latestSeq ?? 0,
    ...(restoredLive.liveProjection ? { liveProjection: restoredLive.liveProjection } : {}),
    threadStatus: thread.status ?? latestTurn?.status,
    latestTurnId: latestTurn?.id,
    latestTurnStatus: latestTurn?.status,
    latestTurnOrchestration: latestTurn
      ? latestTurn.orchestration === 'graph' ? 'graph' : 'direct'
      : undefined,
    latestUserMessageId: resolvedLatestUserMessageId,
    turnDurationByUserId: buildTurnDurationByUserId(turns),
    ...(latestTurn
      ? (() => {
          const startedAtMs = resolveRunningTurnStartedAtMs([latestTurn])
          return startedAtMs !== undefined ? { latestTurnStartedAtMs: startedAtMs } : {}
        })()
      : {}),
    relation: thread.relation,
    ...(thread.parentThreadId ? { parentThreadId: thread.parentThreadId } : {}),
    ...(typeof thread.model === 'string' && thread.model.trim() ? { model: thread.model.trim() } : {}),
    goal: thread.goal ? goalFromCore(thread.goal) : null,
    todos: thread.todos ? todosFromCore(thread.todos) : null,
    payloadBytes: response.body.length,
    ...(thread.timeline?.nextCursor ? { historyCursor: thread.timeline.nextCursor } : {}),
    hasMoreHistory: thread.timeline?.hasMore === true,
    ...(thread.timeline?.target && sourceHistoryAllowed() ? { historyTarget: thread.timeline.target } : {}),
    ...(thread.designProfile ? { designProfile: thread.designProfile } : {}),
    ...(thread.additionalWorkspaces?.length
      ? { additionalWorkspaces: thread.additionalWorkspaces.slice() }
      : {})
  }
}
