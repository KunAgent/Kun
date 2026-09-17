import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../../i18n'
import { useDesignWorkspaceStore } from '../../../design/design-workspace-store'
import type { DesignArtifact, DesignDocument } from '../../../design/design-types'
import {
  DesignDocumentCanvasSurface,
  canvasDocumentReadyForRuntime
} from './DesignDocumentCanvasSurface'

vi.mock('./CanvasViewport', () => ({
  CanvasViewport: (props: { artifactId?: string; surface?: string }) =>
    createElement('canvas-viewport-stub', {
      'data-artifact-id': props.artifactId ?? '',
      'data-surface': props.surface ?? ''
    })
}))

vi.mock('../../../whiteboard/excalidraw-surface', () => ({
  ExcalidrawSurface: (props: { identityId?: string }) =>
    createElement('excalidraw-stub', { 'data-mock-excalidraw': props.identityId ?? '' }),
  CanvasEngineSwitcher: () => createElement('engine-switcher-stub')
}))

vi.mock('./PropertiesPanel', () => ({
  PropertiesPanel: () => createElement('properties-stub')
}))

vi.mock('../../../design/svg/use-svg-artifact-status-monitor', () => ({
  useSvgArtifactStatusMonitor: () => undefined
}))

vi.mock('../../../design/canvas/use-apply-shape-ops-live', () => ({
  useApplyShapeOpsLive: () => undefined
}))

vi.mock('../../../design/canvas/screen-artifact-bridge', () => ({
  setScreenCreationFactory: () => undefined
}))

vi.mock('../../../design/canvas/canvas-export', () => ({
  exportActiveCanvasToWorkspace: async () => ({ ok: true })
}))

vi.mock('../../../design/design-board', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../design/design-board')>()
  return {
    ...actual,
    ensureDesignBoardArtifact: vi.fn(async () => null)
  }
})

const now = '2026-08-01T00:00:00.000Z'

function canvasArtifact(id: string, updatedAt: string): DesignArtifact {
  return {
    id,
    kind: 'canvas',
    title: `Board ${id}`,
    relativePath: `.kun-design/doc-a/${id}/canvas.json`,
    createdAt: now,
    updatedAt,
    versions: [{ id: `${id}-v1`, relativePath: `.kun-design/doc-a/${id}/canvas.json`, createdAt: now, summary: '' }]
  }
}

function setDocumentWithBoards(artifacts: DesignArtifact[], engine?: DesignDocument['engine']): void {
  const document: DesignDocument = {
    id: 'doc-a',
    title: 'Doc A',
    createdAt: now,
    updatedAt: now,
    order: 0,
    artifacts,
    activeArtifactId: null,
    ...(engine ? { engine } : {})
  }
  useDesignWorkspaceStore.setState({
    workspaceRoot: '/workspace',
    documents: [document],
    activeDocumentId: document.id,
    artifacts,
    activeArtifactId: null,
    settingsLoaded: true,
    drawingCreationOpen: false,
    drawingCreationDocumentId: null
  })
}

async function render(element: ReturnType<typeof createElement>): Promise<ReactTestRenderer> {
  let view!: ReactTestRenderer
  await act(async () => {
    view = create(element)
  })
  return view
}

describe('DesignDocumentCanvasSurface', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    useDesignWorkspaceStore.getState().resetWorkspace()
  })

  it('keeps canvas replay disabled until the authoritative document key loads', () => {
    expect(canvasDocumentReadyForRuntime('/workspace/doc/board', null)).toBe(false)
    expect(canvasDocumentReadyForRuntime('/workspace/doc/board', '/workspace/doc/other')).toBe(false)
    expect(canvasDocumentReadyForRuntime('/workspace/doc/board', '/workspace/doc/board')).toBe(true)
  })

  it('picks the most recently updated board when no board is pinned', async () => {
    setDocumentWithBoards([
      canvasArtifact('board-old', '2026-08-01T00:00:00.000Z'),
      canvasArtifact('board-new', '2026-08-02T00:00:00.000Z')
    ])
    const view = await render(createElement(DesignDocumentCanvasSurface, {
      workspaceRoot: '/workspace',
      documentId: 'doc-a',
      activeThreadId: null
    }))
    expect(view.root.findByProps({ 'data-artifact-id': 'board-new' })).toBeTruthy()
  })

  it('renders the pinned board when boardArtifactId is provided', async () => {
    setDocumentWithBoards([
      canvasArtifact('board-old', '2026-08-01T00:00:00.000Z'),
      canvasArtifact('board-new', '2026-08-02T00:00:00.000Z')
    ])
    const view = await render(createElement(DesignDocumentCanvasSurface, {
      workspaceRoot: '/workspace',
      documentId: 'doc-a',
      activeThreadId: null,
      boardArtifactId: 'board-old'
    }))
    expect(view.root.findByProps({ 'data-artifact-id': 'board-old' })).toBeTruthy()
    expect(view.root.findAllByProps({ 'data-artifact-id': 'board-new' })).toHaveLength(0)
  })

  it('shows an unavailable state instead of switching boards when the pinned board is missing', async () => {
    setDocumentWithBoards([canvasArtifact('board-new', '2026-08-02T00:00:00.000Z')])
    const view = await render(createElement(DesignDocumentCanvasSurface, {
      workspaceRoot: '/workspace',
      documentId: 'doc-a',
      activeThreadId: null,
      boardArtifactId: 'board-missing'
    }))
    expect(JSON.stringify(view.toJSON())).toContain('The whiteboard bound to this Design task is unavailable.')
    expect(view.root.findAllByProps({ 'data-artifact-id': 'board-new' })).toHaveLength(0)
  })

  it('hosts Excalidraw instead of ShapeOps when the drawing engine is excalidraw', async () => {
    setDocumentWithBoards([canvasArtifact('board-new', '2026-08-02T00:00:00.000Z')], 'excalidraw')
    const view = await render(createElement(DesignDocumentCanvasSurface, {
      workspaceRoot: '/workspace',
      documentId: 'doc-a',
      activeThreadId: null
    }))
    expect(view.root.findByProps({ 'data-mock-excalidraw': 'doc-a' })).toBeTruthy()
    expect(view.root.findByProps({ 'data-canvas-engine': 'excalidraw' })).toBeTruthy()
    expect(JSON.stringify(view.toJSON())).not.toContain('canvas-viewport-stub')
    expect(JSON.stringify(view.toJSON())).not.toContain('properties-stub')
  })
})
