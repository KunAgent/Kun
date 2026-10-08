import type { SDKMessage } from '@cursor/sdk'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'
import { CursorSdkEventMapper, cursorTodosRequestFromMessage } from './cursor-sdk-event-mapper.js'
import { sanitizeCursorSdkError, type CursorSdkRuntimeDeps } from './cursor-sdk-runtime-support.js'
import { captureCursorMessage, captureCursorTraceDraft, itemOf, type CursorTrace } from './cursor-sdk-runtime-trace.js'
import { harnessTurnTiming } from '../harness-turn-timing.js'

export async function consumeCursorMessage(
  deps: CursorSdkRuntimeDeps,
    threadId: string,
    turnId: string,
    mapper: CursorSdkEventMapper,
    message: SDKMessage,
    trace: CursorTrace | undefined,
    materializedOutputItemIds: Set<string>
  ): Promise<void> {
    captureCursorMessage(trace, message)
    const drafts = mapper.map(message)
    harnessTurnTiming(threadId, turnId).observe(drafts)
    const outputItem = message.type === 'assistant'
      ? mapper.runningTextItem
      : message.type === 'thinking'
        ? mapper.runningReasoningItem
        : undefined
    if (outputItem) {
      if (materializedOutputItemIds.has(outputItem.id)) {
        const updated = await deps.turns.updateItem(
          outputItem.threadId,
          outputItem.id,
          outputItem
        )
        if (!updated) {
          await deps.turns.applyItem(outputItem.threadId, outputItem)
        }
      } else {
        await deps.turns.applyItem(outputItem.threadId, outputItem)
        materializedOutputItemIds.add(outputItem.id)
      }
    }
    for (const draft of drafts) {
      captureCursorTraceDraft(trace, draft)
      await emitCursorDraft(deps,draft.threadId, draft)
    }
    const todosRequest = cursorTodosRequestFromMessage(message)
    if (todosRequest && deps.setThreadTodos) {
      try {
        await deps.setThreadTodos(threadId, todosRequest)
      } catch (error) {
        await deps.events.record({
          kind: 'error',
          threadId,
          turnId,
          message: `Failed to sync Cursor SDK todos: ${sanitizeCursorSdkError(error, '')}`,
          code: 'cursor_sdk_todo_sync_failed',
          severity: 'warning'
        })
      }
    }
}

export async function emitCursorDraft(
  deps: CursorSdkRuntimeDeps,
  threadId: string, draft: RuntimeEventDraft): Promise<void> {
    const item = itemOf(draft)
    if (item && (
      draft.kind === 'item_created'
      || draft.kind === 'tool_call_started'
      || draft.kind === 'tool_call_finished'
    )) {
      await deps.turns.applyItem(threadId, item)
      if (draft.kind !== 'item_created') await deps.events.record(draft)
      return
    }
    await deps.events.record(draft)
}
