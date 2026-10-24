import type { TurnItem } from '../contracts/items.js'
import type { RoomRunStep, RoomRunSteps } from '../contracts/room-run-query.js'
import type { RoomRunStatus } from '../contracts/room-runs.js'
import { PRIVATE_PUBLICATION_TOOL_NAMES } from './room-im-delivery.js'
import { inspectRoomRun } from './room-run-query.js'
import type { RoomRuntimeDeps } from './room-runtime-types.js'

// One read covers a long turn; the response drops outputs, so it stays small.
const STEP_ITEM_LIMIT = 2000
const STEP_READ_BYTES = 16 * 1024 * 1024
const TARGET_CHARS = 160
const LABEL_CHARS = 240

const oneLine = (value: string, max: number) => value.replace(/\s+/g, ' ').trim().slice(0, max)

function stepTarget(item: Extract<TurnItem, { kind: 'tool_call' }>): string | undefined {
  const args = item.arguments
  const text = (key: string) => {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) return value
    if (Array.isArray(value) && value.every((part) => typeof part === 'string')) return value.join(' ')
    return undefined
  }
  const keys = item.toolKind === 'command_execution' ? ['command', 'cmd']
    : ['path', 'file_path', 'filePath', 'url', 'query', 'pattern', 'command']
  for (const key of keys) {
    const value = text(key)
    if (value) return oneLine(value, TARGET_CHARS)
  }
  return undefined
}

/** Project a turn's items to the work a reader cares about. Messages and cards the chat already shows are left out. */
export function runSteps(items: readonly TurnItem[], runStatus: RoomRunStatus): RoomRunStep[] {
  const published = new Set<string>(PRIVATE_PUBLICATION_TOOL_NAMES)
  const results = new Map<string, Extract<TurnItem, { kind: 'tool_result' }>>()
  for (const item of items) if (item.kind === 'tool_result') results.set(item.callId, item)
  const live = runStatus === 'queued' || runStatus === 'running'
  const steps: RoomRunStep[] = []
  for (const item of items) {
    if (item.kind === 'approval') {
      steps.push({ id: item.id, kind: 'approval', toolName: item.toolName, label: oneLine(item.summary, LABEL_CHARS),
        status: item.status, startedAt: item.createdAt, ...(item.finishedAt ? { endedAt: item.finishedAt } : {}) })
      continue
    }
    if (item.kind !== 'tool_call' || published.has(item.toolName) || item.id.endsWith('_storm')) continue
    const result = results.get(item.callId)
    const status = result ? (result.isError ? 'failed' : 'done')
      : item.cancelRequestedAt || !live ? 'cancelled' : 'running'
    const target = stepTarget(item)
    const endedAt = result?.finishedAt ?? result?.createdAt
    steps.push({ id: item.id, kind: 'tool', toolName: item.toolName, toolKind: item.toolKind,
      ...(item.summary?.trim() ? { label: oneLine(item.summary, LABEL_CHARS) } : {}),
      ...(target ? { target } : {}), status, startedAt: item.createdAt, ...(endedAt ? { endedAt } : {}) })
  }
  return steps
}

export async function roomRunSteps(deps: RoomRuntimeDeps, roomId: string, runId: string): Promise<RoomRunSteps> {
  const current = await inspectRoomRun(deps, roomId, runId)
  const { run } = current
  const header = { id: run.id, status: run.status, ...(run.startedAt ? { startedAt: run.startedAt } : {}),
    ...(run.endedAt ? { endedAt: run.endedAt } : {}), ...(run.elapsedMs !== undefined ? { elapsedMs: run.elapsedMs } : {}),
    ...(run.error ? { error: run.error } : {}) }
  if (current.availability.status !== 'available' || !run.threadId || !run.turnId || !deps.sessions.loadItemPage) {
    return { run: header, steps: [], truncated: false, availability: current.availability }
  }
  const page = await deps.sessions.loadItemPage(run.threadId, { turnId: run.turnId,
    maxItems: STEP_ITEM_LIMIT, maxBytes: STEP_READ_BYTES })
  const items = page.items.filter((item) => item.threadId === run.threadId && item.turnId === run.turnId)
  return { run: header, steps: runSteps(items, run.status), truncated: page.hasMore, availability: current.availability }
}
