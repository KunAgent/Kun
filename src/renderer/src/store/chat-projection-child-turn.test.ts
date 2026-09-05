import { describe, expect, it } from 'vitest'
import type { ChatBlock, ToolBlock, ToolEventPayload } from '../agent/types'
import {
  findMatchingToolBlockIndex,
  mergeToolProjectionEvents
} from './chat-projection-reducer'

describe('child tool projection scope', () => {
  it('matches exact item in the resumed parent turn before an older card with the same child', () => {
    const oldBlock = childBlock('tool_old', 'turn_old', 'failed', 0)
    const resumedBlock = childBlock('tool_resume', 'turn_resume', 'queued', 1)
    const blocks: ChatBlock[] = [oldBlock, resumedBlock]
    const running = childEvent('tool_resume', 'turn_resume', 'running', 1)

    const index = findMatchingToolBlockIndex(blocks, running)
    expect(index).toBe(1)
    const merged = mergeToolProjectionEvents(toolEventFromBlock(resumedBlock), running)
    expect(oldBlock).toMatchObject({ turnId: 'turn_old', status: 'error' })
    expect(merged).toMatchObject({
      turnId: 'turn_resume', status: 'running',
      meta: { child: { parentTurnId: 'turn_resume', resumeCount: 1 } }
    })
  })

  it('never falls back to child id across parent turns', () => {
    const blocks: ChatBlock[] = [childBlock('tool_old', 'turn_old', 'failed', 0)]
    expect(findMatchingToolBlockIndex(
      blocks,
      childEvent('child_lifecycle_child_1', 'turn_resume', 'running', 1)
    )).toBe(-1)
  })
})

function childBlock(
  id: string,
  parentTurnId: string,
  childStatus: 'queued' | 'failed',
  resumeCount: number
): ToolBlock {
  return {
    kind: 'tool', id, turnId: parentTurnId, summary: 'delegate_task',
    status: childStatus === 'failed' ? 'error' : 'running',
    detail: JSON.stringify({ childId: 'child_1', status: childStatus, resumeCount }),
    meta: {
      toolName: 'delegate_task',
      child: {
        parentThreadId: 'thread_1', parentTurnId, childId: 'child_1',
        childStatus, childSeq: 1, resumeCount
      }
    }
  }
}

function childEvent(
  itemId: string,
  parentTurnId: string,
  childStatus: 'running',
  resumeCount: number
): ToolEventPayload {
  return {
    itemId, turnId: parentTurnId, summary: 'delegate_task', status: 'running', updateOnly: true,
    detail: JSON.stringify({ childId: 'child_1', status: childStatus, resumeCount }),
    meta: {
      child: {
        parentThreadId: 'thread_1', parentTurnId, childId: 'child_1',
        childStatus, childSeq: 1, resumeCount
      }
    }
  }
}

function toolEventFromBlock(block: ToolBlock): ToolEventPayload {
  return {
    itemId: block.id,
    turnId: block.turnId,
    summary: block.summary,
    status: block.status,
    detail: block.detail,
    meta: block.meta
  }
}
