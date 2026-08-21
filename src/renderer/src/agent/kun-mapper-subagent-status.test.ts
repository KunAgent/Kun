import { describe, expect, it } from 'vitest'
import type { CoreRuntimeEventJson } from './kun-contract'
import { runtimeProjectionActionsFromEvent } from './kun-mapper-events'

describe('subagent runtime event mapping', () => {
  it.each(['queued', 'running'] as const)(
    'maps a detached delegate result with child status %s to running',
    (status) => {
      const actions = runtimeProjectionActionsFromEvent({
        kind: 'item_completed',
        seq: 1,
        timestamp: '2026-08-20T00:00:00.000Z',
        threadId: 'thread_parent',
        turnId: 'turn_parent',
        item: {
          id: 'item_delegate_result',
          threadId: 'thread_parent',
          turnId: 'turn_parent',
          role: 'tool',
          status: 'completed',
          createdAt: '2026-08-20T00:00:00.000Z',
          kind: 'tool_result',
          callId: 'call_delegate',
          toolName: 'delegate_task',
          toolKind: 'tool_call',
          isError: false,
          output: { childId: 'child_dynamic', status, detached: true }
        }
      } as CoreRuntimeEventJson)

      expect(actions).toEqual([expect.objectContaining({
        type: 'tool_updated',
        payload: expect.objectContaining({
          itemId: 'tool_call_delegate', status: 'running'
        })
      })])
    }
  )

  it.each([
    ['completed', 'success'],
    ['failed', 'error'],
    ['aborted', 'error']
  ] as const)('maps child lifecycle %s to %s', (childStatus, status) => {
    const actions = runtimeProjectionActionsFromEvent(childEvent(childStatus))

    expect(actions).toEqual([expect.objectContaining({
      type: 'tool_updated',
      payload: expect.objectContaining({
        status,
        updateOnly: true,
        meta: {
          child: expect.objectContaining({
            childId: 'child_dynamic', childStatus, detached: true
          })
        }
      })
    })])
  })
})

function childEvent(
  childStatus: 'completed' | 'failed' | 'aborted'
): CoreRuntimeEventJson {
  return {
    kind: childStatus === 'completed'
      ? 'turn_completed'
      : childStatus === 'failed' ? 'turn_failed' : 'turn_aborted',
    seq: 2,
    timestamp: '2026-08-20T00:00:01.000Z',
    threadId: 'thread_parent',
    turnId: 'turn_parent',
    child: {
      parentThreadId: 'thread_parent',
      parentTurnId: 'turn_parent',
      childId: 'child_dynamic',
      childStatus,
      childSeq: 1,
      childLauncher: 'delegate_task',
      detached: true
    }
  } as CoreRuntimeEventJson
}
