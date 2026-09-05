import { describe, expect, it, vi } from 'vitest'
import type { TurnService } from '../../services/turn-service.js'
import { startReview } from './review.js'

describe('review admission ordering', () => {
  it('persists the review item and registers dispatch before admission completes', async () => {
    const order: string[] = []
    const started = {
      threadId: 'thread_review',
      turnId: 'turn_review',
      userMessageItemId: 'item_user_review'
    }
    const turns = {
      startTurn: vi.fn(async (
        _input: unknown,
        options?: { onAdmitted?: (response: typeof started) => void | Promise<void> }
      ) => {
        order.push('admitted')
        await options?.onAdmitted?.(started)
        order.push('admission-complete')
        return started
      }),
      applyItem: vi.fn(async () => { order.push('item-persisted') })
    } as unknown as TurnService

    const response = await startReview(
      turns,
      started.threadId,
      new Request('http://127.0.0.1/v1/threads/thread_review/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          target: { kind: 'custom', instructions: 'Review the shutdown path.' }
        })
      }),
      () => { order.push('dispatch-registered') }
    )

    expect(response.status).toBe(202)
    expect(order).toEqual([
      'admitted',
      'item-persisted',
      'dispatch-registered',
      'admission-complete'
    ])
  })
})
