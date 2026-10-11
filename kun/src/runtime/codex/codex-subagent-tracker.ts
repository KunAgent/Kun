/**
 * Codex subagents (multi-agent `collabAgentToolCall`).
 *
 * `spawnAgent` becomes one subagent card on the parent turn. The parent's
 * follow-up collab calls on that agent (`wait`, `sendInput`, `resumeAgent`,
 * `closeAgent`) and `subAgentActivity` items fold into the same card instead
 * of rendering as separate rows. Notifications of a spawned agent's own
 * thread (which the parent mapper used to drop) are mapped by a child mapper
 * onto the agent's hidden side thread.
 */
import {
  EXTERNAL_SUBAGENT_META_KEY,
  clipExternalText,
  externalSubagentThreadId,
  externalSubagentTurnId,
  isTerminalExternalSubagentStatus,
  type ExternalSubagentPresentation,
  type ExternalSubagentStatus
} from '../../contracts/external-subagent.js'
import type { TurnItem } from '../../contracts/items.js'
import { makeToolCallItem, makeToolResultItem } from '../../domain/item.js'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'
import { describeToolActivity } from '../external-subagent-activity.js'
import { CODEX_NOTIFICATIONS, type CodexThreadItem } from './codex-protocol.js'

const UPDATE_INTERVAL_MS = 1_000

export type CodexChildMapper = { mapNotification(method: string, params: unknown): RuntimeEventDraft[] }

export type CodexSubagentTrackerContext = {
  threadId: string
  turnId: string
  kunItemId(codexItemId: string): string
  createChildMapper(childThreadId: string, childTurnId: string, codexThreadId: string, model?: string): CodexChildMapper
  nowMs?: () => number
  nowIso?: () => string
}

type AgentState = {
  presentation: ExternalSubagentPresentation
  item: TurnItem
  mapper?: CodexChildMapper
  lastEmitMs: number
  startedMs: number
  lastMessage?: string
}

type Collab = {
  id: string
  tool?: string
  status?: string
  prompt?: string | null
  model?: string | null
  receiverThreadIds?: string[]
  agentsStates?: Record<string, { status?: string; message?: string | null } | undefined>
}

export class CodexSubagentTracker {
  private readonly bySpawn = new Map<string, AgentState>()
  private readonly byAgentThread = new Map<string, AgentState>()
  private readonly nowMs: () => number
  private readonly nowIso: () => string

  constructor(private readonly ctx: CodexSubagentTrackerContext) {
    this.nowMs = ctx.nowMs ?? Date.now
    this.nowIso = ctx.nowIso ?? (() => new Date().toISOString())
  }

  /** Drafts for a collab item; undefined keeps the generic tool mapping. */
  handleItem(phase: 'started' | 'completed', item: CodexThreadItem): RuntimeEventDraft[] | undefined {
    if (item.type === 'subAgentActivity') return this.activity(item as unknown as Record<string, unknown>)
    if (item.type !== 'collabAgentToolCall') return undefined
    const collab = item as unknown as Collab
    if (collab.tool === 'spawnAgent') return this.spawn(phase, collab)
    const states = (collab.receiverThreadIds ?? []).map((id) => this.byAgentThread.get(id)).filter(Boolean) as AgentState[]
    if (!states.length) return undefined
    if (phase === 'started') return []
    return states.flatMap((state) => {
      const agentThreadId = state.presentation.nativeId!
      const patch: Partial<ExternalSubagentPresentation> = this.fromAgentState(collab.agentsStates?.[agentThreadId])
      if (collab.tool === 'wait') patch.progressChecks = (state.presentation.progressChecks ?? 0) + 1
      if (collab.tool === 'closeAgent') {
        patch.closedByParent = true
        if (!isTerminalExternalSubagentStatus(patch.status ?? state.presentation.status)) patch.status = 'aborted'
      }
      if (collab.tool === 'resumeAgent' && !patch.status) patch.status = 'running'
      return this.update(state, patch, true)
    })
  }

  /** A notification from another Codex thread: a spawned agent's own steps. */
  routeForeign(method: string, params: Record<string, unknown>): RuntimeEventDraft[] {
    const state = typeof params.threadId === 'string' ? this.byAgentThread.get(params.threadId) : undefined
    if (!state) return []
    if (method === CODEX_NOTIFICATIONS.turnStarted) return this.update(state, { status: 'running' }, true)
    if (method === CODEX_NOTIFICATIONS.turnCompleted) {
      const turn = params.turn as { status?: string; error?: { message?: string } | null } | undefined
      const status: ExternalSubagentStatus = turn?.status === 'completed' ? 'completed'
        : turn?.status === 'interrupted' ? 'aborted' : 'failed'
      return this.update(state, {
        status,
        ...optional(status === 'completed' ? 'summary' : 'error',
          clipExternalText(status === 'completed' ? state.lastMessage : turn?.error?.message, status === 'completed' ? 4000 : 1000)),
        durationMs: Math.max(0, this.nowMs() - state.startedMs)
      }, true)
    }
    const childThreadId = state.presentation.childThreadId!
    state.mapper ??= this.ctx.createChildMapper(childThreadId, externalSubagentTurnId(childThreadId),
      state.presentation.nativeId!, state.presentation.model)
    // Only items: the child's own usage reports must not count against this thread.
    const drafts = state.mapper.mapNotification(method, params).filter((draft) => 'item' in draft && draft.item)
    const patch: Partial<ExternalSubagentPresentation> = {}
    for (const draft of drafts) {
      const item = (draft as { item: TurnItem }).item
      if (draft.kind === 'tool_call_started' && item.kind === 'tool_call') {
        patch.steps = (patch.steps ?? state.presentation.steps ?? 0) + 1
        patch.activity = describeToolActivity(item.toolName, item.arguments)
      }
      if (item.kind === 'assistant_text' && item.status === 'completed' && item.text.trim()) state.lastMessage = item.text
    }
    return Object.keys(patch).length ? [...drafts, ...this.update(state, patch, false)] : drafts
  }

  private spawn(phase: 'started' | 'completed', collab: Collab): RuntimeEventDraft[] {
    let state = this.bySpawn.get(collab.id)
    const kunId = this.ctx.kunItemId(collab.id)
    if (!state) {
      const presentation: ExternalSubagentPresentation = {
        version: 1,
        source: 'codex',
        childThreadId: externalSubagentThreadId(this.ctx.threadId, collab.id),
        profile: 'agent',
        ...optional('label', clipExternalText(firstLine(collab.prompt), 160)),
        ...optional('model', clipExternalText(collab.model, 200)),
        status: 'queued',
        detached: true,
        steps: 0,
        startedAt: this.nowIso()
      }
      const call = makeToolCallItem({
        id: kunId,
        turnId: this.ctx.turnId,
        threadId: this.ctx.threadId,
        callId: collab.id,
        toolName: 'spawn_agent',
        toolKind: 'tool_call',
        arguments: { ...(collab.prompt ? { prompt: collab.prompt } : {}), ...(collab.model ? { model: collab.model } : {}) },
        status: 'running'
      })
      state = { presentation, item: withPresentation(call, presentation), lastEmitMs: 0, startedMs: this.nowMs() }
      this.bySpawn.set(collab.id, state)
      if (phase === 'started') {
        return [{ kind: 'tool_call_started', threadId: this.ctx.threadId, turnId: this.ctx.turnId, item: state.item }]
      }
    }
    if (phase === 'started') return []
    const agentThreadId = collab.receiverThreadIds?.[0]
    const failed = collab.status === 'failed' || !agentThreadId
    if (agentThreadId) this.byAgentThread.set(agentThreadId, state)
    state.presentation = {
      ...state.presentation,
      ...optional('nativeId', clipExternalText(agentThreadId, 256)),
      ...(failed ? { status: 'failed' as const } : { status: 'running' as const, ...this.fromAgentState(collab.agentsStates?.[agentThreadId!]) })
    }
    state.item = withPresentation(makeToolResultItem({
      id: `${kunId}_result`,
      turnId: this.ctx.turnId,
      threadId: this.ctx.threadId,
      callId: collab.id,
      toolName: 'spawn_agent',
      toolKind: 'tool_call',
      output: { receiverThreadIds: collab.receiverThreadIds ?? [] },
      isError: failed,
      status: failed ? 'failed' : 'completed'
    }), state.presentation)
    return [{ kind: 'tool_call_finished', threadId: this.ctx.threadId, turnId: this.ctx.turnId, item: state.item }]
  }

  private activity(record: Record<string, unknown>): RuntimeEventDraft[] {
    const state = typeof record.agentThreadId === 'string' ? this.byAgentThread.get(record.agentThreadId) : undefined
    if (!state) return []
    const path = typeof record.agentPath === 'string' ? record.agentPath.split('/').filter(Boolean).pop() : undefined
    return this.update(state, {
      ...optional('profile', clipExternalText(path, 200)),
      ...(record.kind === 'interrupted' ? { status: 'aborted' as const } : {})
    }, true)
  }

  private fromAgentState(agent: { status?: string; message?: string | null } | undefined): Partial<ExternalSubagentPresentation> {
    if (!agent?.status) return {}
    const status: ExternalSubagentStatus | undefined = agent.status === 'pendingInit' ? 'queued'
      : agent.status === 'running' ? 'running'
        : agent.status === 'completed' ? 'completed'
          : agent.status === 'errored' || agent.status === 'notFound' ? 'failed'
            : agent.status === 'interrupted' || agent.status === 'shutdown' ? 'aborted' : undefined
    if (!status) return {}
    const message = clipExternalText(agent.message, status === 'completed' ? 4000 : 1000)
    return { status, ...(message ? status === 'failed' ? { error: message } : status === 'completed' ? { summary: message } : {} : {}) }
  }

  private update(state: AgentState, patch: Partial<ExternalSubagentPresentation>, force: boolean): RuntimeEventDraft[] {
    if (isTerminalExternalSubagentStatus(state.presentation.status) && !patch.status && !patch.progressChecks && !patch.profile) return []
    state.presentation = { ...state.presentation, ...patch }
    const now = this.nowMs()
    if (!force && now - state.lastEmitMs < UPDATE_INTERVAL_MS) return []
    state.lastEmitMs = now
    state.item = withPresentation(state.item, state.presentation)
    return [{ kind: 'item_updated', threadId: this.ctx.threadId, turnId: this.ctx.turnId, itemId: state.item.id, item: state.item }]
  }
}

function withPresentation(item: TurnItem, presentation: ExternalSubagentPresentation): TurnItem {
  const meta = 'meta' in item && item.meta ? item.meta : {}
  return { ...item, meta: { ...meta, [EXTERNAL_SUBAGENT_META_KEY]: presentation } } as TurnItem
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }
}

function firstLine(text: string | null | undefined): string | undefined {
  return text?.split('\n').map((line) => line.trim()).find(Boolean)
}
