import { describe, expect, it } from 'vitest'
import { isProviderImportLink, parseProviderImportLink } from './provider-import-link'

describe('isProviderImportLink', () => {
  it('accepts kun://import with any casing and trailing punctuation', () => {
    expect(isProviderImportLink('kun://import?preset=a')).toBe(true)
    expect(isProviderImportLink('KUN://IMPORT/')).toBe(true)
    expect(isProviderImportLink('kun://import')).toBe(true)
  })

  it('rejects other schemes and bare prefixes', () => {
    expect(isProviderImportLink('kun://other?preset=a')).toBe(false)
    expect(isProviderImportLink('https://kun.import/x')).toBe(false)
    expect(isProviderImportLink('kun://importx?preset=a')).toBe(false)
  })
})

describe('parseProviderImportLink', () => {
  it('parses a preset link with key and models', () => {
    const result = parseProviderImportLink('kun://import?preset=litellm&key=sk-abc&models=m1,m2')
    expect(result).toMatchObject({
      ok: true,
      draft: { presetId: 'litellm', key: 'sk-abc', models: ['m1', 'm2'] },
      warnings: []
    })
  })

  it('requires https for remote endpoints', () => {
    const remote = parseProviderImportLink('kun://import?name=x&chat=http://api.example.com/v1&key=sk-a')
    expect(remote.ok).toBe(false)
    const secure = parseProviderImportLink('kun://import?name=x&chat=https://api.example.com/v1&key=sk-a')
    expect(secure.ok).toBe(true)
  })

  it('allows http endpoints on loopback and LAN hosts', () => {
    for (const host of ['http://localhost:8317/v1', 'http://127.0.0.1:4000', 'http://192.168.1.10:8080/v1']) {
      const result = parseProviderImportLink(`kun://import?name=lan&chat=${host}&key=sk-a`)
      expect(result.ok).toBe(true)
    }
  })

  it('rejects endpoints embedding credentials, query, or fragment', () => {
    expect(parseProviderImportLink('kun://import?name=x&chat=https://user:pw@api.example.com&key=a').ok).toBe(false)
    expect(parseProviderImportLink('kun://import?name=x&chat=https://api.example.com/v1%3Fdebug%3D1&key=a').ok).toBe(false)
    expect(parseProviderImportLink('kun://import?name=x&chat=https://api.example.com/v1%23frag&key=a').ok).toBe(false)
  })

  it('rejects keys with whitespace or non-printable characters', () => {
    expect(parseProviderImportLink('kun://import?preset=litellm&key=sk%20has%20space').ok).toBe(false)
    expect(parseProviderImportLink('kun://import?preset=litellm&key=sk%0Anewline').ok).toBe(false)
    expect(parseProviderImportLink('kun://import?preset=litellm&key=sk-fine_1.2-3').ok).toBe(true)
  })

  it('truncates the model list at the cap and reports a warning', () => {
    const models = Array.from({ length: 250 }, (_, i) => `m${i}`).join(',')
    const result = parseProviderImportLink(`kun://import?preset=litellm&key=sk-a&models=${models}`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.models).toHaveLength(200)
    expect(result.warnings).toHaveLength(1)
  })

  it('rejects links with neither preset nor endpoint', () => {
    expect(parseProviderImportLink('kun://import?key=sk-a').ok).toBe(false)
    expect(parseProviderImportLink('kun://import').ok).toBe(false)
  })

  it('maps per-protocol endpoint params onto the draft', () => {
    const result = parseProviderImportLink(
      'kun://import?name=relay&chat=https://r.example.com/oai&anthropic=https://r.example.com/claude&key=sk-a'
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draft.chatBaseUrl).toContain('r.example.com/oai')
    expect(result.draft.anthropicBaseUrl).toContain('r.example.com/claude')
  })
})
