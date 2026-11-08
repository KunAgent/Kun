// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startPetTypingPresence } from './pet-presence-client'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = '' })

describe('typing presence', () => {
  it('follows physical down/up edges, ignores repeat and duplicate input events, and resets on focus loss', () => {
    vi.useFakeTimers(); vi.setSystemTime(1000)
    const send = vi.fn()
    vi.stubGlobal('window', { kunGui: { pets: { updatePetPresence: send } } })
    document.body.innerHTML = '<div data-pet-typing><textarea></textarea></div>'
    const editor = document.querySelector('textarea')!
    Object.defineProperty(editor, 'value', { get: () => { throw new Error('private text') } })
    const stop = startPetTypingPresence(document)
    const key = (type: string, code: string, repeat = false): void => {
      const event = new KeyboardEvent(type, { code, repeat, bubbles: true })
      Object.defineProperty(event, 'key', { get: () => { throw new Error('do not read the character') } })
      editor.dispatchEvent(event)
    }
    key('keydown', 'KeyA'); key('keydown', 'KeyA', true)
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'private' }))
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.lastCall?.[0]).toMatchObject({ type: 'keyboard', held: 1, tap: 1 })
    key('keydown', 'KeyS'); key('keyup', 'KeyA')
    expect(send.mock.lastCall?.[0]).toMatchObject({ held: 1, tap: 0 })
    key('keydown', 'KeyJ')
    expect(send.mock.lastCall?.[0]).toMatchObject({ held: 3, tap: 2 })
    vi.advanceTimersByTime(500)
    expect(send.mock.lastCall?.[0]).toMatchObject({ held: 3, tap: 0 })
    key('keyup', 'KeyS'); key('keyup', 'KeyJ')
    expect(send.mock.lastCall?.[0]).toMatchObject({ held: 0, tap: 0 })
    expect(vi.getTimerCount()).toBe(0)
    key('keydown', 'Space')
    expect(send.mock.lastCall?.[0]).toMatchObject({ held: 3, tap: 3 })
    editor.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    expect(send.mock.lastCall?.[0]).toMatchObject({ kind: 'idle' })
    expect(vi.getTimerCount()).toBe(0)
    stop()
  })

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
    expect(send.mock.calls[0][0]).toEqual({ type: 'keyboard', source: expect.any(String), held: 0, tap: 1 })
    editor.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    expect(send.mock.lastCall?.[0].kind).toBe('idle')
    stop(); send.mockClear()
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }))
    expect(send).not.toHaveBeenCalled()
  })
})
