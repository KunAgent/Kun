import { describe, expect, it } from 'vitest'
import type { CoreTurnItemJson } from '../../agent/kun-contract'
import { structuredRoomRunArtifacts } from './RoomRunArtifacts'
import { roomExcalidrawRequestFromItem } from './useRoomExcalidrawConsumer'

const item = (overrides: Partial<CoreTurnItemJson>): CoreTurnItemJson => ({
  id: 'item', turnId: 'turn', threadId: 'thread', role: 'tool', kind: 'tool_result',
  status: 'completed', createdAt: '2026-09-20T00:00:00.000Z', toolName: 'tool', output: {},
  ...overrides
})

describe('structuredRoomRunArtifacts', () => {
  it('reuses Code mappers for chart, visualization and generated files', () => {
    const chart = item({ id: 'chart', toolName: 'render_chart', output: { status: 'completed', chart: {
      version: 1, type: 'line', title: 'Errors', data: [{ day: 'Mon', count: 3 }],
      x: { field: 'day', label: 'Day' }, y: { field: 'count', label: 'Errors' },
      series: [{ field: 'count', label: 'Errors', color: 'danger' }],
      actions: ['expand', 'download-csv', 'download-png']
    } } })
    const visualization = item({ id: 'visual', toolName: 'show_visualization', output: {
      version: 1, title: 'Flow', sections: [{ kind: 'callout', lines: ['Ready'] }]
    } })
    const generated = item({ id: 'file', toolName: 'generate_image', output: {
      generatedFiles: [{ relativePath: '.kun/images/result.png', mimeType: 'image/png' }]
    } })
    const result = structuredRoomRunArtifacts([chart, visualization, generated])
    expect(result.charts).toHaveLength(1)
    expect(result.visualizations).toHaveLength(1)
    expect(result.generatedFiles).toHaveLength(1)
  })

  it('accepts SDK canvas names but never retries settled or timed-out operations', () => {
    const output = { scope: 'room', status: 'accepted', receiptKey: 'receipt',
      boardId: 'board', workspaceRoot: '/room-workspace' }
    const request = item({ toolName: 'mcp__kun__design_apply_excalidraw', output })
    expect(roomExcalidrawRequestFromItem(request)).toMatchObject({ action: 'apply', workspaceRoot: '/room-workspace' })
    expect(roomExcalidrawRequestFromItem({ ...request, isError: true })).toBeNull()
    expect(roomExcalidrawRequestFromItem({ ...request, output: { ...output, unverified: true } })).toBeNull()
    expect(roomExcalidrawRequestFromItem({ ...request, output: { ...output, status: 'applied' } })).toBeNull()
  })

  it('does not publish failed tool results', () => {
    const result = structuredRoomRunArtifacts([item({
      isError: true, status: 'failed', toolName: 'generate_image',
      output: { generatedFiles: [{ relativePath: '.kun/images/failed.png' }] }
    })])
    expect(result).toEqual({ charts: [], visualizations: [], generatedFiles: [] })
  })
})
