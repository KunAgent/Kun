/**
 * Subagents of ACP Agents: OpenCode's `task` tool, oh-my-openagent's
 * `background_task` / `delegate_task` / `call_omo_agent` (and the follow-up
 * `background_output` / `background_cancel`), CodeMaker (an OpenCode fork)
 * and Devin's `run_subagent` / `sidekick` (with `read_subagent`).
 *
 * ACP gives only `kind: other` plus the tool's raw input/output, so calls are
 * recognized by input shape. Spawn calls get an `externalSubagent`
 * presentation; follow-up calls fold into their card instead of rendering as
 * rows. Steps are mirrored separately (opencode-child-sessions.ts) when the
 * Agent's local session store is readable.
 */
import {
  EXTERNAL_SUBAGENT_META_KEY,
  clipExternalText,
  externalSubagentThreadId,
  isTerminalExternalSubagentStatus,
  type ExternalSubagentPresentation,
  type ExternalSubagentSource,
  type ExternalSubagentStatus
} from '../../contracts/external-subagent.js'
import type { TurnItem } from '../../contracts/items.js'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'

const UPDATE_INTERVAL_MS = 1_000
const BACKGROUND_LAUNCH = /background task launched|^\s*task id:\s*bg_/im
const SPAWN_NAMES = /^(task|delegate_task|background_task|call_omo_agent|run_subagent|sidekick)$/i

export type AcpSubagentTrackerContext = {
  threadId: string
  turnId: string
  source: ExternalSubagentSource
  /** Whether a child-session reader mirrors steps into side threads. */
  mirrorSteps: boolean
  nowMs?: () => number
  nowIso?: () => string
}

export type AcpSubagentCard = {
  callId: string
  presentation: ExternalSubagentPresentation
  item: TurnItem
  taskId?: string
  sessionId?: string
  startedMs: number
  lastEmitMs: number
}

type ToolItem = Extract<TurnItem, { kind: 'tool_call' | 'tool_result' }>

type Wire = { title?: string; name?: string; input: Record<string, unknown>; output: Record<string, unknown>; text: string }

export class AcpSubagentTracker {
  private readonly cards = new Map<string, AcpSubagentCard>()
  /** Folded follow-up calls: call id → the cards it targets (empty = unknown yet). */
  private readonly followUps = new Map<string, 'output' | 'cancel' | 'read'>()
  private readonly nowMs: () => number
  private readonly nowIso: () => string

  constructor(private readonly ctx: AcpSubagentTrackerContext) {
    this.nowMs = ctx.nowMs ?? Date.now
    this.nowIso = ctx.nowIso ?? (() => new Date().toISOString())
  }

  get source(): ExternalSubagentSource {
    return this.ctx.source
  }

  /** Decorate spawn calls, fold follow-ups, pass everything else through. */
  decorate(drafts: RuntimeEventDraft[]): RuntimeEventDraft[] {
    const out: RuntimeEventDraft[] = []
    for (const draft of drafts) {
      const item = 'item' in draft ? draft.item as TurnItem | undefined : undefined
      if (!item || (item.kind !== 'tool_call' && item.kind !== 'tool_result')) {
        out.push(draft)
        continue
      }
      const wire = readWire(item)
      const card = this.cards.get(item.callId) ?? this.detectSpawn(item, wire)
      if (card) {
        out.push({ ...draft, item: this.decorateSpawn(card, item, wire) } as RuntimeEventDraft)
        continue
      }
      const followUp = this.followUps.get(item.callId) ?? this.detectFollowUp(wire)
      if (!followUp) {
        out.push(draft)
        continue
      }
      this.followUps.set(item.callId, followUp)
      if (item.kind === 'tool_result') out.push(...this.applyFollowUp(followUp, wire))
    }
    return out
  }

  /** Running cards whose steps can be mirrored. */
  openCards(): AcpSubagentCard[] {
    return [...this.cards.values()].filter((card) =>
      card.presentation.childThreadId && !isTerminalExternalSubagentStatus(card.presentation.status))
  }

  bindSession(card: AcpSubagentCard, sessionId: string): void {
    card.sessionId = sessionId
    card.presentation = { ...card.presentation, nativeId: sessionId }
  }

  /** Progress from the child-session reader; returns the parent card update, if due. */
  progress(card: AcpSubagentCard, patch: Partial<ExternalSubagentPresentation>): RuntimeEventDraft[] {
    return this.update(card, patch, false)
  }

  private detectSpawn(item: ToolItem, wire: Wire): AcpSubagentCard | undefined {
    const input = wire.input
    const named = [wire.name, wire.title].some((value) => value && SPAWN_NAMES.test(value.trim()))
    const prompt = text(input.prompt) ?? text(input.task) ?? text(input.instructions)
    const profile = text(input.subagent_type) ?? text(input.agent) ?? text(input.profile) ?? text(input.profile_name) ?? text(input.category)
    const omo = Array.isArray(input.load_skills)
    if (!prompt || !(profile || omo || named)) return undefined
    const detached = input.run_in_background === true || input.is_background === true || input.background === true ||
      /^(background_task|delegate_task)$/i.test(wire.title ?? '')
    const presentation: ExternalSubagentPresentation = {
      version: 1,
      source: this.ctx.source,
      ...(this.ctx.mirrorSteps ? { childThreadId: externalSubagentThreadId(this.ctx.threadId, item.callId) } : {}),
      profile: clipExternalText(profile, 200) ?? (/sidekick/i.test(wire.title ?? '') ? 'sidekick' : 'general'),
      ...optional('label', clipExternalText(text(input.description) ?? firstLine(prompt), 500)),
      status: 'running',
      ...(detached ? { detached: true } : {}),
      steps: 0,
      startedAt: this.nowIso()
    }
    const card: AcpSubagentCard = { callId: item.callId, presentation, item, startedMs: this.nowMs(), lastEmitMs: 0 }
    this.cards.set(item.callId, card)
    return card
  }

  private decorateSpawn(card: AcpSubagentCard, item: ToolItem, wire: Wire): TurnItem {
    if (item.kind === 'tool_result' && !isTerminalExternalSubagentStatus(card.presentation.status)) {
      const outputText = wire.text
      const sessionId = /session[_ ]id:\s*`?(ses_[A-Za-z0-9]+)/i.exec(outputText)?.[1] ?? text(wire.output.metadata && (wire.output.metadata as Record<string, unknown>).sessionId)
      if (sessionId && !card.sessionId) this.bindSession(card, sessionId)
      const metadata = recordOf(wire.output.metadata)
      const model = text(recordOf(metadata.model).modelID)
      const taskId = /task id:\s*`?(bg_[A-Za-z0-9]+)/i.exec(outputText)?.[1]
      if (taskId) card.taskId = taskId
      if (!item.isError && BACKGROUND_LAUNCH.test(outputText)) {
        card.presentation = { ...card.presentation, detached: true, ...optional('model', clipExternalText(model, 200)) }
      } else if (item.status === 'aborted') {
        // Interrupted at turn end: the Agent never reported a result.
        card.presentation = { ...card.presentation, status: 'aborted', endedWithTurn: true }
      } else {
        card.presentation = {
          ...card.presentation,
          status: item.isError ? 'failed' : 'completed',
          ...optional(item.isError ? 'error' : 'summary', clipExternalText(cleanResult(outputText), item.isError ? 1000 : 4000)),
          ...optional('model', clipExternalText(model, 200)),
          ...(Array.isArray(metadata.summary) ? { steps: metadata.summary.length } : {}),
          durationMs: Math.max(0, this.nowMs() - card.startedMs)
        }
      }
    }
    card.item = withPresentation(item, card.presentation)
    return card.item
  }

  private detectFollowUp(wire: Wire): 'output' | 'cancel' | 'read' | undefined {
    const name = (wire.name ?? wire.title ?? '').trim()
    const input = wire.input
    if (/^background_output$/i.test(name) || (typeof input.task_id === 'string' && /^bg_/.test(input.task_id))) return 'output'
    if (/^background_cancel$/i.test(name) || (input.all === true && Object.keys(input).length <= 2)) return 'cancel'
    if (/^read_subagent$/i.test(name)) return 'read'
    return undefined
  }

  private applyFollowUp(kind: 'output' | 'cancel' | 'read', wire: Wire): RuntimeEventDraft[] {
    const input = wire.input
    const taskId = text(input.task_id) ?? text(input.taskId)
    const running = [...this.cards.values()].filter((card) => !isTerminalExternalSubagentStatus(card.presentation.status))
    const targets = taskId
      ? [...this.cards.values()].filter((card) => card.taskId === taskId)
      : kind === 'cancel' && input.all === true
        ? running.filter((card) => card.presentation.detached)
        : running.length === 1 ? running : []
    return targets.flatMap((card) => {
      if (kind === 'cancel') return this.update(card, { status: 'aborted', closedByParent: true }, true)
      const patch: Partial<ExternalSubagentPresentation> = { progressChecks: (card.presentation.progressChecks ?? 0) + 1 }
      const status = /\|\s*status\s*\|\s*\**\s*([a-z_]+)/i.exec(wire.text)?.[1]?.toLowerCase()
      const mapped: ExternalSubagentStatus | undefined = status === 'completed' ? 'completed'
        : status === 'error' || status === 'failed' ? 'failed'
          : status === 'cancelled' || status === 'canceled' ? 'aborted' : undefined
      if (mapped) patch.status = mapped
      const lastTool = /\|\s*last tool\s*\|\s*`?([^|`]+?)`?\s*\|/i.exec(wire.text)?.[1]
      if (lastTool && !mapped) patch.activity = clipExternalText(lastTool, 160)
      const sessionId = /\|\s*session id\s*\|\s*`?(ses_[A-Za-z0-9]+)/i.exec(wire.text)?.[1]
      if (sessionId && !card.sessionId) this.bindSession(card, sessionId)
      return this.update(card, patch, true)
    })
  }

  private update(card: AcpSubagentCard, patch: Partial<ExternalSubagentPresentation>, force: boolean): RuntimeEventDraft[] {
    if (isTerminalExternalSubagentStatus(card.presentation.status) && !patch.progressChecks) return []
    card.presentation = { ...card.presentation, ...patch }
    const now = this.nowMs()
    if (!force && !patch.status && now - card.lastEmitMs < UPDATE_INTERVAL_MS) return []
    card.lastEmitMs = now
    card.item = withPresentation(card.item, card.presentation)
    return [{ kind: 'item_updated', threadId: this.ctx.threadId, turnId: this.ctx.turnId, itemId: card.item.id, item: card.item }]
  }
}

function readWire(item: TurnItem): Wire {
  const meta = 'meta' in item ? recordOf(recordOf(item.meta).delegatedTool) : {}
  const args = item.kind === 'tool_call' ? recordOf(item.arguments) : {}
  const input = recordOf(meta.input ?? args.rawInput)
  const output = recordOf(meta.output)
  const resultText = item.kind === 'tool_result'
    ? typeof item.output === 'string' ? item.output : text(recordOf(item.output).text)
    : undefined
  return {
    ...optional('title', text(meta.title) ?? text(args.title)),
    ...optional('name', text(meta.name)),
    input,
    output,
    text: text(meta.text) ?? resultText ?? text(output.output) ?? ''
  }
}

/** The subagent's own answer: OpenCode wraps it in task_result and appends task_metadata. */
function cleanResult(value: string): string {
  const wrapped = /<task_result>([\s\S]*?)<\/task_result>/i.exec(value)?.[1]
  return (wrapped ?? value)
    .replace(/<task_metadata>[\s\S]*?<\/task_metadata>/gi, '')
    .replace(/^task_id:.*$/gim, '')
    .trim()
}

function withPresentation(item: TurnItem, presentation: ExternalSubagentPresentation): TurnItem {
  const meta = 'meta' in item && item.meta ? item.meta : {}
  return { ...item, meta: { ...meta, [EXTERNAL_SUBAGENT_META_KEY]: presentation } } as TurnItem
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function firstLine(value: string): string | undefined {
  return value.split('\n').map((line) => line.trim()).find(Boolean)
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }
}
