// @vitest-environment jsdom
import { act, createElement } from 'react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRoot, type Root } from 'react-dom/client'
import { createInstance, type i18n } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WhatsNewDialog from './WhatsNewDialog'
import { loadWhatsNewContent, releaseNotesLanguage, type WhatsNewContent } from './whats-new-content'

const stylesDirectory = dirname(fileURLToPath(import.meta.url))
const baseStyles = readFileSync(join(stylesDirectory, 'whats-new.css'), 'utf8')
const workbenchStyles = readFileSync(join(stylesDirectory, 'whats-new-workbench.css'), 'utf8')

const localeFiles = import.meta.glob<Record<string, string>>('../../locales/*/common/whats-new.json', {
  eager: true,
  import: 'default'
})
const resources = Object.fromEntries(Object.entries(localeFiles).map(([path, common]) => [
  path.match(/locales\/([^/]+)\//)![1], { common }
]))

let host: HTMLDivElement
let root: Root
let translations: i18n
let mounted: boolean
const onClose = vi.fn()
const openExternal = vi.fn()
const scrollIntoView = vi.fn()
const previousScrollIntoView = HTMLElement.prototype.scrollIntoView

async function render(content: WhatsNewContent): Promise<void> {
  await act(async () => {
    root.render(createElement(I18nextProvider, { i18n: translations },
      createElement(WhatsNewDialog, { content, onClose })))
  })
}

function button(selector: string): HTMLButtonElement {
  const element = host.querySelector<HTMLButtonElement>(selector)
  expect(element).not.toBeNull()
  return element!
}

async function click(selector: string): Promise<void> {
  await act(async () => { button(selector).click() })
}

async function release(version = '0.4.4', previousVersion = '0.4.3'): Promise<WhatsNewContent> {
  return loadWhatsNewContent({ version, previousVersion, changelogUrl: 'https://example.com/changelog' },
    releaseNotesLanguage(translations.language))
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('kunGui', { openExternal })
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
  HTMLElement.prototype.scrollIntoView = scrollIntoView
  document.body.innerHTML = '<button id="previous-focus">Open</button>'
  document.getElementById('previous-focus')!.focus()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  mounted = true
  translations = createInstance()
  await translations.init({ lng: 'zh', fallbackLng: 'en', defaultNS: 'common', resources, interpolation: { escapeValue: false } })
})

afterEach(async () => {
  if (mounted) await act(async () => { root.unmount() })
  host.remove()
  HTMLElement.prototype.scrollIntoView = previousScrollIntoView
  vi.unstubAllGlobals()
})

describe('0.4.5 update announcement', () => {
  it.each(['zh', 'en', 'hi', 'ja', 'ko', 'ru', 'th'])('shows current highlights and all additional features in %s', async (language) => {
    await translations.changeLanguage(language)
    const content = await release('v0.4.5', '0.4.4')
    await render(content)
    expect(host.querySelector('[data-whats-new-dialog="release"]')).not.toBeNull()
    expect(host.querySelector('[data-release-layout]')).toBeNull()
    expect(host.querySelector('[data-whats-new-workbench]')).toBeNull()
    expect(host.querySelector('h2')?.textContent).toContain('0.4.5')
    const titles = [...host.querySelectorAll('.kun-wn-highlight-title')].map((element) => element.textContent)
    expect(titles).toEqual(content.current?.features.slice(0, 3).map((item) => item.title))
    const disclosure = button('[data-whats-new-more-features]')
    const list = document.getElementById(disclosure.getAttribute('aria-controls')!)!
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    expect(disclosure.querySelector('.kun-wn-count')?.textContent).toBe('5')
    expect(list.hidden).toBe(true)
    await click('[data-whats-new-more-features]')
    expect(disclosure.getAttribute('aria-expanded')).toBe('true')
    expect(list.hidden).toBe(false)
    const additionalTitles = [...list.querySelectorAll('strong')].map((element) => element.textContent)
    expect(additionalTitles).toEqual(content.current?.features.slice(3).map((item) => item.title))
    expect([...titles, ...additionalTitles]).toHaveLength(8)
    await click('[data-whats-new-more-features]')
    expect(list.hidden).toBe(true)
    await click('[data-whats-new-fixes]')
    expect(host.querySelectorAll('.kun-wn-fixes .kun-wn-fix-list > li')).toHaveLength(6)
  })

  it('keeps earlier releases separate and the changelog and dismiss actions working', async () => {
    await render(await release('0.4.5', '0.4.3'))
    expect(host.querySelector('[data-whats-new-dialog="skipped"]')).not.toBeNull()
    expect(button('.kun-wn-older button').textContent).toContain('0.4.4')
    await click('.kun-wn-older button')
    expect(host.querySelector('.kun-wn-older .kun-wn-fix-list')?.textContent).toContain('Work')
    await click('.kun-wn-link')
    expect(openExternal).toHaveBeenCalledWith('https://example.com/changelog')
    await click('[data-whats-new-primary]')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('0.4.4 update announcement', () => {
  it.each(['zh', 'en', 'hi', 'ja', 'ko', 'ru', 'th'])('renders localized release previews in %s', async (language) => {
    await translations.changeLanguage(language)
    await render(await release('v0.4.4'))
    const copy = resources[language].common
    expect(host.querySelector('[data-release-layout="workbench"]')).not.toBeNull()
    expect(host.querySelectorAll('[data-whats-new-feature]')).toHaveLength(3)
    expect(host.querySelector('h2')?.textContent).toBe(copy.whatsNewWorkbenchTitle)
    expect(host.textContent).toContain(copy.whatsNewWorkbenchWorkTitle)
    expect(host.textContent).toContain(copy.whatsNewWorkbenchDesignBody)
    expect(host.textContent).toContain(copy.whatsNewWorkbenchReportBody)
    expect(host.querySelectorAll('.kun-wn-preview[aria-hidden="true"]')).toHaveLength(3)
    expect(host.querySelector('.kun-wn-intro')).toBeNull()
    expect(host.textContent).not.toContain('whatsNewWorkbench')
    expect(button('[data-whats-new-primary]')).toBe(document.activeElement)
  })

  it('ships the same translation keys in all supported languages', () => {
    const expected = Object.keys(resources.en.common).sort()
    for (const { common } of Object.values(resources)) {
      expect(Object.keys(common).sort()).toEqual(expected)
      for (const value of Object.values(common)) expect(value.trim()).not.toBe('')
    }
  })

  it('expands all eight fixes with a labelled disclosure and respects reduced motion', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList)
    await render(await release())
    expect(button('[data-whats-new-fixes]').getAttribute('aria-expanded')).toBe('false')
    await click('[data-whats-new-fixes]')
    const disclosure = button('[data-whats-new-fixes]')
    const list = document.getElementById(disclosure.getAttribute('aria-controls')!)
    expect(disclosure.getAttribute('aria-expanded')).toBe('true')
    expect(list?.querySelectorAll(':scope > li')).toHaveLength(8)
    expect(list?.textContent).toContain('OAuth')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' })
    await click('[data-whats-new-fixes]')
    expect(host.querySelector('.kun-wn-fixes .kun-wn-fix-list')).toBeNull()
  })

  it('keeps skipped versions expandable without mixing them into the current fixes', async () => {
    await render(await release('0.4.4', '0.4.2'))
    expect(host.querySelector('[data-whats-new-dialog="skipped"]')).not.toBeNull()
    const history = button('.kun-wn-older button')
    expect(history.textContent).toContain('0.4.3')
    await act(async () => { history.click() })
    expect(history.getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelector('.kun-wn-older .kun-wn-fix-list')?.textContent).toContain('MiniMax-M3.1-Flash')
    expect(host.querySelector('.kun-wn-fixes .kun-wn-fix-list')).toBeNull()
  })

  it('keeps historical summaries shrinkable while the current fix label stays compact', async () => {
    const style = document.createElement('style')
    style.textContent = `${baseStyles}\n${workbenchStyles}`
    document.head.append(style)
    try {
      await render(await release('0.4.4', '0.4.2'))
      const history = host.querySelector<HTMLElement>('.kun-wn-older-preview')!
      const fixes = host.querySelector<HTMLElement>('.kun-wn-fixes .kun-wn-disclosure-label')!
      expect(getComputedStyle(history).flexGrow).toBe('1')
      expect(getComputedStyle(fixes).flexGrow).toBe('0')
    } finally {
      style.remove()
    }
  })

  it('preserves primary, close, Escape, backdrop, and external-link actions', async () => {
    await render(await release())
    await click('.kun-wn-link')
    expect(openExternal).toHaveBeenCalledWith('https://example.com/changelog')
    expect(onClose).not.toHaveBeenCalled()
    await click('[data-whats-new-primary]')
    await click('.kun-wn-x')
    await act(async () => { host.querySelector('section')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    await act(async () => { host.querySelector<HTMLDivElement>('.kun-wn-scrim')!.click() })
    expect(onClose).toHaveBeenCalledTimes(4)
  })

  it('traps keyboard focus and restores the original control after closing', async () => {
    await render(await release())
    const first = button('.kun-wn-x')
    const last = button('[data-whats-new-primary]')
    await act(async () => {
      last.focus()
      last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    })
    expect(document.activeElement).toBe(first)
    await act(async () => {
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    })
    expect(document.activeElement).toBe(last)
    await act(async () => { root.unmount() })
    mounted = false
    expect(document.activeElement?.id).toBe('previous-focus')
  })

  it('keeps missing notes non-blocking and opens the changelog from the fallback', async () => {
    await render({ version: '0.4.4', current: null, older: [], changelogUrl: 'https://example.com/fallback' })
    expect(host.querySelector('[data-whats-new-dialog="missing"]')).not.toBeNull()
    expect(host.querySelector('h2')?.textContent).toBe(resources.zh.common.whatsNewMissingTitle)
    expect(host.querySelector('[data-whats-new-workbench]')).toBeNull()
    await click('.kun-wn-secondary')
    expect(onClose).toHaveBeenCalledTimes(1)
    await click('.kun-wn-primary')
    expect(openExternal).toHaveBeenCalledWith('https://example.com/fallback')
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('leaves patch-only releases compact with their fixes visible', async () => {
    await render({
      version: '0.4.5', older: [], changelogUrl: '',
      current: { version: '0.4.5', intro: '', features: [], fixes: [{ title: 'Recovery', body: 'Recover interrupted work.' }] }
    })
    expect(host.querySelector('[data-whats-new-dialog="patch"]')).not.toBeNull()
    expect(host.querySelector('[data-release-layout]')).toBeNull()
    expect(host.querySelector('.kun-wn-fix-list')?.textContent).toContain('Recovery')
  })

  it('does not apply the workbench layout to earlier releases or incomplete feed notes', async () => {
    await render(await release('0.4.3', '0.4.2'))
    expect(host.querySelector('[data-release-layout]')).toBeNull()
    expect(host.querySelector('.kun-wn-highlights')).not.toBeNull()
    await render({
      version: '0.4.4', older: [], changelogUrl: '',
      current: { version: '0.4.4', intro: '', features: [{ title: 'Small update', body: 'A small change.' }], fixes: [] }
    })
    expect(host.querySelector('[data-release-layout]')).toBeNull()
    expect(host.querySelector('.kun-wn-highlights')?.textContent).toContain('Small update')
  })
})
