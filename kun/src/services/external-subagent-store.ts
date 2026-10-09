import type { TurnItem } from '../contracts/items.js'
import type { ThreadRecord } from '../contracts/threads.js'
import {
  externalSubagentTurnId,
  isTerminalExternalSubagentStatus,
  readExternalSubagent,
  type ExternalSubagentPresentation,
  type ExternalSubagentSource
} from '../contracts/external-subagent.js'
import { makeUserItem } from '../domain/item.js'
import { appendTurnItem, createTurnRecord, finishTurn, startTurn } from '../domain/turn.js'
import { finalizeOpenTurnItem, type FinishedTurnStatus } from '../domain/turn-item-finalization.js'
import { createThreadRecord } from '../domain/thread.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { RuntimeEventDraft } from './runtime-event-recorder.js'

export type ExternalSubagentStoreDeps = {
  threadStore: ThreadStore
  sessionStore: SessionStore
  events: { record(draft: RuntimeEventDraft): Promise<unknown> }
  nowIso?: () => string
}

const SOURCE_HARNESS: Record<ExternalSubagentSource, string> = {
  opencode: 'opencode',
  opencode2: 'opencode2',
  codemaker: 'codemaker',
  codex: 'codex',
  'claude-code': 'claude-code',
  devin: 'devin'
}

const LIVE_ITEM_KINDS = new Set(['assistant_text', 'assistant_reasoning'])

/**
 * Mirrors an external Agent's subagent into a hidden `side` thread of the
 * parent, the same shape Kun's own subagents persist: one turn whose first
 * item is the delegated prompt, followed by the subagent's steps. The GUI then
 * opens and previews it with the ordinary thread detail and SSE paths.
 *
 * Lifecycle comes from the parent tool item's presentation (first sight
 * creates the thread, a terminal status closes its turn); steps arrive as
 * ordinary item drafts addressed to the child thread. Writes for one child
 * are serialized; nothing here runs a model.
 */
export class ExternalSubagentStore {
  private readonly queues = new Map<string, Promise<unknown>>()
  /** Latest parent item of every subagent that has not reached a terminal status. */
  private readonly openParents = new Map<string, TurnItem>()
  private readonly nowIso: () => string

  constructor(private readonly deps: ExternalSubagentStoreDeps) {
    this.nowIso = deps.nowIso ?? (() => new Date().toISOString())
  }

  /** Create or settle the child thread described by a parent tool item. */
  async syncParentItem(item: TurnItem): Promise<void> {
    if (item.kind !== 'tool_call' && item.kind !== 'tool_result') return
    const presentation = readExternalSubagent(item.meta)
    const key = presentation?.childThreadId ?? presentation?.nativeId
    if (!presentation || !key) return
    if (isTerminalExternalSubagentStatus(presentation.status)) this.openParents.delete(key)
    else this.openParents.set(key, item)
    const childThreadId = presentation.childThreadId
    if (!childThreadId) return
    await this.enqueue(childThreadId, async () => {
      const existing = await this.deps.threadStore.get(childThreadId)
      const thread = existing ?? await this.createChild(childThreadId, item, presentation)
      if (!thread) return
      if (isTerminalExternalSubagentStatus(presentation.status)) {
        await this.finishChild(thread, presentation)
      }
    })
  }

  /** Persist and publish one draft addressed to a child thread. */
  async apply(draft: RuntimeEventDraft): Promise<void> {
    const item = 'item' in draft ? (draft.item as TurnItem | undefined) : undefined
    if (!item || draft.kind === 'assistant_text_delta' || draft.kind === 'assistant_reasoning_delta') return
    await this.enqueue(draft.threadId, async () => {
      const thread = await this.deps.threadStore.get(draft.threadId)
      const turn = thread?.turns.find((candidate) => candidate.id === item.turnId)
      if (!thread || !turn) return
      if (LIVE_ITEM_KINDS.has(item.kind) && this.deps.sessionStore.finalizeLiveItem) {
        await this.deps.sessionStore.finalizeLiveItem(thread.id, item)
      } else {
        await this.deps.sessionStore.appendItem(thread.id, item)
      }
      await this.deps.threadStore.upsert({
        ...thread,
        turns: thread.turns.map((candidate) => candidate.id === turn.id ? appendTurnItem(candidate, item) : candidate),
        updatedAt: this.nowIso()
      })
      await this.deps.events.record(draft)
    })
  }

  /** Publish a signal event for a child without persisting its item again. */
  async record(draft: RuntimeEventDraft): Promise<void> {
    await this.enqueue(draft.threadId, async () => {
      if (await this.deps.threadStore.get(draft.threadId)) await this.deps.events.record(draft)
    })
  }

  /**
   * Parent items of subagents still open when their parent turn ends, settled
   * as aborted. The caller persists them on the parent thread and syncs them
   * back here, so neither the card nor the side thread keeps spinning after
   * the Agent stopped reporting.
   */
  settleOpenChildren(parentThreadId: string, parentTurnId: string): TurnItem[] {
    const settled: TurnItem[] = []
    for (const item of this.openParents.values()) {
      if (item.threadId !== parentThreadId || item.turnId !== parentTurnId) continue
      if (item.kind !== 'tool_call' && item.kind !== 'tool_result') continue
      const presentation = readExternalSubagent(item.meta)
      if (!presentation) continue
      settled.push({
        ...item,
        meta: {
          ...item.meta,
          externalSubagent: { ...presentation, status: 'aborted', endedWithTurn: true }
        }
      } as TurnItem)
    }
    return settled
  }

  private async createChild(
    childThreadId: string,
    parentItem: TurnItem,
    presentation: ExternalSubagentPresentation
  ): Promise<ThreadRecord | null> {
    const parent = this.deps.threadStore.getMetadata
      ? await this.deps.threadStore.getMetadata(parentItem.threadId)
      : await this.deps.threadStore.get(parentItem.threadId)
    if (!parent) return null
    const now = this.nowIso()
    const turnId = externalSubagentTurnId(childThreadId)
    const model = presentation.model ?? parent.model
    const prompt = delegatedPrompt(parentItem) ?? presentation.label ?? presentation.profile ?? 'Subagent'
    const userItem = makeUserItem({
      id: `${turnId}_prompt`,
      turnId,
      threadId: childThreadId,
      text: prompt,
      workspace: parent.workspace
    })
    const turn = appendTurnItem(
      startTurn(createTurnRecord({ id: turnId, threadId: childThreadId, prompt, model }), now),
      userItem
    )
    const thread: ThreadRecord = {
      ...createThreadRecord({
        id: childThreadId,
        title: presentation.label ?? presentation.profile ?? 'Subagent',
        workspace: parent.workspace,
        model,
        harnessId: SOURCE_HARNESS[presentation.source],
        ...(presentation.profile ? { agentId: presentation.profile } : {}),
        ...(parent.workspaceMode ? { workspaceMode: parent.workspaceMode } : {}),
        relation: 'side',
        parentThreadId: parent.id,
        status: 'running',
        createdAt: now
      }),
      turns: [turn]
    }
    await this.deps.threadStore.upsert(thread)
    await this.deps.sessionStore.appendItem(childThreadId, userItem)
    await this.deps.events.record({ kind: 'turn_started', threadId: childThreadId, turnId, model })
    await this.deps.events.record({ kind: 'item_created', threadId: childThreadId, turnId, itemId: userItem.id, item: userItem })
    return thread
  }

  private async finishChild(thread: ThreadRecord, presentation: ExternalSubagentPresentation): Promise<void> {
    const turnId = externalSubagentTurnId(thread.id)
    const turn = thread.turns.find((candidate) => candidate.id === turnId)
    if (!turn || (turn.status !== 'running' && turn.status !== 'queued')) return
    const status: FinishedTurnStatus = presentation.status === 'completed'
      ? 'completed'
      : presentation.status === 'aborted' ? 'aborted' : 'failed'
    const now = this.nowIso()
    const finished = finishTurn(turn, status, now)
    const items = finished.items.map((item) => finalizeOpenTurnItem(item, status, now))
    await this.deps.threadStore.upsert({
      ...thread,
      status: 'idle',
      ...(presentation.model && presentation.model !== thread.model ? { model: presentation.model } : {}),
      turns: thread.turns.map((candidate) => candidate.id === turnId
        ? { ...finished, items, ...(presentation.error ? { error: presentation.error } : {}) }
        : candidate),
      updatedAt: now
    })
    await this.deps.events.record({
      kind: status === 'completed' ? 'turn_completed' : status === 'aborted' ? 'turn_aborted' : 'turn_failed',
      threadId: thread.id,
      turnId,
      ...(presentation.error ? { message: presentation.error } : {})
    })
  }

  private enqueue(threadId: string, task: () => Promise<void>): Promise<void> {
    const previous = this.queues.get(threadId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(task)
    const settled = next.catch((error) => {
      console.warn(`[kun] external subagent mirror failed thread=${threadId}: ${error instanceof Error ? error.message : String(error)}`)
    })
    this.queues.set(threadId, settled)
    void settled.finally(() => {
      if (this.queues.get(threadId) === settled) this.queues.delete(threadId)
    })
    return settled
  }
}

/** The delegated prompt as the Agent sent it (each Agent nests it differently). */
function delegatedPrompt(item: TurnItem): string | undefined {
  if (item.kind !== 'tool_call') return undefined
  const args = item.arguments as Record<string, unknown> | undefined
  const raw = args && typeof args.rawInput === 'object' && args.rawInput ? args.rawInput as Record<string, unknown> : undefined
  for (const value of [args?.prompt, raw?.prompt, args?.message, raw?.message]) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

const stores = new WeakMap<ThreadStore, ExternalSubagentStore>()

/** One store per runtime thread store, so writes for a child stay serialized. */
export function externalSubagentStoreFor(deps: ExternalSubagentStoreDeps): ExternalSubagentStore {
  let store = stores.get(deps.threadStore)
  if (!store) {
    store = new ExternalSubagentStore(deps)
    stores.set(deps.threadStore, store)
  }
  return store
}
