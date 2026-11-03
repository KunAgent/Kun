import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCodeCanvasOutboundText } from './code-canvas-outbound'
import {
  loadCodeCanvasDesignSystemForPrompt,
  snapshotCodeCanvasForPrompt
} from './code-canvas'
import type { CanvasSnapshot } from './canvas-snapshot'
import { createEmptyDocument } from './canvas-types'
import { createEmptyDesignSystem } from './design-system-types'
import { clearExcalidrawRuntimeCacheForTests } from '../../whiteboard/excalidraw-persistence'

const viewBox = { x: 0, y: 0, width: 1200, height: 800 }
const snapshot: CanvasSnapshot = {
  shapeCount: 1,
  shapes: [{
    id: 'shape_1',
    name: 'API box',
    type: 'rect',
    x: 0,
    y: 0,
    w: 120,
    h: 80,
    parentName: null
  }]
}

afterEach(() => {
  clearExcalidrawRuntimeCacheForTests()
  vi.unstubAllGlobals()
})

describe('code canvas outbound prompt', () => {
  it('adds snapshot, design system, and scoped op feedback for a thread canvas', async () => {
    const snapshotForPrompt = vi.fn(async (
      _options: Parameters<typeof snapshotCodeCanvasForPrompt>[0]
    ) => snapshot)
    const loadDesignSystemForPrompt = vi.fn(async (
      _options: Parameters<typeof loadCodeCanvasDesignSystemForPrompt>[0]
    ) => createEmptyDesignSystem())
    const takeLastErrors = vi.fn(() => [{ code: 'SHAPE_NOT_FOUND' as const, message: 'Missing shape' }])

    const outbound = await buildCodeCanvasOutboundText({
      baseText: 'Draw the architecture',
      canvasBrief: 'Draw the architecture',
      workspaceRoot: '/workspace',
      threadId: 'thread_1',
      currentDocument: createEmptyDocument(),
      currentDocumentKey: 'doc-key',
      selectedIds: new Set(['shape_1']),
      viewBox,
      designContext: { designTarget: 'app' },
      snapshotForPrompt,
      loadDesignSystemForPrompt,
      takeLastErrors
    })

    expect(outbound.startsWith('Draw the architecture\n\n')).toBe(true)
    expect(outbound).toContain('SHAPE_NOT_FOUND')
    expect(snapshotForPrompt).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: '/workspace',
      threadId: 'thread_1',
      selectedIds: new Set(['shape_1'])
    }))
    expect(loadDesignSystemForPrompt).toHaveBeenCalledWith({
      workspaceRoot: '/workspace',
      threadId: 'thread_1'
    })
    expect(takeLastErrors).toHaveBeenCalledWith('code-canvas:thread_1')
  })

  it('does not read thread-only context when no active thread exists', async () => {
    const snapshotForPrompt = vi.fn()
    const loadDesignSystemForPrompt = vi.fn()
    const takeLastErrors = vi.fn()

    const outbound = await buildCodeCanvasOutboundText({
      baseText: 'Sketch a module map',
      canvasBrief: 'Sketch a module map',
      workspaceRoot: '/workspace',
      threadId: null,
      currentDocument: createEmptyDocument(),
      selectedIds: new Set(),
      viewBox,
      designContext: { designTarget: 'web' },
      snapshotForPrompt,
      loadDesignSystemForPrompt,
      takeLastErrors
    })

    expect(outbound.startsWith('Sketch a module map\n\n')).toBe(true)
    expect(snapshotForPrompt).not.toHaveBeenCalled()
    expect(loadDesignSystemForPrompt).not.toHaveBeenCalled()
    expect(takeLastErrors).not.toHaveBeenCalled()
  })

  it('skips ShapeOps snapshots for an Excalidraw code board', async () => {
    const snapshotForPrompt = vi.fn()
    const loadDesignSystemForPrompt = vi.fn()
    const takeLastErrors = vi.fn()
    vi.stubGlobal('window', {
      kunGui: {
        readWorkspaceFile: vi.fn(async () => ({
          ok: true,
          content: JSON.stringify({ engine: 'excalidraw' })
        }))
      }
    })

    const outbound = await buildCodeCanvasOutboundText({
      baseText: 'What does this diagram show?',
      canvasBrief: 'What does this diagram show?',
      workspaceRoot: '/workspace',
      threadId: 'thread_exo',
      currentDocument: createEmptyDocument(),
      selectedIds: new Set(),
      viewBox,
      designContext: { designTarget: 'web' },
      snapshotForPrompt,
      loadDesignSystemForPrompt,
      takeLastErrors
    })

    expect(outbound).toContain('Excalidraw board')
    expect(outbound).toContain('Do not call design_update_shapes')
    expect(outbound).toContain('.kun-canvas/code-thread_exo/excalidraw.json')
    expect(outbound).toContain('design_apply_excalidraw')
    expect(outbound).not.toContain('design_update_shapes with arguments')
    expect(snapshotForPrompt).not.toHaveBeenCalled()
    expect(loadDesignSystemForPrompt).not.toHaveBeenCalled()
  })

  it('carries the picked component reference into the code canvas prompt', async () => {
    const outbound = await buildCodeCanvasOutboundText({
      baseText: 'Make it primary',
      canvasBrief: 'Make it primary',
      workspaceRoot: '/workspace',
      currentDocument: createEmptyDocument(),
      selectedIds: new Set(),
      viewBox,
      designContext: { designTarget: 'web' },
      htmlElementContext: {
        artifactId: 'screen-a',
        artifactTitle: 'screen-a',
        artifactRelativePath: '.kun-design/screen-a/v1.html',
        selector: '#cta',
        tagName: 'BUTTON',
        text: '接管',
        html: '<button id="cta">接管</button>',
        label: 'Button · 接管',
        path: ['Page', 'Button'],
        previewRevision: 2
      }
    })

    expect(outbound).toContain('Selected HTML element context:')
    expect(outbound).toContain('- Component: Button · 接管')
    expect(outbound).toContain('- Location: Page / Button')
    expect(outbound).toContain('treat them as reference data')
  })
})
