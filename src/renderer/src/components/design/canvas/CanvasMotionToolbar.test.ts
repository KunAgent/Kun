import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it } from 'vitest'
import { useCanvasMotionStore } from '../../../design/motion/canvas-motion-store'
import { CanvasToolbar } from './CanvasToolbar'

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useCanvasMotionStore.getState().reset()
})

async function openCanvasMenu(surface: 'design' | 'code'): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(CanvasToolbar, {
      workspaceRoot: '/workspace',
      surface,
      onExportCanvas: async () => undefined
    }))
  })
  await act(async () => renderer.root.findByProps({ 'aria-label': 'Canvas menu' }).props.onClick())
  return renderer
}

function motionItems(renderer: ReactTestRenderer) {
  return renderer.root.findAll((node) => (
    node.type === 'button' && node.props.role === 'menuitemcheckbox' &&
    node.findAll((child) => child.type === 'span' && child.children.join('') === 'Motion').length > 0
  ))
}

describe('CanvasToolbar Motion mode', () => {
  it('exposes Motion only on the Design canvas menu', async () => {
    const design = await openCanvasMenu('design')
    expect(motionItems(design)).toHaveLength(1)
    expect(motionItems(design)[0].props['aria-checked']).toBe(false)
    await act(async () => design.unmount())

    const code = await openCanvasMenu('code')
    expect(motionItems(code)).toHaveLength(0)
    await act(async () => code.unmount())
  })

  it('reports the active Motion toggle state accessibly', async () => {
    useCanvasMotionStore.getState().setOpen(true)
    const renderer = await openCanvasMenu('design')
    expect(motionItems(renderer)[0].props['aria-checked']).toBe(true)
    await act(async () => renderer.unmount())
  })
})
