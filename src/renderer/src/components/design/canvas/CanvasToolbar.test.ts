import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { CanvasToolbar, canvasToolbarSlots } from './CanvasToolbar'
import { useCanvasInspectorStore } from '../../../design/canvas/canvas-inspector-store'
import { useCanvasViewportStore } from '../../../design/canvas/canvas-viewport-store'

function menuItemLabels(renderer: ReactTestRenderer, role: string): string[] {
  return renderer.root
    .findAll((node) => node.type === 'button' && node.props.role === role)
    .map((item) => item.findAll((node) => node.type === 'span' && typeof node.children[0] === 'string')
      .map((span) => span.children.join(''))[0] ?? '')
}

describe('CanvasToolbar', () => {
  it('lays tools out in one top row with grouped pen, shape and image tools', () => {
    expect(canvasToolbarSlots(true).map((slot) => slot.kind === 'tool' ? slot.tool.id : slot.id)).toEqual([
      'select', 'hand', 'text', 'frame', 'screen', 'pen', 'shape', 'image'
    ])
    expect(canvasToolbarSlots(false).map((slot) => slot.kind === 'tool' ? slot.tool.id : slot.id)).toEqual([
      'select', 'hand', 'text', 'frame', 'pen', 'shape', 'image'
    ])
  })

  it('hides design-only controls on the code canvas', () => {
    const html = renderToStaticMarkup(
      createElement(CanvasToolbar, {
        workspaceRoot: '/workspace',
        surface: 'code',
        onExportCanvas: async () => {}
      })
    )

    expect(html).toContain('role="toolbar"')
    expect(html).toContain('aria-label="Select"')
    expect(html).toContain('aria-label="Frame"')
    expect(html).toContain('aria-label="AI image"')
    expect(html).toContain('aria-label="Canvas menu"')
    expect(html).not.toContain('aria-label="Screen"')
    expect(html).not.toContain('aria-label="Agent actions"')
    expect(html).not.toContain('aria-label="Play prototype"')
  })

  it('shows the screen tool and agent actions on the design canvas', () => {
    const html = renderToStaticMarkup(createElement(CanvasToolbar, { workspaceRoot: '/workspace' }))

    expect(html).toContain('aria-label="Screen"')
    expect(html).toContain('aria-label="Agent actions"')
    expect(html).toContain('aria-label="Pen tools"')
    expect(html).toContain('aria-label="Shape tools"')
    expect(html).toContain('aria-label="AI image slot"')
    expect(html).toContain('title="Select (V)"')
    expect(html).toContain('aria-label="Rectangle"')
    expect(html).not.toContain('aria-label="Ellipse"')
    expect(html).not.toContain('aria-label="Line"')
  })

  it('puts the drawing title on the menu button for hosts without a header', () => {
    const html = renderToStaticMarkup(
      createElement(CanvasToolbar, { workspaceRoot: '/workspace', documentTitle: 'Composer tray' })
    )

    expect(html).toContain('Composer tray')
    expect(html).toContain('data-code-canvas-titlebar="true"')
  })

  it('opens a tool group and keeps the picked tool on its button', async () => {
    useCanvasViewportStore.getState().setActiveTool('select')
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(CanvasToolbar, { workspaceRoot: '/workspace' }))
    })
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Shape tools' }).props.onClick())
    expect(menuItemLabels(renderer, 'menuitemradio')).toEqual(['Rectangle', 'Ellipse'])
    const ellipse = renderer.root.findAll((node) => node.type === 'button' && node.props.role === 'menuitemradio')[1]
    await act(async () => ellipse.props.onClick())
    expect(useCanvasViewportStore.getState().activeTool).toBe('ellipse')
    expect(renderer.root.findAllByProps({ 'aria-label': 'Ellipse', 'aria-pressed': true })).toHaveLength(1)
    await act(async () => renderer.unmount())
    useCanvasViewportStore.getState().setActiveTool('select')
  })

  it('routes critique through the composer and opens the outline from the menu', async () => {
    const onRequestCanvasCritique = vi.fn()
    useCanvasInspectorStore.getState().setOpen(false)
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(CanvasToolbar, { workspaceRoot: '/workspace', onRequestCanvasCritique }))
    })
    const openMenu = async (): Promise<void> => {
      await act(async () => renderer.root.findByProps({ 'aria-label': 'Canvas menu' }).props.onClick())
    }
    const item = (label: string) => renderer.root.find((node) => (
      node.type === 'button' && node.props.role === 'menuitem' &&
      node.findAll((child) => child.type === 'span' && child.children.join('') === label).length > 0
    ))
    await openMenu()
    await act(async () => item('Critique canvas').props.onClick())
    expect(onRequestCanvasCritique).toHaveBeenCalledWith(expect.stringContaining('current canvas'))
    await openMenu()
    await act(async () => item('Outline').props.onClick())
    expect(useCanvasInspectorStore.getState()).toMatchObject({ open: true, tab: 'outline' })
    await act(async () => renderer.unmount())
    useCanvasInspectorStore.getState().setOpen(false)
  })
})
