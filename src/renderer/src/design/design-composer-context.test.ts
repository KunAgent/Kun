import { describe, expect, it } from 'vitest'
import { createDefaultShape, createEmptyDocument, createHtmlFrameShape, type CanvasDocument } from './canvas/canvas-types'
import {
  buildDesignTargetContextChip,
  designComposerContextTargetsKey,
  designContextChipsForRoute,
  designTargetContextChip,
  designHtmlElementContextTarget,
  designSelectedContextLocations,
  isHtmlElementContextChipId,
  nextSuppressedDesignContextIds,
  reconcileDesignHtmlElementContext,
  resolveDesignComposerContextViewTargets,
  resolveDesignComposerContextTargets,
  resolveDesignComposerScreenFrameTarget
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
  it('creates a non-removable design target context chip with web default', () => {
    expect(designTargetContextChip({ label: 'Web', detail: 'Default 1280 x 800 web frame' })).toEqual({
      id: 'design-target:web',
      kind: 'design-target',
      label: 'Web',
      detail: 'Default 1280 x 800 web frame',
      removable: false
    })
    expect(designTargetContextChip({ designTarget: 'app', label: 'App' })).toEqual({
      id: 'design-target:app',
      kind: 'design-target',
      label: 'App',
      removable: false
    })
  })

  it('builds localized design target chips from the target frame size', () => {
    expect(buildDesignTargetContextChip({
      designTarget: 'app',
      webLabel: 'Web',
      appLabel: 'App',
      detail: ({ width, height, target }) => `${target}:${width}x${height}`
    })).toEqual({
      id: 'design-target:app',
      kind: 'design-target',
      label: 'App',
      detail: 'app:390x844',
      removable: false
    })
  })

  it('builds route-scoped context targets and chips', () => {
    const html = artifact('screen-a')
    const element = {
      artifactId: html.id,
      artifactTitle: html.title,
      artifactRelativePath: html.relativePath,
      selector: '#cta',
      tagName: 'button',
      text: 'Start',
      html: '<button id="cta">Start</button>'
    }
    const targets = resolveDesignComposerContextViewTargets({
      route: 'design',
      artifacts: [html],
      activeArtifactId: html.id,
      canvasDocument: createEmptyDocument(),
      selectedIds: new Set(),
      htmlElementContext: element
    })

    expect(designComposerContextTargetsKey(targets)).toBe(
      'html-element:screen-a:#cta|html-artifact:screen-a'
    )
    expect(designContextChipsForRoute({
      route: 'design',
      targetChip: designTargetContextChip({ label: 'Web' }),
      targets
    }).map((chip) => chip.id)).toEqual([
      'design-target:web',
      'html-element:screen-a:#cta',
      'html-artifact:screen-a'
    ])
    expect(designContextChipsForRoute({
      route: 'chat',
      targetChip: designTargetContextChip({ label: 'Web' }),
      targets
    })).toEqual([])
  })

  it('reconciles stale HTML element context when the active design target changes', () => {
    const html = artifact('screen-a')
    const canvas = artifact('board', 'canvas')
    const context = {
      artifactId: html.id,
      artifactTitle: html.title,
      artifactRelativePath: html.relativePath,
      selector: '#cta',
      tagName: 'button',
      text: 'Start',
      html: '<button id="cta">Start</button>'
    }

    expect(reconcileDesignHtmlElementContext({
      current: context,
      route: 'design',
      artifacts: [canvas, html],
      activeArtifactId: canvas.id
    })).toBe(context)
    expect(reconcileDesignHtmlElementContext({
      current: context,
      route: 'design',
      artifacts: [html],
      activeArtifactId: 'other'
    })).toBeNull()
    expect(reconcileDesignHtmlElementContext({
      current: context,
      route: 'chat',
      artifacts: [html],
      activeArtifactId: html.id
    })).toBeNull()
  })

  it('updates suppressed context ids and detects HTML element chips', () => {
    const next = nextSuppressedDesignContextIds(new Set(['a']), 'html-element:x')
    expect([...next]).toEqual(['a', 'html-element:x'])
    expect(isHtmlElementContextChipId('html-element:x')).toBe(true)
    expect(isHtmlElementContextChipId('html-artifact:x')).toBe(false)
  })

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

  it('can resolve a linked HTML frame target by shape id without relying on selection', () => {
    const canvas = artifact('canvas', 'canvas')
    const linked = artifact('login')
    const other = artifact('other')
    const frame = createHtmlFrameShape('Login screen', 0, 0, linked.id, 'desktop')
    const doc = withShape(frame)

    const target = resolveDesignComposerScreenFrameTarget({
      artifacts: [canvas, linked, other],
      canvasDocument: doc,
      shapeId: frame.id
    })

    expect(target).toMatchObject({
      kind: 'html-screen-frame',
      artifact: linked,
      shape: frame,
      chip: {
        id: `html-screen-frame:${frame.id}:login`,
        label: 'login'
      }
    })
  })

  it('does not let an explicit HTML frame target bypass suppressed context chips', () => {
    const linked = artifact('login')
    const frame = createHtmlFrameShape('Login screen', 0, 0, linked.id, 'desktop')
    const doc = withShape(frame)

    expect(resolveDesignComposerScreenFrameTarget({
      artifacts: [linked],
      canvasDocument: doc,
      shapeId: frame.id,
      suppressedIds: new Set([`html-screen-frame:${frame.id}:login`])
    })).toBeNull()
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

  it('does not expose a canvas modify context when no shape is selected', () => {
    const canvas = artifact('canvas', 'canvas')
    const image = createDefaultShape('image', 20, 40)
    const doc = withShape(image)

    const targets = resolveDesignComposerContextTargets({
      artifacts: [canvas],
      activeArtifactId: canvas.id,
      canvasDocument: doc,
      selectedIds: new Set()
    })

    expect(targets).toEqual([])
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

  it('labels a picked component chip and keeps it on the code whiteboard', () => {
    const html = artifact('screen-a')
    const element = {
      artifactId: html.id,
      artifactTitle: html.title,
      artifactRelativePath: html.relativePath,
      selector: '[data-kun-source-id="cta"]',
      tagName: 'BUTTON',
      text: '接管',
      html: '<button>接管</button>',
      label: 'Button · 接管',
      path: ['Page', 'Card', 'Button'],
      componentName: 'Button',
      frameId: 'shape-screen',
      previewRevision: 3
    }
    const target = designHtmlElementContextTarget({ artifacts: [html], element })
    expect(target).toMatchObject({
      kind: 'html-element',
      chip: {
        id: 'html-element:screen-a:shape-screen:[data-kun-source-id="cta"]',
        label: 'Button · 接管',
        detail: 'Page / Card / Button'
      }
    })
    const targets = resolveDesignComposerContextViewTargets({
      route: 'code',
      artifacts: [html],
      activeArtifactId: html.id,
      canvasDocument: createEmptyDocument(),
      selectedIds: new Set(),
      htmlElementContext: element
    })
    expect(targets.map((entry) => entry.kind)).toEqual(['html-element'])
    expect(designContextChipsForRoute({
      route: 'code',
      targetChip: designTargetContextChip({ label: 'Web' }),
      targets
    }).map((chip) => chip.label)).toEqual(['Button · 接管'])
    expect(designContextChipsForRoute({
      route: 'chat',
      targetChip: designTargetContextChip({ label: 'Web' }),
      targets
    })).toEqual([])
  })
})

describe('designSelectedContextLocations', () => {
  it('points at the HTML artifact file + directory for an html target', () => {
    const html = artifact('screen-a')
    const targets = resolveDesignComposerContextTargets({
      artifacts: [html],
      activeArtifactId: html.id,
      canvasDocument: createEmptyDocument(),
      selectedIds: new Set()
    })

    expect(designSelectedContextLocations({ targets })).toEqual([
      {
        title: 'screen-a',
        kind: 'html',
        path: '.kun-design/screen-a/v1.html',
        directory: '.kun-design/screen-a'
      }
    ])
  })

  it('points a canvas selection at the board canvas.json directory', () => {
    const canvas = artifact('board', 'canvas')
    const rect = createDefaultShape('rect', 0, 0)
    const doc = withShape(rect)
    const targets = resolveDesignComposerContextTargets({
      artifacts: [canvas],
      activeArtifactId: canvas.id,
      canvasDocument: doc,
      selectedIds: new Set([rect.id])
    })

    expect(designSelectedContextLocations({ targets, canvasArtifact: canvas })).toEqual([
      {
        title: 'board',
        kind: 'canvas',
        path: '.kun-design/board/canvas.json',
        directory: '.kun-design/board'
      }
    ])
  })

  it('adds a path pointer for a selected workspace-file image but skips inline data URLs', () => {
    const canvas = artifact('board', 'canvas')
    const fileImage = createDefaultShape('image', 0, 0)
    fileImage.name = 'Hero'
    fileImage.imageUrl = '.deepseekgui-images/hero.png'
    const dataImage = createDefaultShape('image', 50, 50)
    dataImage.imageUrl = 'data:image/png;base64,AAAA'
    const doc = createEmptyDocument()
    for (const shape of [fileImage, dataImage]) {
      doc.objects[shape.id] = shape
      doc.objects[doc.rootId].children.push(shape.id)
    }
    const targets = resolveDesignComposerContextTargets({
      artifacts: [canvas],
      activeArtifactId: canvas.id,
      canvasDocument: doc,
      selectedIds: new Set([fileImage.id, dataImage.id])
    })

    const locations = designSelectedContextLocations({ targets, canvasArtifact: canvas })
    expect(locations).toContainEqual({
      title: 'Hero',
      kind: 'image',
      path: '.deepseekgui-images/hero.png',
      directory: '.deepseekgui-images'
    })
    expect(locations.some((loc) => loc.path.startsWith('data:'))).toBe(false)
  })

  it('returns [] when nothing is selected', () => {
    const canvas = artifact('board', 'canvas')
    const targets = resolveDesignComposerContextTargets({
      artifacts: [canvas],
      activeArtifactId: canvas.id,
      canvasDocument: createEmptyDocument(),
      selectedIds: new Set()
    })

    expect(designSelectedContextLocations({ targets, canvasArtifact: canvas })).toEqual([])
  })
})
