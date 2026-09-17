import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CODE_CANVAS_DIR, codeCanvasArtifactId } from '../../../design/canvas/code-canvas'
import { canvasDocumentKey } from '../../../design/canvas/canvas-persistence'
import { CodeCanvasPanel } from './CodeCanvasPanel'

const mocks = vi.hoisted(() => ({ applyLive: vi.fn() }))

vi.mock('../../../design/canvas/use-apply-shape-ops-live', () => ({
  useApplyShapeOpsLive: (...args: unknown[]) => mocks.applyLive(...args)
}))

vi.mock('./CanvasViewport', () => ({ CanvasViewport: () => createElement('div') }))
vi.mock('./PropertiesPanel', () => ({ PropertiesPanel: () => createElement('div') }))
vi.mock('../../../whiteboard/excalidraw-surface', () => ({
  ExcalidrawSurface: () => createElement('div'),
  CanvasEngineSwitcher: () => createElement('div')
}))

describe('CodeCanvasPanel live replay binding', () => {
  it('waits for the matching per-thread canvas document', () => {
    mocks.applyLive.mockClear()
    renderToStaticMarkup(createElement(CodeCanvasPanel, {
      workspaceRoot: '/workspace',
      activeThreadId: 'thread-code',
      onCollapse: () => undefined
    }))

    expect(mocks.applyLive).toHaveBeenCalledWith(
      true,
      undefined,
      expect.any(Object),
      expect.any(String),
      'thread-code',
      undefined,
      expect.any(Function),
      undefined,
      canvasDocumentKey('/workspace', codeCanvasArtifactId('thread-code'), CODE_CANVAS_DIR),
      undefined,
      'code'
    )
  })
})
