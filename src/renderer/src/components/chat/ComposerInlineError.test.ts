import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComposerInlineError } from './ComposerInlineError'

describe('ComposerInlineError', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    renderer?.unmount()
    renderer = null
  })

  const renderError = (message: string, onDismiss: () => void): ReactTestRenderer => {
    let created: ReactTestRenderer | null = null
    act(() => {
      created = create(
        createElement(ComposerInlineError, {
          message,
          onDismiss,
          dismissLabel: 'Dismiss error'
        })
      )
    })
    if (!created) throw new Error('renderer not created')
    return created
  }

  it('renders the message inside an alert region', () => {
    renderer = renderError('Voice transcription failed: HTTP 403', vi.fn())
    const span = renderer.root.findByProps({
      title: 'Voice transcription failed: HTTP 403'
    }) as ReactTestInstance
    expect(span.props.children).toContain('Voice transcription failed: HTTP 403')
    expect(renderer.root.findByProps({ role: 'alert' })).toBeTruthy()
  })

  it('invokes onDismiss when the dismiss button is clicked', () => {
    const onDismiss = vi.fn()
    renderer = renderError('Voice transcription failed', onDismiss)
    const button = renderer.root.findByProps({ 'aria-label': 'Dismiss error' }) as ReactTestInstance
    act(() => {
      button.props.onClick()
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
