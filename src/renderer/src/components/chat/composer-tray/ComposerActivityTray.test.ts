// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'
import { ComposerActivityTray, type ComposerActivityTrayProps } from './ComposerActivityTray'
import type { TrayKind, TrayKindId } from './tray-kind'

function kind(id: TrayKindId, overrides: Partial<TrayKind> = {}): TrayKind {
  return {
    id,
    align: 'start',
    tone: 'default',
    ariaLabel: `${id} label`,
    renderSegment: ({ open, compact }) => createElement('span', { 'data-segment-content': id, 'data-open': String(open) },
      compact ? `${id}#` : `${id} segment`),
    renderSheet: ({ close }) => createElement('div', { 'data-sheet-content': id },
      createElement('button', { type: 'button', 'data-close': id, onClick: close }, 'close')),
    ...overrides
  }
}

describe('ComposerActivityTray markup', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders nothing without kinds or queue', () => {
    expect(renderToStaticMarkup(createElement(ComposerActivityTray, { kinds: [null, undefined] }))).toBe('')
  })

  it('orders segments, pushes trailing kinds right and keeps markers', () => {
    const html = renderToStaticMarkup(createElement(ComposerActivityTray, {
      kinds: [kind('goal', { align: 'end' }), kind('shells', { marker: 'background-shell' }), kind('todo'), kind('dispatch'), kind('workers')]
    }))
    const order = ['todo', 'workers', 'background-shell'].map((marker) => html.indexOf(`data-composer-stack-item="${marker}"`))
    expect(order.every((index) => index >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    const spacer = html.indexOf('ds-composer-tray-spacer')
    expect(spacer).toBeGreaterThan(order[2])
    expect(html.indexOf('data-composer-stack-item="goal"')).toBeGreaterThan(spacer)
    expect(html).not.toContain('data-composer-stack-item="dispatch"')
    expect(html).not.toContain('ds-composer-tray-sheet"')
    expect(html).toContain('aria-label="Current activity"')
  })

  it('puts the queue last and renders a queue-only tray', () => {
    const html = renderToStaticMarkup(createElement(ComposerActivityTray, {
      kinds: [kind('todo')],
      queue: createElement('div', { 'data-queue-body': true })
    }))
    expect(html.indexOf('data-composer-tray-queue')).toBeGreaterThan(html.indexOf('ds-composer-tray-bar'))
    expect(html).toContain('aria-label="Queued messages"')
    const queueOnly = renderToStaticMarkup(createElement(ComposerActivityTray, {
      kinds: [],
      queue: createElement('div', { 'data-queue-body': true })
    }))
    expect(queueOnly).toContain('data-queue-body')
    expect(queueOnly).not.toContain('ds-composer-tray-bar')
  })

  it('marks compact trays and hands compact to segments', () => {
    const html = renderToStaticMarkup(createElement(ComposerActivityTray, { kinds: [kind('todo')], compact: true }))
    expect(html).toContain('data-compact="true"')
    expect(html).toContain('todo#')
    expect(html).toContain('title="todo label"')
  })
})

describe('ComposerActivityTray interaction', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await i18n.changeLanguage('en')
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ''
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  async function render(props: ComposerActivityTrayProps): Promise<void> {
    await act(async () => root.render(createElement(ComposerActivityTray, props)))
  }
  const segment = (id: string): HTMLButtonElement =>
    host.querySelector<HTMLButtonElement>(`[data-tray-kind="${id}"]`)!
  const sheet = (): Element | null => host.querySelector('[data-tray-sheet]')

  it('opens one sheet at a time and closes it from the open segment', async () => {
    const kinds = [kind('todo'), kind('workers')]
    await render({ kinds })
    await act(async () => segment('todo').click())
    expect(sheet()?.getAttribute('data-tray-sheet')).toBe('todo')
    expect(segment('todo').getAttribute('aria-expanded')).toBe('true')
    expect(segment('todo').getAttribute('aria-controls')).toBe(sheet()?.id)
    await act(async () => segment('workers').click())
    expect(sheet()?.getAttribute('data-tray-sheet')).toBe('workers')
    expect(segment('todo').getAttribute('aria-expanded')).toBe('false')
    await act(async () => segment('workers').click())
    expect(sheet()).toBeNull()
  })

  it('closes on Esc (marking the key handled), outside pointer down and the sheet close callback', async () => {
    await render({ kinds: [kind('todo')] })
    await act(async () => segment('todo').click())
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    await act(async () => { document.body.dispatchEvent(escape) })
    expect(escape.defaultPrevented).toBe(true)
    expect(sheet()).toBeNull()

    await act(async () => segment('todo').click())
    await act(async () => { host.querySelector<HTMLElement>('[data-sheet-content]')!.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
    expect(sheet()).not.toBeNull()
    await act(async () => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
    expect(sheet()).toBeNull()

    await act(async () => segment('todo').click())
    await act(async () => host.querySelector<HTMLButtonElement>('[data-close="todo"]')!.click())
    expect(sheet()).toBeNull()
  })

  it('closes when a composer menu opens, the thread changes, or the kind disappears', async () => {
    await render({ kinds: [kind('todo')], resetKey: 'a' })
    await act(async () => segment('todo').click())
    await render({ kinds: [kind('todo')], resetKey: 'a', menuOpen: true })
    expect(sheet()).toBeNull()

    await render({ kinds: [kind('todo')], resetKey: 'a' })
    await act(async () => segment('todo').click())
    await render({ kinds: [kind('todo')], resetKey: 'b' })
    expect(sheet()).toBeNull()

    await act(async () => segment('todo').click())
    await render({ kinds: [], resetKey: 'b', queue: createElement('div', null, 'q') })
    await render({ kinds: [kind('todo')], resetKey: 'b' })
    expect(sheet()).toBeNull()
  })

  it('activates non-expandable segments instead of opening a sheet', async () => {
    const onActivate = vi.fn()
    await render({ kinds: [kind('dispatch', { renderSheet: null, onActivate })] })
    await act(async () => segment('dispatch').click())
    expect(onActivate).toHaveBeenCalledOnce()
    expect(sheet()).toBeNull()
  })

  it('treats a sheet that renders nothing as closed', async () => {
    await render({ kinds: [kind('todo', { renderSheet: () => null })] })
    await act(async () => segment('todo').click())
    expect(sheet()).toBeNull()
    expect(segment('todo').getAttribute('aria-expanded')).toBe('false')
  })
})
