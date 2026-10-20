import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../agent/types'
import {
  AGENT_DESIGN_SESSION_ID,
  agentDesignPassPrompt,
  deriveDesignOpenCardState,
  partitionTurnRequests,
  queuedDesignOpenBlocks,
  settleForeignRecord,
  type AgentDesignRequestRecord
} from './agent-design-requests'
import type { DesignOpenRequestMetadata } from '../agent/design-open-request'

function designBlock(id: string, turnId: string, requestId: string, status: 'queued' | 'pending' = 'queued'): ChatBlock {
  return {
    kind: 'tool',
    id,
    turnId,
    summary: 'design_open',
    status: status === 'queued' ? 'success' : 'running',
    toolKind: 'file_change',
    meta: {
      toolName: 'design_open',
      designOpenRequest: {
        status,
        title: `Design ${id}`,
        brief: 'Brief',
        ...(status === 'queued' ? { requestId } : {})
      }
    }
  } as unknown as ChatBlock
}

const queued: DesignOpenRequestMetadata = {
  status: 'queued',
  title: 'Footer entry',
  brief: 'Move the update button.',
  requestId: 'design_0123456789abcdef'
}

function record(phase: AgentDesignRequestRecord['phase'], sessionId = AGENT_DESIGN_SESSION_ID): AgentDesignRequestRecord {
  return {
    requestId: queued.requestId!,
    threadId: 'thread-1',
    turnId: 'turn-1',
    phase,
    sessionId,
    updatedAt: 1
  }
}

describe('agent design requests', () => {
  it('lists only queued requests in timeline order', () => {
    const blocks = [
      designBlock('a', 'turn-1', 'design_aaaaaaaaaaaaaaaa'),
      designBlock('b', 'turn-1', 'design_bbbbbbbbbbbbbbbb', 'pending'),
      designBlock('c', 'turn-2', 'design_cccccccccccccccc')
    ]
    expect(queuedDesignOpenBlocks(blocks).map((ref) => ref.request.requestId))
      .toEqual(['design_aaaaaaaaaaaaaaaa', 'design_cccccccccccccccc'])
  })

  it('runs only the last request of a reply and skips earlier ones', () => {
    const refs = queuedDesignOpenBlocks([
      designBlock('a', 'turn-1', 'design_aaaaaaaaaaaaaaaa'),
      designBlock('b', 'turn-1', 'design_bbbbbbbbbbbbbbbb'),
      designBlock('c', 'turn-2', 'design_cccccccccccccccc')
    ])
    const { run, skip } = partitionTurnRequests(refs, 'turn-1')
    expect(run?.request.requestId).toBe('design_bbbbbbbbbbbbbbbb')
    expect(skip.map((ref) => ref.request.requestId)).toEqual(['design_aaaaaaaaaaaaaaaa'])
    expect(partitionTurnRequests(refs, 'turn-9')).toEqual({ run: null, skip: [] })
  })

  it('settles records left by an earlier window so they never auto-start', () => {
    expect(settleForeignRecord(record('waiting', 'old')).phase).toBe('cancelled')
    expect(settleForeignRecord(record('starting', 'old')).phase).toBe('cancelled')
    expect(settleForeignRecord(record('running', 'old')).phase).toBe('ready')
    expect(settleForeignRecord(record('failed', 'old')).phase).toBe('failed')
    expect(settleForeignRecord(record('waiting')).phase).toBe('waiting')
  })

  it('derives the card state from the request, its record, and the thread', () => {
    const base = { request: queued, requestTurnLive: false, threadBusy: false, threadHasDesign: false }
    expect(deriveDesignOpenCardState({ ...base, request: { ...queued, status: 'pending', requestId: undefined }, requestTurnLive: true }))
      .toBe('pending')
    expect(deriveDesignOpenCardState({ ...base, request: { ...queued, status: 'pending', requestId: undefined } }))
      .toBe('failed')
    expect(deriveDesignOpenCardState({ ...base, request: { ...queued, status: 'failed' } })).toBe('failed')
    expect(deriveDesignOpenCardState({ ...base, requestTurnLive: true })).toBe('queued')
    expect(deriveDesignOpenCardState(base)).toBe('not-started')
    expect(deriveDesignOpenCardState({ ...base, threadHasDesign: true })).toBe('ready')
    expect(deriveDesignOpenCardState({ ...base, record: record('waiting') })).toBe('queued')
    expect(deriveDesignOpenCardState({ ...base, record: record('starting') })).toBe('starting')
    expect(deriveDesignOpenCardState({ ...base, record: record('running'), threadBusy: true })).toBe('designing')
    expect(deriveDesignOpenCardState({ ...base, record: record('running') })).toBe('ready')
    expect(deriveDesignOpenCardState({ ...base, record: record('failed') })).toBe('start-failed')
    expect(deriveDesignOpenCardState({ ...base, record: record('skipped') })).toBe('superseded')
    expect(deriveDesignOpenCardState({ ...base, record: record('cancelled') })).toBe('not-started')
  })

  it('tells the Design pass where the brief came from', () => {
    expect(agentDesignPassPrompt(queued)).toBe(
      'Design request from the coding agent in this conversation: Footer entry\n\nMove the update button.'
    )
  })
})
