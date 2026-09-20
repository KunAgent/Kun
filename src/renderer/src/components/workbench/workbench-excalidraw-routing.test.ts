import { describe, expect, it } from 'vitest'
import type { ChatBlock, ToolBlock } from '../../agent/types'
import { excalidrawWorkbenchRequestFromBlock } from './workbench-excalidraw-routing'

function tool(id: string, detail: Record<string, unknown>, meta?: Record<string, unknown>): ToolBlock {
  return {
    kind: 'tool', id, turnId: 'turn-1', summary: 'x', status: 'success',
    ...(meta ? { meta } : {}), detail: JSON.stringify(detail)
  }
}

describe('excalidrawWorkbenchRequestFromBlock', () => {
  it('parses an accepted open_excalidraw result with boardId and title', () => {
    expect(excalidrawWorkbenchRequestFromBlock(tool('block-1', {
      tool: 'design_open_excalidraw',
      action: 'open_excalidraw',
      status: 'accepted',
      receiptKey: 'design-receipt-1',
      boardId: 'auth-flow',
      title: 'Auth flow'
    }))).toEqual({
      action: 'open',
      blockId: 'block-1',
      receiptKey: 'design-receipt-1',
      turnId: 'turn-1',
      boardId: 'auth-flow',
      title: 'Auth flow'
    })
  })

  it('parses an accepted apply_excalidraw result with a boardId target', () => {
    expect(excalidrawWorkbenchRequestFromBlock(tool('block-2', {
      tool: 'design_apply_excalidraw',
      action: 'apply_excalidraw',
      status: 'accepted',
      receiptKey: 'design-receipt-2',
      boardId: 'auth-flow'
    }))).toEqual({
      action: 'apply',
      blockId: 'block-2',
      receiptKey: 'design-receipt-2',
      turnId: 'turn-1',
      boardId: 'auth-flow'
    })
  })

  it('parses a bare apply request and falls back to the current turn', () => {
    const block = tool('block-3', {
      tool: 'design_apply_excalidraw',
      action: 'apply_excalidraw',
      status: 'accepted',
      receiptKey: 'design-receipt-3'
    })
    block.turnId = undefined
    expect(excalidrawWorkbenchRequestFromBlock(block, 'turn-live')).toEqual({
      action: 'apply',
      blockId: 'block-3',
      receiptKey: 'design-receipt-3',
      turnId: 'turn-live'
    })
  })

  it('rejects non-tool blocks, non-accepted results, and unrelated tools', () => {
    expect(excalidrawWorkbenchRequestFromBlock({
      kind: 'text', id: 'text-1', turnId: 'turn-1', status: 'success'
    } as unknown as ChatBlock)).toBeNull()
    expect(excalidrawWorkbenchRequestFromBlock(tool('block-4', {
      tool: 'design_apply_excalidraw',
      action: 'apply_excalidraw',
      status: 'applied',
      receiptKey: 'design-receipt-4'
    }))).toBeNull()
    expect(excalidrawWorkbenchRequestFromBlock(tool('block-5', {
      tool: 'design_export_canvas',
      action: 'export_canvas',
      status: 'accepted',
      receiptKey: 'design-receipt-5'
    }))).toBeNull()
    expect(excalidrawWorkbenchRequestFromBlock(tool('block-6', {
      tool: 'design_apply_excalidraw',
      action: 'apply_excalidraw',
      status: 'accepted'
    }))).toBeNull()
    expect(excalidrawWorkbenchRequestFromBlock(tool('block-8', {
      tool: 'design_apply_excalidraw',
      action: 'apply_excalidraw',
      status: 'accepted',
      receiptKey: 'design-receipt-8',
      surface: 'code'
    }))).toBeNull()
    const badJson = tool('block-7', { not: 'json' })
    badJson.detail = 'not-json{'
    expect(excalidrawWorkbenchRequestFromBlock(badJson)).toBeNull()
  })
})
