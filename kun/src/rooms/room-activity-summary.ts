import type { RoomStore } from './room-store.js'

const taskRunning = ['queued', 'running', 'waiting_dependency', 'stopping']
const taskAttention = ['needs_input', 'needs_approval', 'recovery_required', 'failed', 'awaiting_acceptance']
const integrationRunning = ['preparing', 'validating']
const integrationAttention = ['recovery_required', 'conflict', 'ready', 'failed']
type ActivityProjection = {
  task?: { status: string; requestId?: string }
  requestId?: string
  taskId?: string
  status?: string
  cancelRequested?: boolean
  attention?: { approvalIds: string[]; userInputIds: string[] } | null
  applyIntent?: unknown
}

/** Count unique tasks per category, including their independently running integrations. */
export async function roomActivitySummary(store: RoomStore, roomId?: string) {
  const running = new Set<string>()
  const attention = new Set<string>()
  for (const kind of ['task', 'integration', 'request'] as const) {
    let afterSeq: number | undefined
    for (;;) {
      const rows = await store.list<ActivityProjection>(kind, { roomId, order: 'asc', afterSeq, limit: 1000,
        activityOnly: true,
        status: kind === 'task' ? [...taskRunning, ...taskAttention] : kind === 'request' ?
          ['pending', 'running', 'stopping', 'needs_input', 'failed', 'recovery_required'] : [...integrationRunning, ...integrationAttention] })
      for (const row of rows) {
        const value = row.value
        const key = JSON.stringify([row.roomId, kind === 'task' ? row.id : row.taskId ?? value.taskId ?? row.id])
        const requestId = kind === 'request' ? row.id : value.task?.requestId ?? value.requestId
        const attentionKey = requestId ? JSON.stringify([row.roomId, 'request', requestId]) : key
        if (kind === 'task') {
          if (taskRunning.includes(value.task?.status ?? '')) running.add(key)
          if (taskAttention.includes(value.task?.status ?? '')) attention.add(attentionKey)
        } else if (kind === 'request') {
          if (['needs_input', 'failed', 'recovery_required'].includes(value.status ?? '')) attention.add(attentionKey)
          if (['pending', 'running', 'stopping'].includes(value.status ?? '')) running.add(attentionKey)
        } else {
          if (value.status === 'failed' && value.cancelRequested && !value.applyIntent) continue
          if (integrationRunning.includes(value.status ?? '')) running.add(key)
          if (integrationAttention.includes(value.status ?? '') || value.applyIntent ||
            value.attention?.approvalIds?.length || value.attention?.userInputIds?.length) attention.add(attentionKey)
        }
      }
      if (rows.length < 1000) break
      afterSeq = rows.at(-1)!.seq
    }
  }
  return { runningCount: running.size, attentionCount: attention.size }
}
