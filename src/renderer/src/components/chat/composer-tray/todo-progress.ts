import type { ThreadTodoItem } from '../../../agent/types'
import type { TrayTone } from './tray-kind'

/*
 * Pure readings of a thread checklist for the tray's todo segment and sheet.
 * Canonical execution-task status (`taskStatus`) always wins over the legacy
 * checkbox (`status`), so a failed or cancelled task is never shown as done.
 */

export type TodoProgress = {
  completed: number
  /** 1-based index of the current step (0 for an empty list). */
  current: number
  total: number
  allComplete: boolean
}

/** Item states the sheet flags with a small tone pill. */
export type TodoItemFlag = 'waiting' | 'blocked' | 'paused' | 'failed' | 'cancelled'

export const TODO_FLAG_TONE: Record<TodoItemFlag, TrayTone> = {
  waiting: 'waiting',
  blocked: 'waiting',
  paused: 'default',
  failed: 'error',
  cancelled: 'default'
}

export function isTodoItemCompleted(item: ThreadTodoItem): boolean {
  return item.taskStatus ? item.taskStatus === 'succeeded' : item.status === 'completed'
}

export function isTodoItemActive(item: ThreadTodoItem): boolean {
  return item.taskStatus ? item.taskStatus === 'running' : item.status === 'in_progress'
}

/**
 * Still ahead of the agent: running, or waiting its turn (pending, waiting,
 * blocked, paused). Succeeded, failed and cancelled tasks are settled. Kun
 * reports every unfinished canonical task as a legacy `pending` checkbox, so
 * the canonical status decides.
 */
export function isTodoItemOpen(item: ThreadTodoItem): boolean {
  switch (item.taskStatus) {
    case undefined:
      return item.status !== 'completed'
    case 'running':
    case 'pending':
    case 'waiting':
    case 'blocked':
    case 'paused':
      return true
    default:
      return false
  }
}

export function todoItemFlag(item: ThreadTodoItem): TodoItemFlag | null {
  switch (item.taskStatus) {
    case 'waiting':
    case 'blocked':
    case 'paused':
    case 'failed':
    case 'cancelled':
      return item.taskStatus
    default:
      return null
  }
}

/**
 * Completed count and the current step: the first running / in-progress item,
 * else the first open one (a failed or cancelled task is never "next"), else
 * the first unfinished one (a settled list ending in trouble), else the last.
 */
export function getTodoProgress(items: readonly ThreadTodoItem[]): TodoProgress {
  const total = items.length
  const completed = items.filter(isTodoItemCompleted).length
  if (total === 0) return { completed: 0, current: 0, total: 0, allComplete: false }

  const pick = (predicate: (item: ThreadTodoItem) => boolean): number | null => {
    const index = items.findIndex(predicate)
    return index >= 0 ? index : null
  }
  const currentIndex = pick(isTodoItemActive) ??
    pick(isTodoItemOpen) ??
    pick((item) => !isTodoItemCompleted(item)) ??
    total - 1

  return {
    completed,
    current: currentIndex + 1,
    total,
    allComplete: completed === total
  }
}

/**
 * The plan file the checklist was compiled from, when every plan-sourced item
 * names the same one. Null when no item comes from a plan, or several plans
 * are mixed (rows then show their own source).
 */
export function resolveTodoPlanPath(items: readonly ThreadTodoItem[]): string | null {
  let path: string | null = null
  for (const item of items) {
    if (item.source?.kind !== 'plan') continue
    if (path === null) path = item.source.relativePath
    else if (path !== item.source.relativePath) return null
  }
  return path
}

/** Ring color of the segment: the current step's trouble first, then progress. */
export function todoRingTone(current: ThreadTodoItem | undefined, allComplete: boolean): TrayTone {
  const flag = current ? todoItemFlag(current) : null
  if (flag) return TODO_FLAG_TONE[flag]
  return allComplete ? 'done' : 'running'
}

/** Segment tone: needs-attention states first, then live work. */
export function todoSegmentTone(current: ThreadTodoItem | undefined): TrayTone {
  if (!current) return 'default'
  const flag = todoItemFlag(current)
  if (flag) return TODO_FLAG_TONE[flag]
  return isTodoItemActive(current) ? 'running' : 'default'
}
