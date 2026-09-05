import { describe, expect, it, vi } from 'vitest'
import { launchContinuationTurn } from './continuation-turn-launch.js'

describe('launchContinuationTurn', () => {
  it('runs despite diagnostic failure and settles a rejected launch', async () => {
    const runTurn = vi.fn(async () => { throw new Error('loop construction failed') })
    const finishTurn = vi.fn(async () => ({ kind: 'settled', status: 'failed' as const }))
    const record = vi.fn(async () => { throw new Error('event disk full') })

    launchContinuationTurn({
      threadId: 'thread_resume',
      turnId: 'turn_resume',
      runTurn,
      finishTurn: finishTurn as never,
      events: { record } as never,
      diagnostic: {
        kind: 'error', threadId: 'thread_resume', turnId: 'turn_resume',
        message: 'resuming', code: 'resume', severity: 'warning'
      }
    })

    await vi.waitFor(() => expect(finishTurn).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread_resume', turnId: 'turn_resume', status: 'failed',
      code: 'continuation_launch_failed'
    })))
    expect(runTurn).toHaveBeenCalledWith('thread_resume', 'turn_resume')
    expect(record).toHaveBeenCalled()
  })
})
