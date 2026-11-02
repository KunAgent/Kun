import { describe, expect, it } from 'vitest'
import type { ChatState } from './chat-store-types'
import { completionProjectionEffects, terminalFailureProjectionEffects } from './chat-projection-effects'

describe('chat projection effects', () => {
  it('drains the queue after failure without prematurely releasing an occupied worktree', () => {
    expect(terminalFailureProjectionEffects('thread_1', false).map((effect) => effect.type)).toEqual([
      'sync_completion_poll', 'refresh_threads', 'drain_queued_messages'
    ])
  })

  it('describes completion browser work explicitly in stable order', () => {
    const effects = completionProjectionEffects({
      state: {} as ChatState,
      threadId: 'thread_1',
      turnId: 'turn_1',
      userBlockId: 'user_1',
      dedupeKey: 'turn:turn_1',
      mirrorText: 'done',
      mirrorThreadId: 'claw_thread_1',
      reconcile: true,
      releaseWorktree: true
    })

    expect(effects.map((effect) => effect.type)).toEqual([
      'mirror_claw_reply',
      'notify_turn_complete',
      'refresh_write_workspace',
      'mirror_sdd_transcript',
      'mirror_design_transcript',
      'sync_completion_poll',
      'reload_completed_turn',
      'refresh_threads',
      'release_worktree',
      'drain_queued_messages'
    ])

    const notify = effects.find((effect) => effect.type === 'notify_turn_complete')
    expect(notify).toMatchObject({ threadId: 'thread_1', turnId: 'turn_1' })
  })
})
