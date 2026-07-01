import { describe, expect, it } from 'vitest'
import { TaskGraph } from './task-graph.js'

describe('TaskGraph', () => {
  it('marks tasks ready only when dependencies have succeeded', () => {
    const g = new TaskGraph({ concurrency: 2 })
    g.add({ id: 'a', title: 'A' })
    g.add({ id: 'b', title: 'B', dependsOn: ['a'] })
    g.reconcile()
    expect(g.get('a')?.state).toBe('ready')
    expect(g.get('b')?.state).toBe('pending')
    g.markRunning('a'); g.markSucceeded('a')
    expect(g.get('b')?.state).toBe('ready')
  })

  it('respects priority and concurrency in nextRunnable', () => {
    const g = new TaskGraph({ concurrency: 2 })
    g.add({ id: 'low', title: 'low', priority: 1 })
    g.add({ id: 'high', title: 'high', priority: 10 })
    g.add({ id: 'mid', title: 'mid', priority: 5 })
    const batch = g.nextRunnable()
    expect(batch.map((t) => t.id)).toEqual(['high', 'mid'])
  })

  it('does not exceed the concurrency limit', () => {
    const g = new TaskGraph({ concurrency: 1 })
    g.add({ id: 'a', title: 'A' })
    g.add({ id: 'b', title: 'B' })
    const first = g.nextRunnable()
    expect(first).toHaveLength(1)
    g.markRunning(first[0].id)
    expect(g.nextRunnable()).toHaveLength(0)
  })

  it('retries a failed task until attempts are exhausted', () => {
    const g = new TaskGraph()
    g.add({ id: 'a', title: 'A', maxAttempts: 2 })
    g.reconcile()
    g.markRunning('a')
    expect(g.markFailed('a', 'boom').retried).toBe(true)
    expect(g.get('a')?.state).toBe('ready')
    g.markRunning('a')
    expect(g.markFailed('a', 'boom again').retried).toBe(false)
    expect(g.get('a')?.state).toBe('failed')
  })

  it('blocks dependents when a dependency fails terminally', () => {
    const g = new TaskGraph()
    g.add({ id: 'a', title: 'A', maxAttempts: 1 })
    g.add({ id: 'b', title: 'B', dependsOn: ['a'] })
    g.reconcile()
    g.markRunning('a')
    g.markFailed('a', 'x')
    expect(g.get('b')?.state).toBe('blocked')
  })

  it('detects dependency cycles', () => {
    const g = new TaskGraph()
    g.add({ id: 'a', title: 'A', dependsOn: ['c'] })
    g.add({ id: 'b', title: 'B', dependsOn: ['a'] })
    expect(() => g.add({ id: 'c', title: 'C', dependsOn: ['b'] })).toThrow(/dependency cycle/)
    expect(g.get('c')).toBeUndefined()
    expect(g.detectCycle()).toBeNull()
  })

  it('pause/resume removes and restores a task from scheduling', () => {
    const g = new TaskGraph()
    g.add({ id: 'a', title: 'A' })
    g.pause('a')
    expect(g.nextRunnable()).toHaveLength(0)
    g.resume('a')
    expect(g.nextRunnable().map((t) => t.id)).toEqual(['a'])
  })

  it('round-trips through JSON', () => {
    const g = new TaskGraph({ concurrency: 3 })
    g.add({ id: 'a', title: 'A', tokenBudget: 1000, worktree: '/wt/a' })
    const restored = TaskGraph.fromJSON(g.toJSON())
    expect(restored.get('a')).toMatchObject({ tokenBudget: 1000, worktree: '/wt/a' })
    expect(restored.toJSON().concurrency).toBe(3)
  })

  it('reports completion when all tasks are terminal', () => {
    const g = new TaskGraph()
    g.add({ id: 'a', title: 'A' })
    g.reconcile(); g.markRunning('a'); g.markSucceeded('a')
    expect(g.isComplete()).toBe(true)
  })

  it('does not rewrite a completed task when cancellation is replayed', () => {
    const g = new TaskGraph()
    g.add({ id: 'a', title: 'A' })
    g.reconcile(); g.markRunning('a'); g.markSucceeded('a')
    g.cancel('a')
    expect(g.get('a')?.state).toBe('succeeded')
  })

  it('blocks a task with a missing dependency and treats blocked as terminal', () => {
    const g = new TaskGraph()
    g.add({ id: 'b', title: 'B', dependsOn: ['does-not-exist'] })
    g.reconcile()
    expect(g.get('b')?.state).toBe('blocked')
    expect(g.isComplete()).toBe(true)
  })

  it('applies exponential backoff between retries via the injected clock', () => {
    let now = 1000
    const g = new TaskGraph({ now: () => now, retryBaseDelayMs: 100, retryMaxDelayMs: 10_000 })
    g.add({ id: 'a', title: 'A', maxAttempts: 3 })
    g.reconcile(); g.markRunning('a'); g.markFailed('a', 'boom')
    // Immediately after failure the task is ready but gated by backoff.
    expect(g.get('a')?.state).toBe('ready')
    expect(g.nextRunnable()).toHaveLength(0)
    now += 100
    expect(g.nextRunnable().map((t) => t.id)).toEqual(['a'])
  })
})
