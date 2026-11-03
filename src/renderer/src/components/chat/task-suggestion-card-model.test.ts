import { describe, expect, it } from 'vitest'
import type { TaskSuggestionTaskView, TaskSuggestionView } from '@shared/task-suggestions'
import { briefFromDraft, formatClock, pendingTaskReports, taskBriefPlainText, taskCardCountdown, taskCardCounts, taskRowPhase } from './task-suggestion-card-model'

const row = (id: string, state: TaskSuggestionTaskView['state'], extra: Partial<TaskSuggestionTaskView> = {}): TaskSuggestionTaskView => ({
  id, title: `Task ${id}`, brief: { goal: 'Goal', scope: ['a'], done: ['b'] }, route: { agentId: 'kun' },
  worktree: true, inheritContext: false, state, attempt: 0, ...extra })
const card = (tasks: TaskSuggestionTaskView[], extra: Partial<TaskSuggestionView> = {}): TaskSuggestionView => ({
  intentId: 'tsg', revision: 3, source: { threadId: 'p', turnId: 't', toolCallId: 'c' }, state: 'active', workspace: '/repo',
  tasks, createdAt: '2026-10-22T00:00:00.000Z', updatedAt: '2026-10-22T00:00:00.000Z', ...extra })

describe('task suggestion card model', () => {
  it('derives waiting from the task thread and counts rows by outcome', () => {
    expect(taskRowPhase(row('1', 'running', { threadId: 'thr' }), { thr: true })).toBe('waiting')
    expect(taskRowPhase(row('1', 'running', { threadId: 'thr' }), {})).toBe('running')
    const counts = taskCardCounts(card([row('1', 'done'), row('2', 'running'), row('3', 'start_failed'), row('4', 'here'), row('5', 'suggested')]))
    expect(counts).toEqual({ total: 5, suggested: 1, started: 2, live: 1, done: 1, failed: 0, startFailed: 1, ignored: 1 })
  })

  it('drains the countdown from the last update to the deadline', () => {
    const countdown = taskCardCountdown(card([row('1', 'suggested')], { state: 'countdown',
      updatedAt: '2026-10-22T00:00:00.000Z', deadline: '2026-10-22T00:01:00.000Z' }), Date.parse('2026-10-22T00:00:18.000Z'))
    expect(countdown).toEqual({ remainingMs: 42_000, fraction: 0.7 })
    expect(formatClock(42_000)).toBe('0:42')
    expect(taskCardCountdown(card([row('1', 'suggested')]), Date.now())).toBeNull()
  })

  it('formats briefs and parses edited lists', () => {
    expect(taskBriefPlainText(row('1', 'suggested', { area: 'backend' }), { goal: 'G', scope: 'S', done: 'D' }))
      .toBe('Task 1\nbackend\n\nG:\nGoal\n\nS:\n- a\n\nD:\n- b')
    expect(briefFromDraft({ goal: ' x ', scope: '- one\n\n• two', done: '' })).toEqual({ goal: 'x', scope: ['one', 'two'], done: [] })
    expect(briefFromDraft({ goal: ' ', scope: '', done: '' })).toBeNull()
  })

  it('lists settled results until acknowledged, oldest first', () => {
    const reports = pendingTaskReports([card([
      row('1', 'done', { result: { turnStatus: 'completed' }, settledAt: '2026-10-22T00:05:00.000Z' }),
      row('2', 'failed', { result: { turnStatus: 'failed' }, settledAt: '2026-10-22T00:02:00.000Z' }),
      row('3', 'done', { result: { turnStatus: 'completed' }, reportAcknowledged: true }),
      row('4', 'running')
    ])])
    expect(reports.map((entry) => [entry.task.id, entry.index])).toEqual([['2', 1], ['1', 0]])
  })
})
