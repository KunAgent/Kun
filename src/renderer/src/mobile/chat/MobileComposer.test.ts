// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileComposer, type MobileComposerProps } from './MobileComposer'

let root: Root
let host: HTMLDivElement
function props(): MobileComposerProps {
  return {
    value: 'Hello', onChange: vi.fn(), onSend: vi.fn(), onStop: vi.fn(),
    onAttachments: vi.fn(), onOptions: vi.fn(), running: false, disabled: false,
    sending: false, canSend: true,
    labels: { placeholder: 'Message', send: 'Send', stop: 'Stop', attachments: 'Attach', options: 'Model' }
  }
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})
function press(options: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options })
  act(() => { host.querySelector('textarea')!.dispatchEvent(event) })
  return event
}

describe('mobile composer presentation', () => {
  it('keeps Enter as a newline and sends only an explicit non-composing shortcut', () => {
    const input = props()
    act(() => root.render(createElement(MobileComposer, input)))
    expect(press({ key: 'Enter' }).defaultPrevented).toBe(false)
    expect(input.onSend).not.toHaveBeenCalled()
    press({ key: 'Enter', ctrlKey: true, isComposing: true })
    expect(input.onSend).not.toHaveBeenCalled()
    press({ key: 'Enter', ctrlKey: true })
    expect(input.onSend).toHaveBeenCalledOnce()
  })

  it('does not submit twice while a request is pending', () => {
    const input = { ...props(), sending: true }
    act(() => root.render(createElement(MobileComposer, input)))
    press({ key: 'Enter', metaKey: true })
    act(() => (host.querySelector('[aria-label="Send"]') as HTMLButtonElement).click())
    expect(input.onSend).not.toHaveBeenCalled()
  })

  it('keeps stop and pending actions reachable while running', () => {
    const input = { ...props(), running: true, pendingActions: createElement('button', null, 'Approve') }
    act(() => root.render(createElement(MobileComposer, input)))
    expect(host.textContent).toContain('Approve')
    act(() => (host.querySelector('[aria-label="Stop"]') as HTMLButtonElement).click())
    expect(input.onStop).toHaveBeenCalledOnce()
    expect(host.querySelector('[aria-label="Send"]')).not.toBeNull()
  })
})
