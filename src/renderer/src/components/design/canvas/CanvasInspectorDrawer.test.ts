import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it } from 'vitest'
import { Hash, Monitor, Type } from 'lucide-react'
import { CanvasInspectorDrawer } from './CanvasInspectorDrawer'
import { CanvasViewControls } from './CanvasViewControls'
import { canvasLayerIcon, canvasLayerTextPreview } from './CanvasLayersPanel'
import { resolveCanvasCodeTarget } from './CanvasCodePanel'
import { canvasBoardFocusScale } from './CanvasBoardFocusView'
import { selectedHtmlScreen } from './CanvasTweaksPanel'
import { htmlFrameChromeActionLevel, htmlFrameChromeOffset } from './html-frame/HtmlFrameChrome'
import { useCanvasInspectorStore } from '../../../design/canvas/canvas-inspector-store'
import {
  createDefaultShape,
  createHtmlFrameShape,
  type CanvasShape
} from '../../../design/canvas/canvas-types'
import type { DesignArtifact } from '../../../design/design-types'

const createdAt = '2026-10-24T00:00:00.000Z'

function screenArtifact(id: string): DesignArtifact {
  return {
    id,
    kind: 'html',
    title: 'Checkout',
    relativePath: `.kun-design/doc/${id}/v2.html`,
    createdAt,
    updatedAt: '2026-10-24T01:00:00.000Z',
    versions: [
      { id: `${id}-v1`, relativePath: `.kun-design/doc/${id}/v1.html`, createdAt, summary: '' },
      { id: `${id}-v2`, relativePath: `.kun-design/doc/${id}/v2.html`, createdAt, summary: '' }
    ]
  }
}

afterEach(() => {
  useCanvasInspectorStore.setState({ open: false, tab: 'properties' })
})

describe('canvas inspector drawer', () => {
  it('lists Tweaks only on the Design surface and starts with an empty properties state', () => {
    const design = renderToStaticMarkup(createElement(CanvasInspectorDrawer, {
      surface: 'design', workspaceRoot: '/workspace', height: 300, hostHeight: 900
    }))
    expect(design).toContain('data-canvas-inspector-tab="properties"')
    expect(design).toContain('data-canvas-inspector-tab="tweaks"')
    expect(design).toContain('Select a layer on the canvas to edit its properties.')
    expect(design).toContain('height:300px')

    const code = renderToStaticMarkup(createElement(CanvasInspectorDrawer, {
      surface: 'code', workspaceRoot: '/workspace', height: 300, hostHeight: 900
    }))
    expect(code).toContain('data-canvas-inspector-tab="code"')
    expect(code).not.toContain('data-canvas-inspector-tab="tweaks"')
  })

  it('falls back to Properties when the stored tab is not offered', async () => {
    useCanvasInspectorStore.setState({ tab: 'tweaks' })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(CanvasInspectorDrawer, {
        surface: 'code', workspaceRoot: '/workspace', height: 300, hostHeight: 900
      }))
    })
    const selected = renderer.root.findAll((node) => node.props.role === 'tab' && node.props['aria-selected'] === true)
    expect(selected.map((node) => node.props['data-canvas-inspector-tab'])).toEqual(['properties'])
    await act(async () => renderer.unmount())
  })
})

describe('canvas view controls', () => {
  it('explains disabled playback and reflects the inspector toggle', async () => {
    const html = renderToStaticMarkup(createElement(CanvasViewControls, {
      showPrototypePlay: true,
      prototypePlayable: false,
      onOpenPrototypePlayer: () => {}
    }))
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="Create at least one screen before playing the prototype"/)

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(CanvasViewControls, {}))
    })
    const toggle = () => renderer.root.findByProps({ 'data-canvas-inspector-toggle': 'true' })
    expect(toggle().props['aria-pressed']).toBe(false)
    await act(async () => toggle().props.onClick())
    expect(useCanvasInspectorStore.getState().open).toBe(true)
    expect(toggle().props['aria-pressed']).toBe(true)
    expect(toggle().props['aria-label']).toBe('Hide inspector')
    await act(async () => renderer.unmount())
  })

  it('omits playback and the inspector where the canvas has neither', () => {
    const html = renderToStaticMarkup(createElement(CanvasViewControls, {
      inspectorAvailable: false,
      extraActions: createElement('button', { 'aria-label': 'Collapse' })
    }))
    expect(html).not.toContain('Play prototype')
    expect(html).not.toContain('data-canvas-inspector-toggle')
    expect(html).toContain('aria-label="Collapse"')
  })
})

describe('outline rows', () => {
  it('quotes text content after the layer name and marks screens and frames', () => {
    const text = { ...createDefaultShape('text', 0, 0), name: 'Title', textContent: 'One tray:\n progress lives here' }
    expect(canvasLayerTextPreview(text)).toBe('One tray: progress lives here')
    expect(canvasLayerTextPreview({ ...text, textContent: 'Title' })).toBe('')
    expect(canvasLayerTextPreview(text, 10)).toBe('One tray:…')
    expect(canvasLayerIcon(text)).toBe(Type)
    expect(canvasLayerIcon(createDefaultShape('frame', 0, 0))).toBe(Hash)
    expect(canvasLayerIcon(createHtmlFrameShape('Home', 0, 0, 'home'))).toBe(Monitor)
  })
})

describe('code tab target', () => {
  it('reads the pinned version file of one HTML board', () => {
    const artifact = screenArtifact('checkout')
    const frame = createHtmlFrameShape('Checkout', 0, 0, 'checkout', 'mobile', 'checkout-v1')
    expect(resolveCanvasCodeTarget({ [frame.id]: frame }, [frame.id], [artifact])).toEqual({
      kind: 'file',
      path: '.kun-design/doc/checkout/v1.html',
      revision: artifact.updatedAt
    })
  })

  it('shows vector layers as JSON without inlining large data URLs', () => {
    const image: CanvasShape = { ...createDefaultShape('image', 0, 0), imageUrl: `data:image/png;base64,${'A'.repeat(200)}` }
    const rect = createDefaultShape('rect', 10, 10)
    const target = resolveCanvasCodeTarget({ [image.id]: image, [rect.id]: rect }, [image.id, rect.id], [])
    expect(target?.kind).toBe('layers')
    const parsed = JSON.parse(target?.kind === 'layers' ? target.content : '[]') as CanvasShape[]
    expect(parsed).toHaveLength(2)
    expect(parsed[0].imageUrl?.endsWith('…')).toBe(true)
    expect(resolveCanvasCodeTarget({}, [], [])).toBeNull()
  })
})

describe('board chrome and focus view', () => {
  it('scales a board to fit or to fill the available width', () => {
    const available = { width: 1064, height: 664 }
    expect(canvasBoardFocusScale('fit', available, { width: 1000, height: 1200 })).toBeCloseTo(0.5)
    expect(canvasBoardFocusScale('fill', available, { width: 1000, height: 1200 })).toBeCloseTo(1)
    expect(canvasBoardFocusScale('fit', { width: 0, height: 0 }, { width: 1000, height: 600 })).toBe(0.05)
  })

  it('drops board actions before the board name as boards get narrow', () => {
    expect(htmlFrameChromeOffset(400)).toBe(30)
    expect(htmlFrameChromeOffset(120)).toBe(22)
    expect(htmlFrameChromeActionLevel({ screenWidth: 400, active: false })).toBe('full')
    expect(htmlFrameChromeActionLevel({ screenWidth: 200, active: true })).toBe('basic')
    expect(htmlFrameChromeActionLevel({ screenWidth: 120, active: true })).toBe('expand')
    expect(htmlFrameChromeActionLevel({ screenWidth: 120, active: false })).toBe('none')
  })

  it('offers screen tweaks only for exactly one HTML board', () => {
    const frame = createHtmlFrameShape('Home', 0, 0, 'home')
    const rect = createDefaultShape('rect', 0, 0)
    const objects = { [frame.id]: frame, [rect.id]: rect }
    expect(selectedHtmlScreen(objects, [frame.id])?.id).toBe(frame.id)
    expect(selectedHtmlScreen(objects, [frame.id, rect.id])).toBeNull()
    expect(selectedHtmlScreen(objects, [rect.id])).toBeNull()
  })
})
