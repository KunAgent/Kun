import { createElement } from 'react'
import { act, create as createRenderer, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { ToastDock } from './ToastDock'
import { resetToasts, useToastStore } from './toast-store'
import type { ToastInput } from './toast-types'

const publish = (input: ToastInput): void => useToastStore.getState().publish(input)

function mount(): ReactTestRenderer {
  let renderer: ReactTestRenderer | undefined
  act(() => {
    renderer = createRenderer(createElement(ToastDock))
  })
  return renderer as ReactTestRenderer
}

const markup = (renderer: ReactTestRenderer): string => JSON.stringify(renderer.toJSON())

beforeEach(() => {
  resetToasts()
})

afterEach(() => {
  resetToasts()
  i18n.changeLanguage('en')
})

describe('ToastDock', () => {
  it('stays out of the way when there is nothing to report', () => {
    expect(markup(mount())).toBe('null')
  })

  it('shows three cards in one dock, newest last', () => {
    for (const id of ['a', 'b', 'c', 'd']) publish({ id, tone: 'success', title: id })
    const tree = markup(mount())
    expect(tree).toContain('"data-toast-visible":3')
    expect(tree).toContain('"data-toast-id":"b"')
    expect(tree).toContain('"data-toast-id":"d"')
    expect(tree).not.toContain('"data-toast-id":"a"')
    expect(tree.indexOf('"data-toast-id":"b"')).toBeLessThan(tree.indexOf('"data-toast-id":"d"'))
  })

  it('counts the important cards that are only waiting for a slot', () => {
    for (const id of ['a', 'b', 'c', 'd']) publish({ id, tone: 'error', title: id })
    const tree = markup(mount())
    expect(tree).toContain('"data-toast-visible":3')
    expect(tree).toContain('"data-toast-waiting":1')
  })

  it('announces failures as alerts and everything else as status', () => {
    publish({ id: 'failed', tone: 'error', title: 'Update failed' })
    publish({ id: 'saved', tone: 'success', title: 'Saved' })
    const tree = markup(mount())
    expect(tree).toContain('"role":"alert"')
    expect(tree).toContain('"role":"status"')
  })

  it('exposes progress as a labelled progressbar', () => {
    publish({
      id: 'download',
      tone: 'running',
      title: 'Downloading voice',
      progress: { percent: 42, label: 'Downloading voice', detail: '40 / 96 MB', trailing: '4.2 MB/s' }
    })
    const tree = markup(mount())
    expect(tree).toContain('"role":"progressbar"')
    expect(tree).toContain('"aria-valuenow":42')
    expect(tree).toContain('"aria-label":"Downloading voice"')
    expect(tree).toContain('4.2 MB/s')
  })

  it('gives every card a labelled close control and its actions', () => {
    publish({
      id: 'edit',
      tone: 'success',
      title: 'Edit applied',
      actions: [{ label: 'Undo', run: () => {}, shortcut: '⌘Z' }]
    })
    const tree = markup(mount())
    expect(tree).toContain('"data-toast-close":true')
    expect(tree).toContain('"aria-label":"Close"')
    expect(tree).toContain('Undo')
    expect(tree).toContain('⌘Z')
  })

  it('dismisses the card from its close control', () => {
    publish({ id: 'saved', tone: 'success', title: 'Saved' })
    const renderer = mount()
    const close = renderer.root.findByProps({ 'data-toast-close': true })
    act(() => {
      close.props.onClick()
    })
    expect(useToastStore.getState().items).toEqual([])
    expect(markup(renderer)).toBe('null')
  })

  it('runs an action and clears the card it came from', () => {
    const run = vi.fn()
    publish({ id: 'edit', tone: 'success', title: 'Edit applied', actions: [{ label: 'Undo', run }] })
    const renderer = mount()
    const [button] = renderer.root.findAllByType('button')
    act(() => {
      button?.props.onClick()
    })
    expect(run).toHaveBeenCalledTimes(1)
    expect(useToastStore.getState().items).toEqual([])
  })
})
