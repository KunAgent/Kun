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

  it('uses the system theme immediately and then applies the saved theme', async () => {
    const { attributes } = installThemeEnvironment(false)
    let resolveSettings!: (settings: { theme: 'dark' }) => void
    const settings = new Promise<{ theme: 'dark' }>((resolve) => {
      resolveSettings = resolve
    })

    initializeStartupTheme(() => settings)
    expect(attributes.get('data-theme')).toBe('light')

    resolveSettings({ theme: 'dark' })
    await settings
    await Promise.resolve()
    expect(attributes.get('data-theme')).toBe('dark')
  })

  it('keeps following the OS when the saved theme is system', async () => {
    const { attributes, setSystemDark } = installThemeEnvironment(false)

    initializeStartupTheme(async () => ({ theme: 'system' }))
    await Promise.resolve()
    expect(attributes.get('data-theme')).toBe('light')

    setSystemDark(true)
    expect(attributes.get('data-theme')).toBe('dark')
  })

  it('keeps the system fallback when saved settings cannot be read', async () => {
    const { attributes, setSystemDark } = installThemeEnvironment(true)

    initializeStartupTheme(async () => {
      throw new Error('settings unavailable')
    })
    await Promise.resolve()
    expect(attributes.get('data-theme')).toBe('dark')

    setSystemDark(false)
    expect(attributes.get('data-theme')).toBe('light')
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
