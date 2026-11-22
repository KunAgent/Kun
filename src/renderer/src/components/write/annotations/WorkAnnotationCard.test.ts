// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../../i18n'
import { WorkAnnotationCard } from './WorkAnnotationCard'
import { annotationComposerIntent, type WorkAnnotationView } from './work-annotation-view'

vi.mock('../../chat/AssistantMarkdown', () => ({ AssistantMarkdown: ({ text }: { text: string }) => text }))

const note: WorkAnnotationView = { id: 'local-note', quote: 'x + f(x)', resolved: false, messages: [] }
const onSubmit = vi.fn(async () => {})
const onResolve = vi.fn()
const onReattach = vi.fn()
const onPreview = vi.fn()
let mount: HTMLDivElement
let root: Root

function render(annotation = note): void {
  act(() => root.render(createElement(WorkAnnotationCard, {
    annotation, onClose: vi.fn(), onSubmit, onResolve, onReattach, onPreview
  })))
}

function enter(value: string): void {
  const field = mount.querySelector('textarea')!
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setValue.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mount = document.createElement('div')
  document.body.append(mount)
  root = createRoot(mount)
  vi.clearAllMocks()
})
afterEach(() => {
  act(() => root.unmount())
  mount.remove()
  vi.unstubAllGlobals()
})

describe('Work margin comment composer', () => {
  it('keeps ordinary notes local and asks only on an explicit mention or an Ask click', async () => {
    render()
    enter('Please clarify this.')
    await act(async () => mount.querySelector<HTMLButtonElement>('[type="submit"]')!.click())
    enter('请@Kun解释这句话')
    await act(async () => mount.querySelector<HTMLButtonElement>('[type="submit"]')!.click())
    enter('Why x?')
    await act(async () => mount.querySelector<HTMLButtonElement>('.work-annotation-composer-actions button[type="button"]')!.click())
    expect(onSubmit.mock.calls).toEqual([
      ['local-note', 'Please clarify this.', false],
      ['local-note', '请@Kun解释这句话', true],
      ['local-note', 'Why x?', true]
    ])
  })
  it('keeps domains and other handles local, accepts punctuation, and requires a question with a mention', () => {
    expect(annotationComposerIntent('bob@kun.example says @Kunlun')).toEqual({ askKun: false, canSend: true })
    expect(annotationComposerIntent('Please explain, @Kun.').askKun).toBe(true)
    expect(annotationComposerIntent('@Kun ')).toEqual({ askKun: true, canSend: false })
  })
  it('accepts private notes while an existing Kun reply is pending and blocks a duplicate question', async () => {
    render({ ...note, busy: true })
    enter('Remember the figure.')
    await act(async () => mount.querySelector<HTMLButtonElement>('[type="submit"]')!.click())
    enter('@Kun please reply')
    expect(mount.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(true)
    expect(onSubmit.mock.calls).toEqual([['local-note', 'Remember the figure.', false]])
  })
  it('targets the chosen suggestion and keeps resolving independent of previewing', () => {
    const suggestion: WorkAnnotationView = { ...note, messages: [
      { id: 'answer', author: 'kun', text: 'Try this.', suggestion: { kind: 'insertAfter', text: 'An explanation.' } }
    ] }
    render(suggestion)
    act(() => mount.querySelector<HTMLButtonElement>('.work-annotation-suggestion button')!.click())
    expect(onPreview).toHaveBeenCalledWith('local-note', 'answer')
    expect(onResolve).not.toHaveBeenCalled()

    render({ ...suggestion, canPreview: false })
    expect(mount.querySelector('.work-annotation-suggestion button')).toBeNull()
    expect(mount.querySelector('.work-annotation-author button')).not.toBeNull()
    render({ ...suggestion, detached: true })
    expect(mount.querySelector('.work-annotation-suggestion button')).toBeNull()
    act(() => mount.querySelector<HTMLButtonElement>('.work-annotation-warning button')!.click())
    expect(onReattach).toHaveBeenCalledWith('local-note')
  })
})
