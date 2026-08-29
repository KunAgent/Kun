import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { CanvasToolbar } from './CanvasToolbar'

describe('CanvasToolbar prototype playback', () => {
  it('hides design-only controls on the code canvas', () => {
    const html = renderToStaticMarkup(
      createElement(CanvasToolbar, {
        workspaceRoot: '/workspace',
        surface: 'code',
        onExportCanvas: async () => {}
      })
    )

    expect(html).toContain('aria-label="Select"')
    expect(html).toContain('aria-label="Frame"')
    expect(html).toContain('aria-label="AI image"')
    expect(html).toContain('aria-label="Upload image to whiteboard"')
    expect(html).toContain('aria-label="Export whiteboard"')
    expect(html).not.toContain('aria-label="AI image slot"')
    expect(html).not.toContain('aria-label="Upload files to canvas"')
    expect(html).not.toContain('aria-label="Screen"')
    expect(html).not.toContain('aria-label="Design context"')
    expect(html).not.toContain('aria-label="Agent actions"')
    expect(html).not.toContain('aria-label="Critique canvas"')
    expect(html).not.toContain('aria-label="Open design assistant"')
    expect(html).not.toContain('aria-label="Play prototype"')
  })

  it('uses the diagram toolset on the central Work whiteboard', () => {
    const html = renderToStaticMarkup(
      createElement(CanvasToolbar, {
        workspaceRoot: '/workspace',
        surface: 'work',
        onExportCanvas: async () => {}
      })
    )

    expect(html).toContain('aria-label="Select"')
    expect(html).toContain('aria-label="AI image"')
    expect(html).toContain('aria-label="Export whiteboard"')
    expect(html).not.toContain('aria-label="Screen"')
    expect(html).not.toContain('aria-label="Play prototype"')
  })

  it('shows agent action seeds on the design canvas', () => {
    const html = renderToStaticMarkup(
      createElement(CanvasToolbar, {
        workspaceRoot: '/workspace'
      })
    )

    expect(html).toContain('aria-label="Agent actions"')
  })

  it('keeps common tools compact while exposing the full drawing set in a menu', () => {
    const html = renderToStaticMarkup(
      createElement(CanvasToolbar, {
        workspaceRoot: '/workspace'
      })
    )

    expect(html).toContain('aria-label="Select"')
    expect(html).toContain('aria-label="Screen"')
    expect(html).toContain('aria-label="Frame"')
    expect(html).toContain('aria-label="Hand"')
    expect(html).toContain('aria-label="More drawing tools"')
    expect(html).toContain('aria-label="Layers"')
    expect(html).toContain('aria-label="Upload files to canvas"')
    expect(html).not.toContain('aria-label="AI image slot"')
    expect(html).not.toContain('aria-label="Rectangle"')
    expect(html).not.toContain('aria-label="Ellipse"')
    expect(html).not.toContain('aria-label="Text"')
    expect(html).not.toContain('aria-label="Arrow"')
    expect(html).not.toContain('aria-label="Line"')
    expect(html).not.toContain('aria-label="Draw"')
  })

  it('explains why prototype playback is disabled before a screen exists', () => {
    const html = renderToStaticMarkup(
      createElement(CanvasToolbar, {
        workspaceRoot: '/workspace',
        prototypePlayable: false,
        onOpenPrototypePlayer: () => {}
      })
    )

    expect(html).toContain('Create at least one screen before playing the prototype')
    expect(html).toContain(
      'aria-label="Create at least one screen before playing the prototype"'
    )
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="Create at least one screen before playing the prototype"/)
  })

  it('keeps the normal play affordance when prototype screens exist', () => {
    const html = renderToStaticMarkup(
      createElement(CanvasToolbar, {
        workspaceRoot: '/workspace',
        prototypePlayable: true,
        onOpenPrototypePlayer: () => {}
      })
    )

    expect(html).toContain('aria-label="Play prototype"')
    expect(html).not.toContain('Create at least one screen before playing the prototype')
  })

  it('routes the assistant action through the active composer callback', async () => {
    const onRequestCanvasCritique = vi.fn()
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(
        createElement(CanvasToolbar, {
          workspaceRoot: '/workspace',
          onRequestCanvasCritique
        })
      )
    })
    await act(async () => renderer.root.findByProps({ 'aria-label': 'Critique canvas' }).props.onClick())
    expect(onRequestCanvasCritique).toHaveBeenCalledWith(expect.stringContaining('current canvas'))
    await act(async () => renderer.unmount())
  })

  it('opens the full drawing tool menu and exposes every supported tool', async () => {
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(CanvasToolbar, { workspaceRoot: '/workspace' }))
    })
    await act(async () => renderer.root.findByProps({ 'aria-label': 'More drawing tools' }).props.onClick())
    const menuLabels = renderer.root
      .findAllByProps({ role: 'menuitemradio' })
      .map((item) => item.findByType('span').children.join(''))
    expect(menuLabels).toEqual(expect.arrayContaining([
      'AI image slot', 'Rectangle', 'Ellipse', 'Text', 'Arrow', 'Line', 'Draw'
    ]))
    await act(async () => renderer.unmount())
  })
})
