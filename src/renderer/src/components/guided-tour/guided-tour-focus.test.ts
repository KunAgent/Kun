// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import enTour from '../../locales/en/common/guided-tours.json'
import enNotes from '../../locales/en/common/whats-new.json'
import { GuidedTour } from './GuidedTour'
import { useGuidedTourStore } from './guided-tour-store'

let root: Root
let container: HTMLDivElement
let launcher: HTMLButtonElement

function ActiveTour(): ReturnType<typeof createElement> | null {
  const active = useGuidedTourStore((state) => state.active)
  return active ? createElement(GuidedTour, { tour: active }) : null
}

async function mount(): Promise<void> {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en', fallbackLng: 'en', defaultNS: 'common',
    resources: { en: { common: { ...enTour, ...enNotes } } }
  })
  await act(async () => {
    root.render(createElement(I18nextProvider, { i18n }, createElement(ActiveTour)))
  })
}

async function key(target: HTMLElement, value: string, shiftKey = false): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true })
  await act(async () => { target.dispatchEvent(event) })
  return event
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(1280)
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 20, top: 20, right: 1300, bottom: 820, width: 1280, height: 800, x: 20, y: 20, toJSON: () => ({})
  })
  document.body.innerHTML = '<button data-guided-tours-button>Help</button><button id="other-control">Other</button>'
  launcher = document.querySelector<HTMLButtonElement>('[data-guided-tours-button]')!
  launcher.focus()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  useGuidedTourStore.setState({ active: 'overview', step: 0, requested: null, quietMode: null, releaseNotesWaiting: true })
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('guided tour modal focus', () => {
  it('keeps Tab and Shift+Tab inside the complete overview card', async () => {
    await mount()
    const dialog = document.querySelector<HTMLElement>('[data-guided-tour="overview"]')!
    const first = dialog.querySelector<HTMLButtonElement>('.guided-tour-close')!
    const last = dialog.querySelector<HTMLButtonElement>('[data-guided-tour-primary]')!
    expect(document.activeElement).toBe(last)
    expect((await key(last, 'Tab')).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(first)
    expect((await key(first, 'Tab', true)).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(last)
    launcher.focus()
    await key(launcher, 'Tab')
    expect(document.activeElement).toBe(first)
  })

  it('restores the launch control after Escape closes the tour', async () => {
    await mount()
    const last = document.querySelector<HTMLButtonElement>('[data-guided-tour-primary]')!
    await key(last, 'Escape')
    expect(document.querySelector('[data-guided-tour]')).toBeNull()
    expect(document.activeElement).toBe(launcher)
  })

  it('does not steal focus already moved to another screen control', async () => {
    await mount()
    const other = document.getElementById('other-control')!
    other.focus()
    await act(async () => useGuidedTourStore.getState().close())
    expect(document.activeElement).toBe(other)
  })
})
