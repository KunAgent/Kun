import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
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

function setDocumentWithBoards(artifacts: DesignArtifact[]): void {
  const document: DesignDocument = {
    id: 'doc-a',
    title: 'Doc A',
    createdAt: now,
    updatedAt: now,
    order: 0,
    artifacts,
    activeArtifactId: null
  }
  useDesignWorkspaceStore.setState({
    workspaceRoot: '/workspace',
    documents: [document],
    activeDocumentId: document.id,
    artifacts,
    activeArtifactId: null,
    settingsLoaded: true
  })
}

describe('DesignDocumentCanvasSurface', () => {
  it('keeps canvas replay disabled until the authoritative document key loads', () => {
    expect(canvasDocumentReadyForRuntime('/workspace/doc/board', null)).toBe(false)
    expect(canvasDocumentReadyForRuntime('/workspace/doc/board', '/workspace/doc/other')).toBe(false)
    expect(canvasDocumentReadyForRuntime('/workspace/doc/board', '/workspace/doc/board')).toBe(true)
  })

  it('picks the most recently updated board when no board is pinned', () => {
    setDocumentWithBoards([
      canvasArtifact('board-old', '2026-08-01T00:00:00.000Z'),
      canvasArtifact('board-new', '2026-08-02T00:00:00.000Z')
    ])
    const html = renderToStaticMarkup(
      createElement(DesignDocumentCanvasSurface, {
        workspaceRoot: '/workspace',
        documentId: 'doc-a',
        activeThreadId: null
      })
    )
    expect(html).toContain('data-artifact-id="board-new"')
  })

  it('renders the pinned board when boardArtifactId is provided', () => {
    setDocumentWithBoards([
      canvasArtifact('board-old', '2026-08-01T00:00:00.000Z'),
      canvasArtifact('board-new', '2026-08-02T00:00:00.000Z')
    ])
    const html = renderToStaticMarkup(
      createElement(DesignDocumentCanvasSurface, {
        workspaceRoot: '/workspace',
        documentId: 'doc-a',
        activeThreadId: null,
        boardArtifactId: 'board-old'
      })
    )
    expect(html).toContain('data-artifact-id="board-old"')
    expect(html).not.toContain('data-artifact-id="board-new"')
  })

  it('shows an unavailable state instead of switching boards when the pinned board is missing', () => {
    setDocumentWithBoards([canvasArtifact('board-new', '2026-08-02T00:00:00.000Z')])
    const html = renderToStaticMarkup(
      createElement(DesignDocumentCanvasSurface, {
        workspaceRoot: '/workspace',
        documentId: 'doc-a',
        activeThreadId: null,
        boardArtifactId: 'board-missing'
      })
    )
    expect(html).toContain('The whiteboard bound to this Design task is unavailable.')
    expect(html).not.toContain('canvas-viewport-stub')
  })
})
