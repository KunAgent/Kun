// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startPetTypingPresence } from './pet-presence-client'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = '' })

describe('typing presence', () => {
  it('follows the focused side composer instead of borrowing the main composer model', () => {
    const send = vi.fn()
    vi.stubGlobal('window', { kunGui: { pets: { updatePetPresence: send } } })
    document.body.innerHTML = '<div data-floating-composer><span data-pet-model="gpt-5" data-pet-provider="openai"></span><textarea id="main"></textarea></div>' +
      '<div data-floating-composer><span data-pet-model="claude-sonnet" data-pet-provider="anthropic"></span><textarea id="side"></textarea></div>'
    const stop = startPetTypingPresence(document)
    document.querySelector('#side')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(send.mock.lastCall?.[0]).toMatchObject({ type: 'model', model: 'claude-sonnet', provider: 'anthropic' })
    document.querySelector('#main')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(send.mock.lastCall?.[0]).toMatchObject({ type: 'model', model: 'gpt-5', provider: 'openai' })
    stop()
  })

  it('reports editing and IME activity without reading text, and excludes settings and password inputs', () => {
    vi.useFakeTimers()
    const send = vi.fn()
    vi.stubGlobal('window', { kunGui: { pets: { updatePetPresence: send } } })
    document.body.innerHTML = '<div data-floating-composer><textarea></textarea><input type="password"></div><input id="setting">'
    const stop = startPetTypingPresence(document)
    const editor = document.querySelector('textarea')!
    Object.defineProperty(editor, 'value', { get: () => { throw new Error('text must not be read') } })
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }))
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }))
    expect(send).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(125)
    editor.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: 'private' }))
    expect(send).toHaveBeenCalledTimes(2)
    for (const input of document.querySelectorAll('input')) input.dispatchEvent(new InputEvent('input', { bubbles: true }))
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0][0]).toEqual({ type: 'input', source: expect.any(String), kind: 'typing', level: 0 })
    editor.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    expect(send.mock.lastCall?.[0].kind).toBe('idle')
    stop(); send.mockClear()
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }))
    expect(send).not.toHaveBeenCalled()
  })
})
