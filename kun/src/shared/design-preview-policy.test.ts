import { describe, expect, it } from 'vitest'
import { ToolResultTurnItem, type TurnItem } from '../contracts/items.js'
import { hasPublishedDesignPreview, DESIGN_PREVIEW_INSTRUCTION } from './design-preview-policy.js'
import { createDesignOpenTool } from '../adapters/tool/design-open-tool.js'
import { DESIGN_MODE_INSTRUCTION } from '../loop/design-mode.js'

function result(toolName: string, output: unknown, turnId = 'turn_1', isError = false): TurnItem {
  return ToolResultTurnItem.parse({
    id: 'result_1', threadId: 'thread_1', turnId, role: 'tool',
    kind: 'tool_result', status: 'completed', createdAt: '2026-10-30T00:00:00Z',
    toolName, callId: 'call_1', toolKind: 'file_change', output, isError
  })
}

describe('design preview turn policy', () => {
  it.each([
    ['design_open', { designRequest: { status: 'ready' } }],
    ['design_component', { componentPrototype: { status: 'completed' } }]
  ])('fences only successful publications in the current turn: %s', (name, output) => {
    const toolName = String(name)
    expect(hasPublishedDesignPreview([result(toolName, output)], 'turn_1')).toBe(true)
    expect(hasPublishedDesignPreview([result(toolName, output)], 'turn_2')).toBe(false)
    expect(hasPublishedDesignPreview([result(toolName, output, 'turn_1', true)], 'turn_1')).toBe(false)
  })

  it('does not fence failed, preparing, unrelated, or malformed results', () => {
    const history = [
      result('design_component', { componentPrototype: { status: 'running' } }),
      result('design_component', { componentPrototype: { status: 'failed' } }),
      result('design_open', null),
      result('design_open', { designRequest: 'invalid' }),
      result('write', { designRequest: { status: 'ready' } })
    ]
    expect(hasPublishedDesignPreview(history, 'turn_1')).toBe(false)
  })

  it('keeps canvas entry and canvas mode explicit about in-app verification', () => {
    expect(createDesignOpenTool().description).toContain(DESIGN_PREVIEW_INSTRUCTION)
    expect(DESIGN_MODE_INSTRUCTION).toContain(DESIGN_PREVIEW_INSTRUCTION)
    expect(DESIGN_PREVIEW_INSTRUCTION).toContain('visual verification was not performed')
  })
})
