import { describe, expect, it } from 'vitest'
import type { ToolEventPayload } from '../agent/types'
import { mergeToolProjectionEvents } from './chat-projection-reducer'

describe('detached subagent tool projection', () => {
  it('replaces hydrated queued child metadata with authoritative running state', () => {
    const hydrated = childEvent('running', 'queued', false)
    const running = childEvent('running', 'running', false)
    running.updateOnly = true

    const projected = mergeToolProjectionEvents(hydrated, running)

    expect(projected.status).toBe('running')
    expect(projected.meta?.child).toMatchObject({
      childId: 'child_dynamic', childStatus: 'running', detached: false
    })
    expect(JSON.parse(projected.detail ?? '{}')).toMatchObject({ status: 'running' })
  })

  it('keeps a dynamically detached child running when the wrapper succeeds', () => {
    const foreground = childEvent('running', 'running', false)
    const detached = childEvent('running', 'running', true)
    const wrapper = childEvent('success', 'running', true)

    const projected = mergeToolProjectionEvents(
      mergeToolProjectionEvents(foreground, detached),
      wrapper
    )

    expect(projected.status).toBe('running')
    expect(projected.meta?.child).toMatchObject({
      childId: 'child_dynamic', childStatus: 'running', detached: true
    })
  })

  it.each([
    ['completed', 'success'],
    ['failed', 'error'],
    ['aborted', 'error']
  ] as const)('settles only on child terminal status %s', (childStatus, expected) => {
    const running = childEvent('running', 'running', true)
    const wrapper = childEvent('success', 'running', true)
    const terminal = childEvent(expected, childStatus, true)

    expect(mergeToolProjectionEvents(
      mergeToolProjectionEvents(running, wrapper),
      terminal
    ).status).toBe(expected)
  })

  it('handles lifecycle-before-result and result-before-lifecycle orders', () => {
    const lifecycle = childEvent('running', 'running', true)
    const result = childEvent('success', 'running', true)

    expect(mergeToolProjectionEvents(lifecycle, result).status).toBe('running')
    expect(mergeToolProjectionEvents(result, lifecycle).status).toBe('running')
  })

  it('keeps terminal child evidence over same-attempt running replay', () => {
    const completed = childEvent('success', 'completed', true)
    const replayed = mergeToolProjectionEvents(completed, childEvent('running', 'running', true))

    expect(replayed.status).toBe('success')
    expect(replayed.meta?.child).toMatchObject({ childStatus: 'completed' })
  })

  it('preserves a full terminal result when minimal terminal lifecycle replays', () => {
    const completed = childEvent('success', 'completed', true)
    completed.summary = 'Full delegated conclusion'
    completed.detail = JSON.stringify({
      childId: 'child_dynamic', status: 'completed', detached: true,
      resumeCount: 0, summary: 'Detailed child result', toolInvocations: 4
    })
    const lifecycle = childEvent('success', 'completed', true)
    lifecycle.updateOnly = true
    lifecycle.summary = 'delegate_task'

    const replayed = mergeToolProjectionEvents(completed, lifecycle)

    expect(replayed.summary).toBe('Full delegated conclusion')
    expect(replayed.detail).toContain('Detailed child result')
    expect(replayed.detail).toContain('toolInvocations')
  })

  it('allows a newer foreground resume without retaining old attempt metadata', () => {
    const failed = childEvent('error', 'failed', true, 0)
    Object.assign(failed.meta!.child as Record<string, unknown>, {
      childTerminationReason: 'child_error', failure: { source: 'runtime' }, resumable: true
    })
    const resumedEvent = childEvent('running', 'running', false, 1)
    const resumedChild = resumedEvent.meta!.child as Record<string, unknown>
    delete resumedChild.detached
    const resumed = mergeToolProjectionEvents(failed, resumedEvent)

    expect(resumed.status).toBe('running')
    expect(resumed.meta?.child).toMatchObject({ childStatus: 'running', resumeCount: 1 })
    expect(resumed.meta?.child).not.toHaveProperty('detached')
    expect(resumed.meta?.child).not.toHaveProperty('failure')
    expect(resumed.meta?.child).not.toHaveProperty('childTerminationReason')
    expect(resumed.meta?.child).not.toHaveProperty('resumable')
  })

  it('allows a newer resume attempt to return to running and rejects an older replay', () => {
    const failed = childEvent('error', 'failed', true, 0)
    const resumed = mergeToolProjectionEvents(failed, childEvent('running', 'running', true, 1))
    const stale = mergeToolProjectionEvents(resumed, childEvent('running', 'running', true, 0))

    expect(resumed.status).toBe('running')
    expect(resumed.meta?.child).toMatchObject({ childStatus: 'running', resumeCount: 1 })
    expect(stale.status).toBe('running')
    expect(stale.meta?.child).toMatchObject({ childStatus: 'running', resumeCount: 1 })
  })

  it('keeps ordinary tool monotonic behavior unchanged', () => {
    const success = ordinaryEvent('success')
    expect(mergeToolProjectionEvents(success, ordinaryEvent('running')).status).toBe('success')
  })
})

function childEvent(
  status: ToolEventPayload['status'],
  childStatus: 'queued' | 'running' | 'completed' | 'failed' | 'aborted',
  detached: boolean,
  resumeCount = 0
): ToolEventPayload {
  return {
    itemId: 'tool_delegate_dynamic',
    turnId: 'turn_parent',
    summary: 'delegate_task',
    status,
    toolKind: 'tool_call',
    detail: JSON.stringify({
      childId: 'child_dynamic', status: childStatus, detached, resumeCount
    }),
    meta: {
      toolName: 'delegate_task',
      child: {
        parentThreadId: 'thread_parent',
        parentTurnId: 'turn_parent',
        childId: 'child_dynamic',
        childStatus,
        childSeq: 1,
        detached,
        resumeCount
      }
    }
  }
}

function ordinaryEvent(status: ToolEventPayload['status']): ToolEventPayload {
  return {
    itemId: 'tool_read',
    summary: 'read',
    status,
    toolKind: 'tool_call',
    meta: { toolName: 'read' }
  }
}
