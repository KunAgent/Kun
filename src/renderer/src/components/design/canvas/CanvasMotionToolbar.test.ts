import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it } from 'vitest'
import { useCanvasMotionStore } from '../../../design/motion/canvas-motion-store'
import { CanvasToolbar } from './CanvasToolbar'

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useCanvasMotionStore.getState().reset()
})

describe('CanvasToolbar Motion mode', () => {
  it('exposes Motion only on the Design canvas', () => {
    const designHtml = renderToStaticMarkup(createElement(CanvasToolbar, {
      workspaceRoot: '/workspace',
      surface: 'design'
    }))
    const codeHtml = renderToStaticMarkup(createElement(CanvasToolbar, {
      workspaceRoot: '/workspace',
      surface: 'code',
      onExportCanvas: async () => undefined
    }))

    expect(designHtml).toContain('aria-label="Motion"')
    expect(designHtml).toContain('aria-pressed="false"')
    expect(codeHtml).not.toContain('aria-label="Motion"')
  })

  it('reports the active Motion toggle state accessibly', async () => {
    useCanvasMotionStore.getState().setOpen(true)
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(CanvasToolbar, {
        workspaceRoot: '/workspace',
        surface: 'design'
      }))
    })

    expect(renderer.root.findByProps({ 'aria-label': 'Motion' }).props['aria-pressed']).toBe(true)
    await act(async () => renderer.unmount())
  })
})
