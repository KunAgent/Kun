/**
 * Claude Code subagents (the `Agent` tool, formerly `Task`) on the SDK stream.
 *
 * Every message a subagent produces carries `parent_tool_use_id`. Without this
 * router those messages were mapped into the parent turn, so the subagent's
 * reads, commands and words looked like the main agent's. Here each subagent
 * gets its own child mapper whose drafts address a hidden side thread, while
 * the parent `Agent` tool item carries an `externalSubagent` presentation that
 * is refreshed (throttled) as the subagent works. Background agents report
 * through `task_*` system messages.
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
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'
import { describeToolActivity } from '../external-subagent-activity.js'
import type { SdkApiMessage, SdkMessage, SdkToolUseBlock } from './sdk-protocol.js'

export const SDK_SUBAGENT_TOOL_NAMES: ReadonlySet<string> = new Set(['Agent', 'Task'])
const UPDATE_INTERVAL_MS = 1_000
const CHILD_DRAFT_KINDS = new Set(['item_created', 'item_updated', 'item_completed', 'tool_call_finished'])
const BACKGROUND_LAUNCH = /\b(async agent launched|running in the background|launched successfully)\b/i

export type SdkChildMapper = { map(message: SdkMessage): RuntimeEventDraft[] }

export type SdkSubagentRouterContext = {
  threadId: string
  turnId: string
  createChildMapper(childThreadId: string, childTurnId: string, model?: string): SdkChildMapper
  nowMs?: () => number
  nowIso?: () => string
}

type SubagentState = {
  presentation: ExternalSubagentPresentation
  /** Latest parent item for this call (the result once it exists). */
  item: TurnItem
  mapper?: SdkChildMapper
  lastEmitMs: number
  startedMs: number
}

export class SdkSubagentRouter {
  private readonly agents = new Map<string, SubagentState>()
  private readonly toolUseByTask = new Map<string, string>()
  private readonly nowMs: () => number
  private readonly nowIso: () => string

  constructor(private readonly ctx: SdkSubagentRouterContext) {
    this.nowMs = ctx.nowMs ?? Date.now
    this.nowIso = ctx.nowIso ?? (() => new Date().toISOString())
  }

  /** Subagent messages and task notices; undefined leaves the message to the parent. */
  route(message: SdkMessage): RuntimeEventDraft[] | undefined {
    const parentToolUseId = (message as { parent_tool_use_id?: unknown }).parent_tool_use_id
    if (typeof parentToolUseId === 'string' && parentToolUseId) {
      const state = this.agents.get(parentToolUseId)
      // An unknown parent is still subagent content: never mix it into the parent.
      return state ? this.routeChild(state, message) : []
    }
    if (message.type === 'system') return this.routeTask(message as Record<string, unknown>)
    return undefined
  }

  decorateCall(item: TurnItem, block: SdkToolUseBlock): TurnItem {
    if (!SDK_SUBAGENT_TOOL_NAMES.has(block.name) || item.kind !== 'tool_call') return item
    const input = block.input ?? {}
    const childThreadId = externalSubagentThreadId(this.ctx.threadId, block.id)
    const presentation: ExternalSubagentPresentation = {
      version: 1,
      source: 'claude-code',
      childThreadId,
      profile: clipExternalText(input.subagent_type, 200) ?? 'general-purpose',
      ...optional('label', clipExternalText(input.description, 500)),
      ...optional('model', clipExternalText(input.model, 200)),
      status: 'running',
      ...(input.run_in_background === true ? { detached: true } : {}),
      steps: 0,
      startedAt: this.nowIso()
    }
    const decorated = withPresentation(item, presentation)
    this.agents.set(block.id, { presentation, item: decorated, lastEmitMs: 0, startedMs: this.nowMs() })
    return decorated
  }

  decorateResult(item: TurnItem): TurnItem {
    if (item.kind !== 'tool_result') return item
    const state = this.agents.get(item.callId)
    if (!state) return item
    const text = outputText(item.output)
    const launched = !item.isError && (state.presentation.detached === true || BACKGROUND_LAUNCH.test(text))
    const presentation: ExternalSubagentPresentation = launched
      ? { ...state.presentation, detached: true }
      : {
          ...state.presentation,
          status: item.isError ? 'failed' : 'completed',
          ...optional(item.isError ? 'error' : 'summary', clipExternalText(cleanResult(text), item.isError ? 1000 : 4000)),
          durationMs: Math.max(0, this.nowMs() - state.startedMs)
        }
    state.presentation = presentation
    state.item = withPresentation(item, presentation)
    return state.item
  }

  private routeChild(state: SubagentState, message: SdkMessage): RuntimeEventDraft[] {
    const childThreadId = state.presentation.childThreadId!
    state.mapper ??= this.ctx.createChildMapper(childThreadId, externalSubagentTurnId(childThreadId), state.presentation.model)
    const drafts = state.mapper.map(message).filter((draft) => CHILD_DRAFT_KINDS.has(draft.kind))
    const patch: Partial<ExternalSubagentPresentation> = {}
    if (message.type === 'assistant') {
      const api = (message as { message?: SdkApiMessage }).message
      const toolUses = Array.isArray(api?.content)
        ? api.content.filter((block): block is SdkToolUseBlock => block.type === 'tool_use')
        : []
      if (toolUses.length) {
        patch.steps = (state.presentation.steps ?? 0) + toolUses.length
        const last = toolUses[toolUses.length - 1]!
        patch.activity = describeToolActivity(last.name, last.input)
      }
      const model = clipExternalText(api?.model, 200)
      if (model && !state.presentation.model) patch.model = model
    }
    const parentUpdate = Object.keys(patch).length ? this.update(state, patch, false) : undefined
    return parentUpdate ? [...drafts, parentUpdate] : drafts
  }

  private routeTask(message: Record<string, unknown>): RuntimeEventDraft[] | undefined {
    const subtype = message.subtype
    if (subtype !== 'task_started' && subtype !== 'task_progress' && subtype !== 'task_notification') return undefined
    const taskId = typeof message.task_id === 'string' ? message.task_id : undefined
    const toolUseId = typeof message.tool_use_id === 'string'
      ? message.tool_use_id
      : taskId ? this.toolUseByTask.get(taskId) : undefined
    const state = toolUseId ? this.agents.get(toolUseId) : undefined
    if (!state) return []
    if (taskId && toolUseId) this.toolUseByTask.set(taskId, toolUseId)
    const usage = message.usage && typeof message.usage === 'object' ? message.usage as Record<string, unknown> : {}
    const patch: Partial<ExternalSubagentPresentation> = {
      ...optional('nativeId', clipExternalText(taskId, 256)),
      ...(typeof usage.tool_uses === 'number' ? { steps: Math.max(0, Math.trunc(usage.tool_uses)) } : {}),
      ...(typeof usage.total_tokens === 'number' ? { totalTokens: Math.max(0, Math.trunc(usage.total_tokens)) } : {}),
      ...(typeof usage.duration_ms === 'number' ? { durationMs: Math.max(0, Math.trunc(usage.duration_ms)) } : {}),
      ...optional('activity', typeof message.last_tool_name === 'string' ? message.last_tool_name : undefined),
      ...optional('profile', clipExternalText(message.subagent_type, 200))
    }
    if (subtype !== 'task_notification') {
      const update = this.update(state, patch, subtype === 'task_started')
      return update ? [update] : []
    }
    const status: ExternalSubagentStatus = message.status === 'completed'
      ? 'completed' : message.status === 'stopped' ? 'aborted' : 'failed'
    const summary = clipExternalText(message.summary, status === 'completed' ? 4000 : 1000)
    return [this.update(state, {
      ...patch,
      status,
      ...(summary ? status === 'completed' ? { summary } : { error: summary } : {}),
      ...(status === 'aborted' ? { closedByParent: true } : {})
    }, true)!]
  }

  /** Re-emit the latest parent item with a refreshed presentation (throttled unless forced). */
  private update(
    state: SubagentState,
    patch: Partial<ExternalSubagentPresentation>,
    force: boolean
  ): RuntimeEventDraft | undefined {
    if (isTerminalExternalSubagentStatus(state.presentation.status) && !patch.status) return undefined
    state.presentation = { ...state.presentation, ...patch }
    const now = this.nowMs()
    if (!force && !patch.status && now - state.lastEmitMs < UPDATE_INTERVAL_MS) return undefined
    state.lastEmitMs = now
    state.item = withPresentation(state.item, state.presentation)
    return {
      kind: 'item_created',
      threadId: this.ctx.threadId,
      turnId: this.ctx.turnId,
      itemId: state.item.id,
      item: state.item
    }
  }
}

function withPresentation(item: TurnItem, presentation: ExternalSubagentPresentation): TurnItem {
  const meta = 'meta' in item && item.meta ? item.meta : {}
  return { ...item, meta: { ...meta, [EXTERNAL_SUBAGENT_META_KEY]: presentation } } as TurnItem
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }
}

function outputText(output: unknown): string {
  if (typeof output === 'string') return output
  if (Array.isArray(output)) {
    return output.map((block) => (block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string'
      ? (block as { text: string }).text : '')).join('')
  }
  return ''
}

/** Drop the trailing resume handle and usage footer Claude Code appends to results. */
function cleanResult(text: string): string {
  return text
    .replace(/<usage>[\s\S]*?<\/usage>/gi, '')
    .split('\n')
    .filter((line) => !/^\s*agentId:\s/i.test(line))
    .join('\n')
    .trim()
}
