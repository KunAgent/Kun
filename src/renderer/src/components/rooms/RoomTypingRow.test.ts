import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { RoomTypingRow } from './RoomTypingRow'

describe('RoomTypingRow', () => {
  let renderer: ReactTestRenderer
  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    await i18n.changeLanguage('en')
  })
  afterEach(() => {
    if (renderer) act(() => renderer.unmount())
    vi.unstubAllGlobals()
  })
  const render = (props: Parameters<typeof RoomTypingRow>[0]) => {
    act(() => {
      renderer = create(createElement(RoomTypingRow, props))
    })
    return renderer
  }
  it('reserves the row but stays empty without any state', () => {
    render({ names: [] })
    const row = renderer.root.findByProps({ className: 'rooms-typing-row' })
    expect(row.props['data-visible']).toBeUndefined()
    expect(row.props['aria-live']).toBe('polite')
    expect(renderer.root.findAllByProps({ className: 'rooms-typing-dots' })).toHaveLength(0)
  })
  it('names one responding member', () => {
    render({ names: ['Kun'] })
    expect(JSON.stringify(renderer.toJSON())).toContain('Kun')
    expect(JSON.stringify(renderer.toJSON())).toContain('is responding')
  })
  it('joins two responding members', () => {
    render({ names: ['Kun', 'Dev'] })
    const json = JSON.stringify(renderer.toJSON())
    expect(json).toContain('Kun')
    expect(json).toContain('Dev')
    expect(json).toContain('are responding')
  })
  it('collapses three or more members into an overflow count', () => {
    render({ names: ['A', 'B', 'C', 'D'] })
    const json = JSON.stringify(renderer.toJSON())
    expect(json).toContain('2 more')
  })
  it('falls back to waiting names when nobody is responding yet', () => {
    render({ names: [], waitingNames: ['Kun'], fallback: 'unused' })
    expect(JSON.stringify(renderer.toJSON())).toContain('Delivered')
    expect(JSON.stringify(renderer.toJSON())).toContain('Kun')
  })
  it('uses the plain fallback when there are no member states', () => {
    render({ names: [], fallback: 'Delivered, waiting for a response…' })
    const json = JSON.stringify(renderer.toJSON())
    expect(json).toContain('Delivered, waiting for a response')
  })
  it('shows three bouncing dots when visible', () => {
    render({ names: ['Kun'] })
    expect(renderer.root.findAllByProps({ className: 'rooms-typing-dot' })).toHaveLength(3)
  })
})
