import { describe, expect, it } from 'vitest'
import { chatBlockFromItem } from './kun-mapper'
import type { CoreTurnItemJson } from './kun-contract'
import type { ChatBlock, ToolBlock } from './types'
import {
  extractDesignOpenRequest,
  isDesignOpenBlock,
  readDesignOpenRequest
} from './design-open-request'

const REQUEST_ID = 'design_0123456789abcdef'

function callItem(overrides: Partial<CoreTurnItemJson> = {}): CoreTurnItemJson {
  return {
    id: 'item_design_call',
    turnId: 'turn_design',
    threadId: 'thread_design',
    role: 'assistant',
    status: 'completed',
    createdAt: '2026-10-20T00:00:00.000Z',
    kind: 'tool_call',
    toolName: 'design_open',
    callId: 'call_design',
    arguments: { title: 'Update entry', brief: 'Move it to the footer.', target: 'web' },
    ...overrides
  } as CoreTurnItemJson
}

function resultItem(output: Record<string, unknown>, isError = false): CoreTurnItemJson {
  return {
    id: 'item_design_result',
    turnId: 'turn_design',
    threadId: 'thread_design',
    role: 'tool',
    status: 'completed',
    createdAt: '2026-10-20T00:00:01.000Z',
    kind: 'tool_result',
    toolName: 'design_open',
    callId: 'call_design',
    output,
    ...(isError ? { isError: true } : {})
  } as CoreTurnItemJson
}

const queuedOutput = {
  ok: true,
  status: 'queued',
  designRequest: {
    version: 1,
    requestId: REQUEST_ID,
    status: 'queued',
    title: 'Update entry',
    brief: 'Move it to the footer.',
    target: 'web',
    medium: 'html'
  }
}

describe('design_open request mapping', () => {
  it('reads the streamed call as a pending request without an id', () => {
    expect(extractDesignOpenRequest(callItem())).toEqual({
      status: 'pending',
      title: 'Update entry',
      brief: 'Move it to the footer.',
      target: 'web'
    })
  })

  it('reads a queued result with its durable request id', () => {
    expect(extractDesignOpenRequest(resultItem(queuedOutput))).toEqual({
      status: 'queued',
      title: 'Update entry',
      brief: 'Move it to the footer.',
      requestId: REQUEST_ID,
      target: 'web',
      medium: 'html'
    })
  })

  it('rejects a queued result whose id is not a Kun design request id', () => {
    const output = { ...queuedOutput, designRequest: { ...queuedOutput.designRequest, requestId: '../x' } }
    expect(extractDesignOpenRequest(resultItem(output))).toBeUndefined()
  })

  it('maps a tool error to a failed request', () => {
    expect(extractDesignOpenRequest(resultItem({ ok: false, error: 'design_open requires a non-empty title and brief' }, true)))
      .toMatchObject({ status: 'failed', error: 'design_open requires a non-empty title and brief' })
  })

  it('ignores other tools', () => {
    expect(extractDesignOpenRequest(callItem({ toolName: 'design_component' }))).toBeUndefined()
  })

  it('attaches validated metadata and a success status to the tool block', () => {
    const block = chatBlockFromItem(resultItem(queuedOutput)) as ChatBlock
    expect(block.kind).toBe('tool')
    expect((block as ToolBlock).status).toBe('success')
    expect(isDesignOpenBlock(block)).toBe(true)
    expect(readDesignOpenRequest(block)?.requestId).toBe(REQUEST_ID)
  })

  it('does not trust malformed block metadata', () => {
    const block = {
      kind: 'tool',
      id: 'tool_x',
      summary: 'design_open',
      status: 'success',
      toolKind: 'tool_call',
      meta: { toolName: 'design_open', designOpenRequest: { status: 'queued', title: 'X', brief: 'Y' } }
    } as unknown as ChatBlock
    expect(readDesignOpenRequest(block)).toBeUndefined()
    expect(isDesignOpenBlock(block)).toBe(false)
  })
})
