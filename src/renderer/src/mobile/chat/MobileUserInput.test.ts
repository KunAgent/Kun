// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileUserInput } from './MobileUserInput'
import type { PendingUserInputBlock, ResolveUserInput } from '../../components/chat/use-composer-user-input'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
let root: Root
let host: HTMLDivElement
const base: PendingUserInputBlock = { kind: 'user_input', id: 'input', requestId: 'request', status: 'pending', live: true,
  questions: [{ id: 'q', header: '', question: 'Choose', options: [
    { label: 'One', description: 'First', recommended: true }, { label: 'Two', description: 'Second' }, { label: 'Three', description: '' }
  ] }] }
const primary = () => document.querySelector<HTMLButtonElement>('.kun-mobile-input-primary')!
const click = (selector: string) => act(() => document.querySelector<HTMLElement>(selector)!.click())
function type(text: string) {
  act(() => {
    const input = document.querySelector('textarea')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function () { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function () { this.removeAttribute('open') } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
const render = (input = base, resolve: ResolveUserInput = vi.fn(async () => undefined)) => {
  act(() => root.render(createElement(MobileUserInput, { input, resolve })))
  return resolve
}
describe('mobile answer sheet', () => {
  it('does not preselect recommendations, keeps choice visible until explicit submit, and sends once', async () => {
    let finish!: () => void
    const resolve = vi.fn(() => new Promise<void>((done) => { finish = done }))
    render(base, resolve)
    expect(primary().disabled).toBe(true)
    expect(document.querySelector('input:checked')).toBeNull()
    click('input[type=radio]')
    expect(document.querySelector('input:checked')).not.toBeNull()
    expect(resolve).not.toHaveBeenCalled()
    act(() => { primary().click(); primary().click() })
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledWith('input', {kind:'submit', answers:[{id:'q',label:'One',value:'One'}]})
    await act(async () => finish())
    expect(document.querySelector('dialog')).toBeNull()
  })
  it('enforces min/max multiselect and preserves answers across minimizing and polling', () => {
    const input = {...base, questions:[{...base.questions[0], selectionMode:'multiple' as const, minSelections:2, maxSelections:2}]}
    const resolve = render(input)
    click('.kun-mobile-input-option:nth-of-type(1) input')
    expect(primary().disabled).toBe(true)
    click('.kun-mobile-input-option:nth-of-type(2) input')
    expect(primary().disabled).toBe(false)
    expect(document.querySelector<HTMLInputElement>('.kun-mobile-input-option:nth-of-type(3) input')!.disabled).toBe(true)
    click('.kun-mobile-sheet-header button')
    expect(resolve).not.toHaveBeenCalled()
    render({...input, questions:[...input.questions]}, resolve)
    click('.kun-mobile-input-trigger')
    expect(document.querySelectorAll('input:checked')).toHaveLength(2)
  })
  it('supports independent free text per question with back navigation, multiline whitespace and retry', async () => {
    const input = {...base, questions:[{id:'a',header:'',question:'First',options:[]}, {id:'b',header:'',question:'Second',options:[]}]}
    const resolve = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(undefined)
    render(input, resolve)
    type('First line\nsecond line ')
    click('.kun-mobile-input-primary')
    expect(resolve).not.toHaveBeenCalled()
    type('Answer two')
    click('.kun-mobile-input-footer button:nth-child(2)')
    expect(document.querySelector('textarea')!.value).toBe('First line\nsecond line ')
    await act(async () => primary().click())
    expect(document.querySelector('[role=alert]')?.textContent).toBe('Offline')
    expect(primary().disabled).toBe(false)
    await act(async () => primary().click())
    expect(resolve.mock.calls[1][1].answers.map((answer: {value:string}) => answer.value)).toEqual(['First line\nsecond line ', 'Answer two'])
  })
  it('keeps custom text visible even when it exactly matches an option and separates cancel from minimize', async () => {
    const resolve = vi.fn(async () => undefined)
    render(base, resolve)
    type('One')
    expect(document.querySelector('textarea')!.value).toBe('One')
    click('.kun-mobile-sheet-header button')
    expect(resolve).not.toHaveBeenCalled()
    click('.kun-mobile-input-trigger')
    await act(async () => document.querySelector<HTMLButtonElement>('.kun-mobile-input-footer button')!.click())
    expect(resolve).toHaveBeenCalledWith('input', {kind:'cancel'})
    expect(host.textContent).toBe('mobileInputCancelled')
  })
  it('drops answers when a different request replaces the current one', () => {
    render()
    click('input[type=radio]')
    render({...base, id:'next',requestId:'next'})
    expect(primary().disabled).toBe(true)
    expect(document.querySelector('input:checked')).toBeNull()
  })
})
