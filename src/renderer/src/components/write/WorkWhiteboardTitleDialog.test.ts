import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkWhiteboardTitleDialog } from './WorkWhiteboardTitleDialog'

function fireSubmit(form: unknown): void {
  ;(form as { props: { onSubmit: (event: unknown) => void } }).props.onSubmit({ preventDefault: vi.fn() })
}

function changeInput(root: ReactTestRenderer, value: string): void {
  const input = root.root.findByProps({ 'data-work-whiteboard-title-input': 'true' })
  act(() => {
    input.props.onChange({ target: { value } })
  })
}

describe('WorkWhiteboardTitleDialog', () => {
  let renderer: ReactTestRenderer

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    await act(async () => renderer.unmount())
  })

  it('does not submit an empty or whitespace-only title', async () => {
    const onSubmit = vi.fn()
    const onClose = vi.fn()
    await act(async () => {
      renderer = create(createElement(WorkWhiteboardTitleDialog, { onSubmit, onClose }))
    })

    const form = renderer.root.findByType('form')
    fireSubmit(form)
    expect(onSubmit).not.toHaveBeenCalled()

    changeInput(renderer, '   ')
    fireSubmit(form)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits the trimmed title and blocks an over-long one', async () => {
    const onSubmit = vi.fn()
    const onClose = vi.fn()
    await act(async () => {
      renderer = create(createElement(WorkWhiteboardTitleDialog, { onSubmit, onClose }))
    })

    const form = renderer.root.findByType('form')
    changeInput(renderer, '  FastAPI architecture  ')
    fireSubmit(form)
    expect(onSubmit).toHaveBeenCalledWith('FastAPI architecture', 'kun')

    changeInput(renderer, 'x'.repeat(200))
    fireSubmit(form)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('submits the selected Excalidraw engine', async () => {
    const onSubmit = vi.fn()
    await act(async () => {
      renderer = create(createElement(WorkWhiteboardTitleDialog, { onSubmit, onClose: vi.fn() }))
    })
    changeInput(renderer, 'Diagram')
    const exo = renderer.root.findByProps({ 'data-canvas-engine-option': 'excalidraw' })
    await act(async () => {
      exo.props.onClick()
    })
    fireSubmit(renderer.root.findByType('form'))
    expect(onSubmit).toHaveBeenCalledWith('Diagram', 'excalidraw')
  })

  it('closes on cancel without creating', async () => {
    const onSubmit = vi.fn()
    const onClose = vi.fn()
    await act(async () => {
      renderer = create(createElement(WorkWhiteboardTitleDialog, { onSubmit, onClose }))
    })

    changeInput(renderer, 'Typed but cancelled')
    const cancelButton = renderer.root.findByProps({ 'data-work-whiteboard-title-cancel': 'true' })
    await act(async () => {
      cancelButton.props.onClick()
    })

    expect(onClose).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('disables cancel and submit while a submit is pending', async () => {
    const onClose = vi.fn()
    await act(async () => {
      renderer = create(createElement(WorkWhiteboardTitleDialog, {
        onSubmit: vi.fn(),
        onClose,
        submitting: true
      }))
    })

    const cancelButton = renderer.root.findByProps({ 'data-work-whiteboard-title-cancel': 'true' })
    const submitButton = renderer.root.findByProps({ 'data-work-whiteboard-title-submit': 'true' })
    expect(cancelButton.props.disabled).toBe(true)
    expect(submitButton.props.disabled).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
  })
})
