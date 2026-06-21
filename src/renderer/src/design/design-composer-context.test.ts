import { describe, expect, it } from 'vitest'
import { createDefaultShape, createEmptyDocument, createHtmlFrameShape, type CanvasDocument } from './canvas/canvas-types'
import {
  designHtmlElementContextTarget,
  resolveDesignComposerContextTargets
} from './design-composer-context'
import type { DesignArtifact } from './design-types'

const createdAt = '2026-06-20T00:00:00.000Z'

function artifact(id: string, kind: DesignArtifact['kind'] = 'html'): DesignArtifact {
  const relativePath =
    kind === 'canvas' ? `.kun-design/${id}/canvas.json` : `.kun-design/${id}/v1.html`
  return {
    id,
    kind,
    title: id,
    relativePath,
    createdAt,
    updatedAt: createdAt,
    versions: [{ id: `${id}-v1`, relativePath, createdAt, summary: '' }]
  }
}

function withShape(shape = createDefaultShape('image', 10, 20)): CanvasDocument {
  const doc = createEmptyDocument()
  doc.objects[shape.id] = shape
  doc.objects[doc.rootId].children.push(shape.id)
  return doc
}

describe('design composer context', () => {
  it('uses the active HTML artifact as composer context', () => {
    const html = artifact('screen-a')
    const targets = resolveDesignComposerContextTargets({
      artifacts: [html],
      activeArtifactId: html.id,
      canvasDocument: createEmptyDocument(),
      selectedIds: new Set()
    })

    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({
      kind: 'html-artifact',
      artifact: html,
      chip: { id: 'html-artifact:screen-a', label: 'screen-a' }
    })
  })

  it('routes a selected HTML frame to its linked artifact', () => {
    const canvas = artifact('canvas', 'canvas')
    const linked = artifact('login')
    const frame = createHtmlFrameShape('Login screen', 0, 0, linked.id, 'desktop')
    const doc = withShape(frame)

    const targets = resolveDesignComposerContextTargets({
      artifacts: [canvas, linked],
      activeArtifactId: canvas.id,
      canvasDocument: doc,
      selectedIds: new Set([frame.id])
    })

    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({
      kind: 'html-screen-frame',
      artifact: linked,
      shape: frame
    })
    expect(targets[0]?.chip.detail).toContain('1280 x 800')
  })

  it('uses regular selected canvas shapes as canvas-selection context', () => {
    const canvas = artifact('canvas', 'canvas')
    const image = createDefaultShape('image', 20, 40)
    image.name = 'Hero image'
    image.width = 320
    image.height = 180
    const doc = withShape(image)

    const targets = resolveDesignComposerContextTargets({
      artifacts: [canvas],
      activeArtifactId: canvas.id,
      canvasDocument: doc,
      selectedIds: new Set([image.id])
    })

    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject({
      kind: 'canvas-selection',
      selectedIds: [image.id],
      chip: { label: 'Hero image', detail: 'image - 320 x 180' }
    })
  })

  it('omits suppressed context chips', () => {
    const html = artifact('screen-a')
    const targets = resolveDesignComposerContextTargets({
      artifacts: [html],
      activeArtifactId: html.id,
      canvasDocument: createEmptyDocument(),
      selectedIds: new Set(),
      suppressedIds: new Set(['html-artifact:screen-a'])
    })

    expect(targets).toEqual([])
  })

  it('creates context for a selected HTML element', () => {
    const html = artifact('screen-a')
    const target = designHtmlElementContextTarget({
      artifacts: [html],
      element: {
        artifactId: html.id,
        artifactTitle: html.title,
        artifactRelativePath: html.relativePath,
        selector: 'body > main:nth-of-type(1) > h1:nth-of-type(1)',
        tagName: 'H1',
        text: 'Hello World',
        html: '<h1>Hello World</h1>'
      }
    })

    expect(target).toMatchObject({
      kind: 'html-element',
      artifact: html,
      chip: {
        id: 'html-element:screen-a:body > main:nth-of-type(1) > h1:nth-of-type(1)',
        label: 'h1: Hello World',
        detail: 'body > main:nth-of-type(1) > h1:nth-of-type(1)'
      }
    })
  })
})
