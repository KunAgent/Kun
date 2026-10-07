/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaperWorkspaceMenu } from './PaperWorkspaceMenu'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key })
}))

let root: Root
let host: HTMLDivElement
let trigger: HTMLButtonElement
const onAction = vi.fn()
const onClose = vi.fn()

async function render(active = false, canRemove = true): Promise<void> {
  await act(async () => root.render(createElement(PaperWorkspaceMenu, { x: 200, y: 100, active, canRemove, onAction, onClose })))
}

function items(): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
}

function key(value: string): void {
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }))
}

describe('PaperWorkspaceMenu', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    host = document.createElement('div')
    trigger = document.createElement('button')
    document.body.append(trigger, host)
    trigger.focus()
    root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    trigger.remove()
  })

  it('focuses the first item and supports arrow, Home and End navigation', async () => {
    await render()
    expect(document.activeElement).toBe(items()[0])
    expect(items()[0].textContent).toBe('paperWorkspaceSwitch')
    key('ArrowDown')
    expect(document.activeElement).toBe(items()[1])
    key('End')
    expect(document.activeElement).toBe(items().at(-1))
    key('ArrowDown')
    expect(document.activeElement).toBe(items()[0])
    key('ArrowUp')
    expect(document.activeElement).toBe(items().at(-1))
    key('Home')
    expect(document.activeElement).toBe(items()[0])
  })

  it('closes before executing a switch and exposes no duplicate current switch', async () => {
    await render()
    await act(async () => items()[0].click())
    expect(onClose).toHaveBeenCalledOnce()
    expect(onAction).toHaveBeenCalledWith('switch')
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(onAction.mock.invocationCallOrder[0])
    await render(true, false)
    expect(host.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true)
    expect(host.textContent).not.toContain('paperWorkspaceRemove')
  })

  it('dismisses with Escape and restores keyboard focus on unmount', async () => {
    await render()
    key('Escape')
    expect(onClose).toHaveBeenCalledOnce()
    await act(async () => root.render(null))
    expect(document.activeElement).toBe(trigger)
  })

  it('does not trap Tab in the popup', async () => {
    await render()
    key('Tab')
    expect(onClose).toHaveBeenCalledOnce()
  })
})
