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
    arguments: {
      title: 'Update entry',
      target: 'web',
      screens: [{ name: 'Footer', html: '<p>footer</p>' }, { name: 'Pill', html: '<p>pill</p>' }]
    },
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

const DOCUMENT_ID = '0a1b2c3d'
const SCREEN_ID = '9f8e7d6c'

const readyOutput = {
  ok: true,
  status: 'ready',
  designRequest: {
    version: 2,
    requestId: REQUEST_ID,
    status: 'ready',
    title: 'Update entry',
    documentId: DOCUMENT_ID,
    target: 'web',
    screens: [{
      artifactId: SCREEN_ID,
      name: 'Footer',
      relativePath: `.kun-design/${DOCUMENT_ID}/${SCREEN_ID}/v1.html`,
      width: 1280,
      height: 800
    }]
  }
}

const legacyOutput = {
  ok: true,
  status: 'queued',
  designRequest: { version: 1, requestId: REQUEST_ID, status: 'queued', title: 'Update entry', brief: 'Move it.' }
}

describe('design_open request mapping', () => {
  it('reads the streamed call as pending, counting screens without carrying their html', () => {
    const request = extractDesignOpenRequest(callItem())
    expect(request).toEqual({ status: 'pending', title: 'Update entry', screenCount: 2, screens: [], target: 'web' })
    expect(JSON.stringify(request)).not.toContain('<p>')
  })

  it('reads a ready result with the screens written into its document folder', () => {
    expect(extractDesignOpenRequest(resultItem(readyOutput))).toEqual({
      status: 'ready',
      title: 'Update entry',
      requestId: REQUEST_ID,
      documentId: DOCUMENT_ID,
      target: 'web',
      screenCount: 1,
      screens: [{
        artifactId: SCREEN_ID,
        name: 'Footer',
        relativePath: `.kun-design/${DOCUMENT_ID}/${SCREEN_ID}/v1.html`,
        width: 1280,
        height: 800
      }]
    })
  })

  it('drops screens whose path leaves their design document folder', () => {
    const escaped = {
      ...readyOutput,
      designRequest: {
        ...readyOutput.designRequest,
        screens: [{ ...readyOutput.designRequest.screens[0], relativePath: '../../etc/passwd' }]
      }
    }
    expect(extractDesignOpenRequest(resultItem(escaped))).toMatchObject({ status: 'failed' })
  })

  it('keeps old queued requests readable as legacy', () => {
    expect(extractDesignOpenRequest(resultItem(legacyOutput))).toMatchObject({
      status: 'legacy',
      title: 'Update entry',
      requestId: REQUEST_ID
    })
  })

  it('maps a tool error to a failed request', () => {
    expect(extractDesignOpenRequest(resultItem({ ok: false, error: 'design_open requires at least one screen' }, true)))
      .toMatchObject({ status: 'failed', error: 'design_open requires at least one screen' })
  })

  it('ignores other tools', () => {
    expect(extractDesignOpenRequest(callItem({ toolName: 'design_component' }))).toBeUndefined()
  })

  it('attaches validated metadata and a success status to the tool block', () => {
    const block = chatBlockFromItem(resultItem(readyOutput)) as ChatBlock
    expect(block.kind).toBe('tool')
    expect((block as ToolBlock).status).toBe('success')
    expect(isDesignOpenBlock(block)).toBe(true)
    expect(readDesignOpenRequest(block)).toMatchObject({ status: 'ready', documentId: DOCUMENT_ID })
  })

  it('does not trust malformed block metadata', () => {
    const block = {
      kind: 'tool',
      id: 'tool_x',
      summary: 'design_open',
      status: 'success',
      toolKind: 'tool_call',
      meta: { toolName: 'design_open', designOpenRequest: { status: 'ready', title: 'X', documentId: 'nope' } }
    } as unknown as ChatBlock
    expect(readDesignOpenRequest(block)).toBeUndefined()
    expect(isDesignOpenBlock(block)).toBe(false)
  })
})
