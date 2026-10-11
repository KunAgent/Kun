import type { TurnItem } from '../contracts/items.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import { WORKBENCH_LIMITS, type WorkbenchResult } from '../contracts/workbench-links.js'
import { extractWorkState } from '../handoff/work-state.js'

const clip = (text: string, max: number) => text.length > max ? text.slice(0, max - 1) + '…' : text

/** Final assistant text of a turn: the last non-empty assistant_text item. */
export function turnFinalText(items: readonly TurnItem[], turnId: string): string {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (item.turnId === turnId && item.kind === 'assistant_text' && item.text.trim()) return item.text.trim()
  }
  return ''
}

/**
 * Bounded outcome of one target turn, used both on the card and as the
 * reference material handed back to the Agent. Nothing here is instruction.
 */
export function summarizeTurnResult(items: readonly TurnItem[], turn: Turn, finishedAt: string,
  taskChangedFiles: readonly string[] = []): WorkbenchResult {
  const turnItems = items.filter((item) => item.turnId === turn.id)
  const text = turnFinalText(items, turn.id)
  const state = extractWorkState(turnItems, { changedFiles: taskChangedFiles })
  const firstLine = text.split('\n').find((line) => line.trim())?.trim() ?? ''
  return {
    summary: clip(firstLine || (turn.status === 'completed' ? 'Task finished.' : 'Task ended without a final message.'), 300),
    finalExcerpt: clip(text, WORKBENCH_LIMITS.maxResultExcerpt),
    changedFiles: state.files.slice(0, WORKBENCH_LIMITS.maxChangedFiles).map((file) => clip(file, 1024)),
    commands: state.commands.slice(-10).map((entry) => ({ command: clip(entry.command, 240),
      ...(entry.exitCode === undefined ? {} : { exitCode: entry.exitCode }) })),
    finishedAt
  }
}

export type ThreadPreview = {
  id: string
  title: string
  project: string
  status: string
  updatedAt: string
  turns: Array<{ status: string; prompt: string; reply: string }>
  files: string[]
  openTodos: string[]
  pendingApprovals: number
  pendingInputs: number
}

/** Compact, reference-only view of a Code thread for `read_code_thread`. */
export function previewThread(thread: ThreadRecord, items: readonly TurnItem[], recentTurns: number,
  pending: { approvals: number; inputs: number }): ThreadPreview {
  const turns = thread.turns.filter((turn) => turn.status !== 'queued').slice(-recentTurns)
  const budget = Math.floor(WORKBENCH_LIMITS.maxThreadReadChars / Math.max(1, turns.length * 2))
  const state = extractWorkState(items)
  return {
    id: thread.id, title: thread.title, project: thread.workspace, status: thread.status, updatedAt: thread.updatedAt,
    turns: turns.map((turn) => ({ status: turn.status, prompt: clip(turn.prompt, Math.min(budget, 600)),
      reply: clip(turnFinalText(items, turn.id), budget) })),
    files: state.files.slice(0, 30), openTodos: state.todos.slice(0, 10).map((todo) => clip(todo, 160)),
    pendingApprovals: pending.approvals, pendingInputs: pending.inputs
  }
}
