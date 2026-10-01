import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { RoomComposerModelButton } from './RoomComposerModelButton'

describe('private composer model control', () => {
  let renderer: ReactTestRenderer
  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    await i18n.changeLanguage('en')
  })
  afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.unstubAllGlobals() })

  it('keeps long model labels, provider and account accessible and opens settings once', async () => {
    const onClick = vi.fn()
    const model = { providerId: 'deepseek', accountId: 'work', model: 'deepseek-v4.1-flash-experimental-long-model-name' }
    await act(async () => { renderer = create(createElement(RoomComposerModelButton, { model, onClick })) })
    const button = renderer.root.findByType('button')
    expect(button.props.type).toBe('button')
    expect(button.props.title).toBe(`deepseek / work / ${model.model}`)
    expect(button.props['aria-label']).toBe(`Model settings: ${model.model}`)
    expect(button.findByType('span').props.children).toBe(model.model)
    expect(button.findByType('svg').props['aria-hidden']).toBe('true')
    await act(async () => button.props.onClick())
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('offers a clear model action before a model is configured or loaded', async () => {
    await act(async () => { renderer = create(createElement(RoomComposerModelButton, { onClick: vi.fn() })) })
    expect(renderer.root.findByType('span').props.children).toBe('Choose model')
    expect(renderer.root.findByType('button').props['aria-label']).toBe('Model settings: Choose model')
  })
})
