import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_LOCALE_OPTIONS } from '@shared/app-locales'
import {
  applyCursorSpotlight,
  applyCursorSpotlightColor,
  applyDarkUiColors,
  applyDocumentLocale,
  applyTheme,
  initializeStartupTheme
} from './apply-theme'

function installThemeEnvironment(initiallyDark: boolean): {
  attributes: Map<string, string>
  setSystemDark: (dark: boolean) => void
} {
  const attributes = new Map<string, string>()
  const listeners = new Set<() => void>()
  let matches = initiallyDark
  const mediaQuery = {
    get matches() {
      return matches
    },
    addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener))
  }
  vi.stubGlobal('document', {
    documentElement: {
      setAttribute: (name: string, value: string) => attributes.set(name, value)
    }
  })
  vi.stubGlobal('window', { matchMedia: vi.fn(() => mediaQuery) })
  return {
    attributes,
    setSystemDark: (dark: boolean) => {
      matches = dark
      listeners.forEach((listener) => listener())
    }
  }
}

describe('initializeStartupTheme', () => {
  afterEach(() => {
    applyTheme('light')
    vi.unstubAllGlobals()
  })

  function installStorage(initial?: string): Map<string, string> {
    const store = new Map<string, string>(initial ? [['kun.theme.cache', initial]] : [])
    const window = (globalThis as unknown as { window: Record<string, unknown> }).window
    window.localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value)
    }
    return store
  }

  it('paints the theme the user last applied, without waiting for settings', () => {
    const { attributes } = installThemeEnvironment(false)
    installStorage('dark')

    initializeStartupTheme()
    expect(attributes.get('data-theme')).toBe('dark')
  })

  it('falls back to the system theme on a first launch and keeps following the OS', () => {
    const { attributes, setSystemDark } = installThemeEnvironment(true)
    installStorage()

    initializeStartupTheme()
    expect(attributes.get('data-theme')).toBe('dark')

    setSystemDark(false)
    expect(attributes.get('data-theme')).toBe('light')
  })

  it('keeps following the OS when the remembered theme is system', () => {
    const { attributes, setSystemDark } = installThemeEnvironment(false)
    installStorage('system')

    initializeStartupTheme()
    expect(attributes.get('data-theme')).toBe('light')

    setSystemDark(true)
    expect(attributes.get('data-theme')).toBe('dark')
  })

  it('ignores a remembered value it does not recognise', () => {
    const { attributes } = installThemeEnvironment(false)
    installStorage('sepia')
    initializeStartupTheme()
    expect(attributes.get('data-theme')).toBe('light')
  })

  it('remembers a theme once it is applied, but not the startup fallback', () => {
    installThemeEnvironment(false)
    const store = installStorage()

    initializeStartupTheme()
    expect(store.has('kun.theme.cache')).toBe(false)

    applyTheme('dark')
    expect(store.get('kun.theme.cache')).toBe('dark')
  })
})

describe('applyDocumentLocale', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes a BCP-47 tag onto <html lang> for each supported locale', () => {
    const attributes = new Map<string, string>()
    vi.stubGlobal('document', {
      documentElement: {
        getAttribute: (name: string) => attributes.get(name) ?? null,
        setAttribute: (name: string, value: string) => {
          attributes.set(name, value)
        }
      }
    })

    for (const option of APP_LOCALE_OPTIONS) {
      applyDocumentLocale(option.value)
      expect(attributes.get('lang')).toBe(option.documentLanguage)
    }
  })

  it('does not touch the attribute when the locale already matches', () => {
    let writes = 0
    vi.stubGlobal('document', {
      documentElement: {
        getAttribute: () => 'en',
        setAttribute: () => {
          writes += 1
        }
      }
    })

    applyDocumentLocale('en')
    expect(writes).toBe(0)
  })
})

describe('applyCursorSpotlight', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reflects the saved preference on the document root', () => {
    const dataset: Record<string, string> = {}
    vi.stubGlobal('document', { documentElement: { dataset } })

    applyCursorSpotlight(true)
    expect(dataset.cursorSpotlight).toBe('on')

    applyCursorSpotlight(false)
    expect(dataset.cursorSpotlight).toBe('off')
  })

  it('applies custom spotlight RGB variables and clears them for the default color', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('document', {
      documentElement: {
        style: {
          setProperty: (name: string, value: string) => values.set(name, value),
          removeProperty: (name: string) => {
            values.delete(name)
          }
        }
      }
    })

    applyCursorSpotlightColor('#ff8800')
    expect(values.get('--ds-cursor-spotlight-rgb')).toBe('255 136 0')
    expect(values.get('--ds-cursor-spotlight-edge-rgb')).toBe('214 114 0')
    expect(values.get('--ds-cursor-spotlight-dark-rgb')).toBe('224 120 0')
    expect(values.get('--ds-cursor-spotlight-dark-edge-rgb')).toBe('255 165 61')

    applyCursorSpotlightColor('#85c1f1')
    expect(values.size).toBe(0)
  })
})

describe('applyDarkUiColors', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes normalized source colors and uses Graphite fallbacks', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('document', {
      documentElement: {
        style: { setProperty: (name: string, value: string) => values.set(name, value) }
      }
    })

    applyDarkUiColors({ background: '#AABBCC', border: 'bad', panel: '#123456' })

    expect(Object.fromEntries(values)).toEqual({
      '--kun-dark-ui-background': '#aabbcc',
      '--kun-dark-ui-border': '#272727',
      '--kun-dark-ui-panel': '#123456'
    })
  })
})
