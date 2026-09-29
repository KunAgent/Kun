/**
 * Codex App Server notification → Kun timeline draft mapping (P6-05).
 *
 * Codex streams deltas per itemId and sends full ThreadItem snapshots on
 * item/completed; the mapper tracks cumulative delta offsets per item so the
 * shared emitter's idempotency check holds, and converts Codex tool-ish items
 * (commandExecution, fileChange, mcpToolCall, webSearch, collab/subAgent
 * calls) into Kun tool_call/tool_result items.
 */
import type { TurnItem } from '../../contracts/items.js'
import type { ThreadTodoList } from '../../contracts/threads.js'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'
import {
  makeAssistantReasoningItem,
  makeAssistantTextItem,
  makeToolCallItem,
  makeToolResultItem
} from '../../domain/item.js'
import { CODEX_NOTIFICATIONS, type CodexThreadItem } from './codex-protocol.js'

export type CodexMapperContext = {
  threadId: string
  turnId: string
  /** Codex-side thread id, for filtering interleaved threads on one process. */
  codexThreadId: string
  model?: string
  nowIso?: () => string
}

type ItemRecord = Record<string, unknown>

const TOOL_ITEM_KINDS = new Set([
  'commandExecution',
  'fileChange',
  'mcpToolCall',
  'webSearch',
  'dynamicToolCall',
  'collabAgentToolCall',
  'subAgentActivity',
  'imageGeneration'
])

export class CodexEventMapper {
  private readonly textOffsets = new Map<string, number>()
  private readonly reasoningOffsets = new Map<string, number>()
  private latestTurnDiff = ''
  private readonly toolItemIds = new Map<string, string>()

  constructor(private readonly ctx: CodexMapperContext) {}

  /** codex itemId → Kun timeline item id (stable, namespaced). */
  kunItemId(codexItemId: string): string {
    return `cx_${codexItemId}`
  }

  get turnDiff(): string {
    return this.latestTurnDiff
  }

  /** Returns drafts for one decoded server notification; [] when filtered. */
  mapNotification(method: string, params: unknown): RuntimeEventDraft[] {
    const p = params as Record<string, unknown> | undefined
    if (!p) return []
    // Everything interesting is turn/thread-scoped; drop other threads on a
    // shared process.
    if (
      typeof p.threadId === 'string' &&
      p.threadId !== this.ctx.codexThreadId
    ) {
      return []
    }
    switch (method) {
      case CODEX_NOTIFICATIONS.agentMessageDelta:
        return this.delta('assistant_text_delta', p, 'text')
      case CODEX_NOTIFICATIONS.reasoningTextDelta:
      case CODEX_NOTIFICATIONS.reasoningSummaryTextDelta:
      case CODEX_NOTIFICATIONS.planDelta:
        return this.delta('assistant_reasoning_delta', p, 'reasoning')
      case CODEX_NOTIFICATIONS.itemStarted:
        return this.itemStarted(p.item as CodexThreadItem)
      case CODEX_NOTIFICATIONS.itemCompleted:
        return this.itemCompleted(p.item as CodexThreadItem)
      case CODEX_NOTIFICATIONS.turnPlanUpdated:
        return [this.planUpdated(p)]
      case CODEX_NOTIFICATIONS.threadTokenUsageUpdated:
        return this.tokenUsage(p)
      case CODEX_NOTIFICATIONS.turnDiffUpdated:
        if (typeof p.diff === 'string') this.latestTurnDiff = p.diff
        return []
      default:
        return []
    }
  }

  // -- deltas ------------------------------------------------------------------

  private delta(
    kind: 'assistant_text_delta' | 'assistant_reasoning_delta',
    params: Record<string, unknown>,
    lane: 'text' | 'reasoning'
  ): RuntimeEventDraft[] {
    const itemId = typeof params.itemId === 'string' ? params.itemId : ''
    const text = typeof params.delta === 'string' ? params.delta : ''
    if (!itemId || !text) return []
    const offsets = lane === 'text' ? this.textOffsets : this.reasoningOffsets
    const deltaOffset = offsets.get(itemId) ?? 0
    offsets.set(itemId, deltaOffset + text.length)
    const id = this.kunItemId(itemId)
    const item =
      lane === 'text'
        ? makeAssistantTextItem({
            id,
            threadId: this.ctx.threadId,
            turnId: this.ctx.turnId,
            text,
            status: 'running'
          })
        : makeAssistantReasoningItem({
            id,
            threadId: this.ctx.threadId,
            turnId: this.ctx.turnId,
            text,
            status: 'running'
          })
    return [
      {
        kind,
        threadId: this.ctx.threadId,
        turnId: this.ctx.turnId,
        item,
        deltaOffset
      }
    ]
  }

  // -- item lifecycle -------------------------------------------------------------

  private itemStarted(item: CodexThreadItem): RuntimeEventDraft[] {
    if (!item?.id || !TOOL_ITEM_KINDS.has(item.type)) return []
    const kunId = this.kunItemId(item.id)
    this.toolItemIds.set(item.id, kunId)
    return [
      {
        kind: 'tool_call_started',
        threadId: this.ctx.threadId,
        turnId: this.ctx.turnId,
        item: this.toToolCallItem(item, kunId, 'running')
      }
    ]
  }

  private itemCompleted(item: CodexThreadItem): RuntimeEventDraft[] {
    if (!item?.id) return []
    const record = item as ItemRecord
    if (TOOL_ITEM_KINDS.has(item.type)) {
      const kunId = this.toolItemIds.get(item.id) ?? this.kunItemId(item.id)
      const status = record.status === 'failed' ? 'failed' : 'completed'
      return [
        {
          kind: 'tool_call_finished',
          threadId: this.ctx.threadId,
          turnId: this.ctx.turnId,
          item: this.toToolResultItem(item, kunId, status)
        }
      ]
    }
    if (item.type === 'agentMessage' && typeof record.text === 'string') {
      const id = this.kunItemId(item.id)
      return [
        {
          kind: 'item_updated',
          threadId: this.ctx.threadId,
          turnId: this.ctx.turnId,
          item: makeAssistantTextItem({
            id,
            threadId: this.ctx.threadId,
            turnId: this.ctx.turnId,
            text: record.text,
            status: 'completed'
          })
        }
      ]
    }
    if (item.type === 'reasoning') {
      const id = this.kunItemId(item.id)
      const text =
        typeof record.content === 'string'
          ? record.content
          : typeof record.summary === 'string'
            ? record.summary
            : ''
      if (!text) return []
      return [
        {
          kind: 'item_updated',
          threadId: this.ctx.threadId,
          turnId: this.ctx.turnId,
          item: makeAssistantReasoningItem({
            id,
            threadId: this.ctx.threadId,
            turnId: this.ctx.turnId,
            text,
            status: 'completed'
          })
        }
      ]
    }
    return []
  }

  private toToolCallItem(
    item: CodexThreadItem,
    kunId: string,
    status: 'pending' | 'running' | 'completed' | 'failed'
  ): TurnItem {
    const record = item as ItemRecord
    const { toolName, toolKind, args } = this.toolDescriptor(item)
    return makeToolCallItem({
      id: kunId,
      turnId: this.ctx.turnId,
      threadId: this.ctx.threadId,
      callId: item.id,
      toolName,
      toolKind,
      arguments: args,
      status
    })
  }

  private toToolResultItem(
    item: CodexThreadItem,
    kunId: string,
    status: 'completed' | 'failed'
  ): TurnItem {
    const record = item as ItemRecord
    const { toolName, toolKind } = this.toolDescriptor(item)
    return makeToolResultItem({
      id: `${kunId}_result`,
      turnId: this.ctx.turnId,
      threadId: this.ctx.threadId,
      callId: item.id,
      toolName,
      toolKind,
      output: this.toolOutput(item),
      isError: status === 'failed',
      status
    })
  }

  private toolDescriptor(item: CodexThreadItem): {
    toolName: string
    toolKind: 'tool_call' | 'command_execution' | 'file_change'
    args: Record<string, unknown>
  } {
    const record = item as ItemRecord
    switch (item.type) {
      case 'commandExecution':
        return {
          toolName: 'shell',
          toolKind: 'command_execution',
          args: {
            command: record.command,
            cwd: record.cwd,
            processId: record.processId
          }
        }
      case 'fileChange':
        return {
          toolName: 'file_change',
          toolKind: 'file_change',
          args: { changes: record.changes }
        }
      case 'mcpToolCall':
        return {
          toolName:
            typeof record.server === 'string' && typeof record.tool === 'string'
              ? `mcp:${record.server}/${record.tool}`
              : 'mcp_tool',
          toolKind: 'tool_call',
          args: { arguments: record.arguments, server: record.server }
        }
      case 'webSearch':
        return {
          toolName: 'web_search',
          toolKind: 'tool_call',
          args: { query: record.query }
        }
      default:
        return {
          toolName:
            typeof record.tool === 'string' ? record.tool : item.type,
          toolKind: 'tool_call',
          args: { prompt: record.prompt, tool: record.tool }
        }
    }
  }

  private toolOutput(item: CodexThreadItem): unknown {
    const record = item as ItemRecord
    switch (item.type) {
      case 'commandExecution':
        return {
          output: record.aggregatedOutput,
          exitCode: record.exitCode,
          durationMs: record.durationMs
        }
      case 'fileChange':
        return {
          changes: record.changes,
          ...(this.latestTurnDiff ? { unifiedDiff: this.latestTurnDiff } : {})
        }
      case 'mcpToolCall':
        return record.result ?? record.error
      case 'webSearch':
        return { results: record.results }
      default:
        return record.result ?? record
    }
  }

  // -- plan / usage ------------------------------------------------------------------

  private planUpdated(params: Record<string, unknown>): RuntimeEventDraft {
    const now = this.ctx.nowIso?.() ?? new Date().toISOString()
    const entries = Array.isArray(params.plan) ? params.plan : []
    const todos: ThreadTodoList = {
      threadId: this.ctx.threadId,
      items: entries.map((entry, index) => {
        const e = entry as { step?: unknown; status?: unknown }
        return {
          id: `codex_plan_${index}`,
          content:
            typeof e.step === 'string' ? e.step.slice(0, 1_000) : '',
          status:
            e.status === 'inProgress'
              ? 'in_progress'
              : e.status === 'completed'
                ? 'completed'
                : 'pending',
          createdAt: now,
          updatedAt: now
        }
      }),
      updatedAt: now
    }
    return {
      kind: 'todos_updated',
      threadId: this.ctx.threadId,
      turnId: this.ctx.turnId,
      todos
    }
  }

  private tokenUsage(params: Record<string, unknown>): RuntimeEventDraft[] {
    const usage = params.tokenUsage as
      | {
          last?: {
            inputTokens?: number
            outputTokens?: number
            reasoningOutputTokens?: number
            cachedInputTokens?: number
            totalTokens?: number
          }
          total?: {
            inputTokens?: number
            outputTokens?: number
            reasoningOutputTokens?: number
            cachedInputTokens?: number
            totalTokens?: number
          }
          modelContextWindow?: number | null
        }
      | undefined
    const last = usage?.last
    if (!last) return []
    const prompt = Math.max(0, Math.trunc(last.inputTokens ?? 0))
    const completion = Math.max(0, Math.trunc(last.outputTokens ?? 0))
    const total = Math.max(0, Math.trunc(last.totalTokens ?? 0))
    if (prompt + completion + total <= 0) return []
    const drafts: RuntimeEventDraft[] = [
      {
        kind: 'usage',
        threadId: this.ctx.threadId,
        turnId: this.ctx.turnId,
        model: this.ctx.model,
        usage: {
          promptTokens: prompt,
          completionTokens: completion,
          totalTokens: total,
          cacheHitRate: null,
          turns: 0,
          ...(last.reasoningOutputTokens
            ? { reasoningTokens: Math.trunc(last.reasoningOutputTokens) }
            : {}),
          ...(last.cachedInputTokens
            ? {
                cachedTokens: Math.trunc(last.cachedInputTokens),
                cacheHitTokens: Math.trunc(last.cachedInputTokens)
              }
            : {})
        }
      }
    ]
    if (typeof usage?.modelContextWindow === 'number') {
      drafts.push({
        kind: 'context_snapshot',
        threadId: this.ctx.threadId,
        turnId: this.ctx.turnId,
        model: this.ctx.model ?? 'codex',
        stepIndex: 0,
        contextWindowTokens: Math.max(1, usage.modelContextWindow),
        softThresholdTokens: Math.max(1, usage.modelContextWindow),
        hardThresholdTokens: Math.max(1, usage.modelContextWindow),
        estimatedInputTokens: usage.total?.totalTokens ?? total,
        breakdown: {
          tools: 0,
          system: 0,
          skills: 0,
          messages: usage.total?.totalTokens ?? total,
          other: 0
        },
        toolCount: this.toolItemIds.size,
        activeSkillIds: [],
        contextManagement: 'sdk-managed',
        nativeHistory: 'known'
      })
    }
    return drafts
  }
}
