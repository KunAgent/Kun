import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyCursorSpotlight, applyCursorSpotlightColor, applyDocumentLocale } from './apply-theme'

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

    applyDocumentLocale('en')
    expect(attributes.get('lang')).toBe('en')

    applyDocumentLocale('zh')
    expect(attributes.get('lang')).toBe('zh-CN')
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
