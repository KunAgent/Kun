import { describe, expect, it } from 'vitest'
import {
  inferClientUserMessageSource,
  isBackgroundShellNoticeUserMessage
} from '@shared/background-shell-notice'
import type { ChatBlock } from '../agent/types'
import {
  hasPendingRuntimeWork,
  isOptimisticUserBlockId,
  reconcileOptimisticUserBlock,
  settlePendingRuntimeWorkAfterInterrupt,
  threadHasPendingRuntimeWork,
  upsertUserBlock
} from './chat-store-runtime-helpers'

describe('chat store runtime helpers', () => {
  it('detects optimistic user block ids', () => {
    expect(isOptimisticUserBlockId('u-123')).toBe(true)
    expect(isOptimisticUserBlockId('q-123-0')).toBe(true)
    expect(isOptimisticUserBlockId('item_turn_abc_user')).toBe(false)
  })

  it('tags background shell notices locally from xml text without server metadata', () => {
    const noticeText =
      '<background_shell_completed><session_id>abcd1234</session_id><command>npm run build</command><exit_code>0</exit_code><output_preview>ok</output_preview><hint>read output</hint></background_shell_completed>'
    expect(inferClientUserMessageSource(noticeText)).toBe('background_shell')
    expect(
      isBackgroundShellNoticeUserMessage({
        text: noticeText
      })
    ).toBe(true)
  })

  it('preserves the original user prompt when a background shell notice arrives', () => {
    const originalUser: ChatBlock = {
      kind: 'user',
      id: 'item_turn_abc_user',
      text: 'Run build in background'
    }
    const blocks: ChatBlock[] = [originalUser]
    const notice = {
      itemId: 'item_steered_notice',
      turnId: 'turn_abc',
      text: '<background_shell_completed><session_id>abcd1234</session_id><command>npm run build</command><exit_code>0</exit_code><output_preview>ok</output_preview><hint>read output</hint></background_shell_completed>',
      meta: {
        displayText: 'Background shell abcd1234 completed'
      }
    }

    const canReconcileOptimisticUser =
      !isBackgroundShellNoticeUserMessage(notice) &&
      'item_turn_abc_user' !== notice.itemId &&
      isOptimisticUserBlockId('item_turn_abc_user')

    expect(canReconcileOptimisticUser).toBe(false)

    const reconciledBlocks = canReconcileOptimisticUser
      ? reconcileOptimisticUserBlock(blocks, 'item_turn_abc_user', notice.itemId, notice.text)
      : blocks
    const nextBlocks = upsertUserBlock(reconciledBlocks, notice)

    expect(nextBlocks).toHaveLength(2)
    expect(nextBlocks[0]).toMatchObject({
      kind: 'user',
      id: 'item_turn_abc_user',
      text: 'Run build in background'
    })
    expect(nextBlocks[1]).toMatchObject({
      kind: 'user',
      id: 'item_steered_notice',
      meta: { messageSource: 'background_shell' }
    })
  })

  it('does not count detached running subagents as pending parent work', () => {
    const detachedSubagent: ChatBlock = {
      kind: 'tool',
      id: 'tool_delegate_background',
      summary: 'delegate_task',
      status: 'running',
      toolKind: 'tool_call',
      detail: JSON.stringify({
        childId: 'child-background',
        status: 'running',
        detached: true
      })
    }

    expect(hasPendingRuntimeWork(detachedSubagent)).toBe(false)
    expect(threadHasPendingRuntimeWork([{ kind: 'user', id: 'user-1', text: 'run background' }, detachedSubagent])).toBe(false)
    expect(settlePendingRuntimeWorkAfterInterrupt([detachedSubagent])[0]).toMatchObject({
      kind: 'tool',
      status: 'running'
    })
  })

  it('still settles foreground running subagents after interrupt', () => {
    const foregroundSubagent: ChatBlock = {
      kind: 'tool',
      id: 'tool_delegate_foreground',
      summary: 'delegate_task',
      status: 'running',
      toolKind: 'tool_call',
      detail: JSON.stringify({
        childId: 'child-foreground',
        status: 'running',
        detached: false
      })
    }

    expect(hasPendingRuntimeWork(foregroundSubagent)).toBe(true)
    expect(threadHasPendingRuntimeWork([{ kind: 'user', id: 'user-1', text: 'run foreground' }, foregroundSubagent])).toBe(true)
    expect(settlePendingRuntimeWorkAfterInterrupt([foregroundSubagent])[0]).toMatchObject({
      kind: 'tool',
      status: 'error'
    })
  })
})
