import type { GraphNodeAttemptV1, TurnItem } from '../../contracts/index.js'

const MAX_PROJECTION_CHARS = 32_768
const MAX_ITEM_VALUE_CHARS = 6_000

export function boundedGraphSupervisionProjection(
  items: TurnItem[]
): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = []
  let retainedChars = 0
  for (const item of items) {
    // Internal model history must not enter Graph's user-visible supervision
    // transcript. Goal context and interruption checkpoints have their own
    // durable records in the session.
    if (
      item.kind === 'goal_context' ||
      item.kind === 'model_context' ||
      item.kind === 'runtime_context_source' ||
      item.kind === 'interruption_note'
    ) continue
    const projected = projectItem(item)
    const chars = JSON.stringify(projected).length
    if (retainedChars + chars > MAX_PROJECTION_CHARS) break
    output.push(projected)
    retainedChars += chars
  }
  return output
}

export function boundedGraphSupervisionText(value: string): string {
  return value.length <= MAX_ITEM_VALUE_CHARS
    ? value
    : `${value.slice(0, MAX_ITEM_VALUE_CHARS)}…[truncated]`
}

export function graphAttemptSummary(
  attempt: GraphNodeAttemptV1 | undefined
): Record<string, unknown> | null {
  return attempt
    ? {
        id: attempt.id,
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        startedAt: attempt.startedAt ?? null,
        finishedAt: attempt.finishedAt ?? null,
        normalizedFailure: attempt.normalizedFailure ?? null
      }
    : null
}

function projectItem(item: TurnItem): Record<string, unknown> {
  const base = {
    id: item.id,
    turnId: item.turnId,
    kind: item.kind,
    role: item.role,
    status: item.status,
    createdAt: item.createdAt
  }
  switch (item.kind) {
    case 'goal_context':
    case 'model_context':
    case 'runtime_context_source':
    case 'interruption_note':
      return base
    case 'user_message':
    case 'assistant_text':
    case 'assistant_reasoning':
      return { ...base, text: boundedGraphSupervisionText(item.text) }
    case 'tool_call':
      return {
        ...base,
        toolName: item.toolName,
        summary: item.summary ? boundedGraphSupervisionText(item.summary) : undefined,
        arguments: boundedValue(item.arguments)
      }
    case 'tool_result':
      return {
        ...base,
        toolName: item.toolName,
        isError: item.isError,
        output: boundedValue(item.output)
      }
    case 'approval':
      return {
        ...base,
        toolName: item.toolName,
        summary: boundedGraphSupervisionText(item.summary)
      }
    case 'user_input':
      return {
        ...base,
        prompt: boundedGraphSupervisionText(item.prompt),
        inputStatus: item.status
      }
    case 'compaction':
      return { ...base, summary: boundedGraphSupervisionText(item.summary) }
    case 'context_window':
      return { ...base, windowId: item.windowId, reason: item.reason }
    case 'review':
      return {
        ...base,
        title: boundedGraphSupervisionText(item.title),
        reviewText: boundedGraphSupervisionText(item.reviewText ?? '')
      }
    case 'error':
      return {
        ...base,
        message: boundedGraphSupervisionText(item.message),
        code: item.code
      }
  }
}

function boundedValue(value: unknown): unknown {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) return null
  if (serialized.length <= MAX_ITEM_VALUE_CHARS) return value
  return `${serialized.slice(0, MAX_ITEM_VALUE_CHARS)}…[truncated]`
}
