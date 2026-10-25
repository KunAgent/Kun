import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  commitInspectorUpdate,
  buildScreenModifyPrompt,
  shouldPromoteHtmlFrameInspectorUpdateToManual,
  shouldShowImageAnnotationAction
} from './PropertiesPanel'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { createEmptyDocument, createHtmlFrameShape } from '../../../design/canvas/canvas-types'
import { useCanvasUndoStore } from '../../../design/canvas/canvas-undo-store'
import { useDesignWorkspaceStore } from '../../../design/design-workspace-store'
import type { DesignArtifact, DesignDocument } from '../../../design/design-types'

const createdAt = '2026-06-20T00:00:00.000Z'

function artifact(id: string): DesignArtifact {
  const relativePath = `.kun-design/doc/${id}/v1.html`
  return {
    id,
    kind: 'html',
    title: id,
    relativePath,
    createdAt,
    updatedAt: createdAt,
    versions: [{ id: `${id}-v1`, relativePath, createdAt, summary: '' }]
  }
}

function installHtmlFrame(): string {
  const frame = createHtmlFrameShape('Home', 40, 60, 'home', 'mobile')
  const doc = createEmptyDocument()
  doc.objects[frame.id] = { ...frame, parentId: doc.rootId }
  doc.objects[doc.rootId] = { ...doc.objects[doc.rootId], children: [frame.id] }
  useCanvasShapeStore.getState().loadDocument(doc)
  const screen = artifact('home')
  const designDoc: DesignDocument = {
    id: 'doc',
    title: 'Doc',
    createdAt,
    updatedAt: createdAt,
    order: 0,
    artifacts: [
      {
        ...screen,
        node: {
          x: 40,
          y: 60,
          width: 390,
          height: 844,
          sizeMode: 'auto',
          viewMode: 'preview'
        }
      }
    ],
    activeArtifactId: screen.id
  }
  useDesignWorkspaceStore.setState({
    workspaceRoot: '/workspace',
    documents: [designDoc],
    activeDocumentId: designDoc.id,
    artifacts: designDoc.artifacts,
    activeArtifactId: screen.id,
    designContext: { designTarget: 'app' },
    fileError: null
  })
  return frame.id
}

beforeEach(() => {
  vi.stubGlobal('window', {
    kunGui: {
      writeWorkspaceFile: vi.fn(async () => ({ ok: true as const }))
    }
  })
  useCanvasShapeStore.getState().loadDocument(createEmptyDocument())
  useCanvasUndoStore.getState().clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PropertiesPanel inspector content', () => {
  it('seeds screen modification in the production composer', () => {
    expect(buildScreenModifyPrompt('Checkout')).toContain('Modify the selected screen "Checkout"')
  })

  it('shows image annotation actions on both design and code surfaces', () => {
    expect(shouldShowImageAnnotationAction('design', true)).toBe(true)
    expect(shouldShowImageAnnotationAction('code', true)).toBe(true)
    expect(shouldShowImageAnnotationAction('work', true)).toBe(true)
    expect(shouldShowImageAnnotationAction('code', false)).toBe(false)
  })

  it('promotes design HTML frame inspector width/height edits to manual sizing', () => {
    const frameId = installHtmlFrame()

    commitInspectorUpdate('design', 'set-w', [frameId], { width: 520 })

    const shape = useCanvasShapeStore.getState().document.objects[frameId]
    const node = useDesignWorkspaceStore.getState().artifacts.find((item) => item.id === 'home')?.node

    expect(shape.width).toBe(520)
    expect(node).toMatchObject({
      x: 40,
      y: 60,
      width: 520,
      height: 844,
      sizeMode: 'manual',
      boardHidden: false,
      viewMode: 'preview'
    })
  })

  it('keeps device preset changes in auto sizing mode', () => {
    const frameId = installHtmlFrame()

    commitInspectorUpdate('design', 'set-device-preset', [frameId], {
      devicePreset: 'desktop',
      width: 1280,
      height: 800
    })

    const shape = useCanvasShapeStore.getState().document.objects[frameId]
    const node = useDesignWorkspaceStore.getState().artifacts.find((item) => item.id === 'home')?.node

    expect(shape).toMatchObject({ devicePreset: 'desktop', width: 1280, height: 800 })
    expect(node).toMatchObject({ width: 390, height: 844, sizeMode: 'auto' })
  })

  it('does not promote non-design inspector size edits', () => {
    expect(shouldPromoteHtmlFrameInspectorUpdateToManual('code', { width: 500 })).toBe(false)
    expect(shouldPromoteHtmlFrameInspectorUpdateToManual('work', { width: 500 })).toBe(false)
    expect(shouldPromoteHtmlFrameInspectorUpdateToManual('design', { x: 20 })).toBe(false)
    expect(shouldPromoteHtmlFrameInspectorUpdateToManual('design', {
      devicePreset: 'mobile',
      width: 390,
      height: 844
    })).toBe(false)
  })
})
