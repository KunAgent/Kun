import type { ThreadSummary } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'

export function matchesThreadSearch(thread: ThreadSummary, query: string): boolean {
  return [
    thread.id, thread.title, thread.workspace, thread.model, thread.mode,
    thread.forkedFromTitle, thread.forkedFromThreadId
  ].some((value) => value?.toLowerCase().includes(query))
}

export function threadStatusFromTurns(turns: Turn[]): 'idle' | 'running' {
  return turns.some((turn) => turn.status === 'queued' || turn.status === 'running')
    ? 'running'
    : 'idle'
}
