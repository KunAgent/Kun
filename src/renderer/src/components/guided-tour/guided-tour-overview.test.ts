// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import enTour from '../../locales/en/common/guided-tours.json'
import enNotes from '../../locales/en/common/whats-new.json'
import { GuidedTourLastActions } from './GuidedTourLastActions'
import { useGuidedTourStore } from './guided-tour-store'

const { openNotes } = vi.hoisted(() => ({ openNotes: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../whats-new/whats-new-store', () => ({ openCurrentWhatsNew: openNotes }))

let root: Root
let container: HTMLDivElement
const back = vi.fn()

async function renderOverview(waiting: boolean): Promise<void> {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en', fallbackLng: 'en', defaultNS: 'common',
    resources: { en: { common: { ...enTour, ...enNotes } } }
  })
  await act(async () => {
    useGuidedTourStore.setState({
      active: 'overview', step: 6, releaseNotesWaiting: waiting,
      requested: null, quietMode: null, hint: false
    })
    root.render(createElement(I18nextProvider, { i18n },
      createElement(GuidedTourLastActions, { tour: 'overview', onBack: back })))
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  back.mockClear()
  openNotes.mockClear()
  document.body.innerHTML = '<div data-workspace-mode-trigger data-workspace-mode="chat"><button class="kun-mode-tab" data-workspace-mode="write"></button></div>'
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('overview release-note entry', () => {
  it('shows a separate update entry only while release notes are waiting', async () => {
    await renderOverview(false)
    expect(container.querySelector('[data-guided-tour-release-notes]')).toBeNull()
    await renderOverview(true)
    expect(container.querySelector('.guided-tour-overview-notes')?.textContent).toContain(enTour.guidedTour_overview_notes)
    expect(container.querySelectorAll('[data-guided-tour-pick]')).toHaveLength(3)
  })

  it('closes the tour before opening the current release notes', async () => {
    await renderOverview(true)
    let activeWhenOpened: string | null | undefined
    openNotes.mockImplementationOnce(async () => { activeWhenOpened = useGuidedTourStore.getState().active })
    await act(async () => container.querySelector<HTMLButtonElement>('[data-guided-tour-release-notes]')!.click())
    expect(openNotes).toHaveBeenCalledOnce()
    expect(activeWhenOpened).toBeNull()
    expect(useGuidedTourStore.getState().requested).toBeNull()
  })

  it('keeps the stay action independent from opening release notes', async () => {
    await renderOverview(true)
    await act(async () => container.querySelector<HTMLButtonElement>('[data-guided-tour-primary]')!.click())
    expect(useGuidedTourStore.getState().active).toBeNull()
    expect(openNotes).not.toHaveBeenCalled()
  })

  it('keeps mode selection and the previous-step action intact', async () => {
    await renderOverview(true)
    const modeButton = document.querySelector<HTMLButtonElement>('.kun-mode-tab[data-workspace-mode="write"]')!
    const openMode = vi.fn()
    modeButton.addEventListener('click', openMode)
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === enTour.guidedTourPrev)!.click())
    expect(back).toHaveBeenCalledOnce()
    await act(async () => container.querySelector<HTMLButtonElement>('[data-guided-tour-pick="work"]')!.click())
    expect(openMode).toHaveBeenCalledOnce()
    expect(useGuidedTourStore.getState().requested).toBe('work')
    expect(useGuidedTourStore.getState().active).toBeNull()
    expect(openNotes).not.toHaveBeenCalled()
  })
})
