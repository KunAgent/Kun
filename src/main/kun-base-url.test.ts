import { describe, expect, it } from 'vitest'
import { getKunBaseUrl, normalizeLocalKunHost } from './kun-base-url'

describe('getKunBaseUrl', () => {
  it('uses 127.0.0.1 by default', () => {
    expect(getKunBaseUrl(18899)).toBe('http://127.0.0.1:18899')
  })

  it('formats IPv6 loopback hosts for URL use', () => {
    expect(getKunBaseUrl(18899, '::1')).toBe('http://[::1]:18899')
    expect(getKunBaseUrl(18899, '[::1]')).toBe('http://[::1]:18899')
  })

  it('accepts localhost aliases only', () => {
    expect(normalizeLocalKunHost('localhost')).toBe('localhost')
    expect(() => getKunBaseUrl(18899, 'example.com')).toThrow(/local host/)
  })
})
