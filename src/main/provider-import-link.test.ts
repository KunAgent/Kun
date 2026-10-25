import { describe, expect, it, vi } from 'vitest'
import {
  commitProviderImportLink,
  findProviderImportLinkArg,
  stageProviderImportLink
} from './provider-import-link'
import { normalizeAppSettings, type AppSettingsV1 } from '../shared/app-settings'

const settings = () => normalizeAppSettings({} as AppSettingsV1)

describe('findProviderImportLinkArg', () => {
  it('finds a cold-start link among other arguments', () => {
    expect(findProviderImportLinkArg([
      'C:\\Program Files\\Kun\\Kun.exe',
      '--flag',
      'kun://import?preset=litellm&key=sk-x',
      '--other'
    ])).toBe('kun://import?preset=litellm&key=sk-x')
  })

  it('strips windows-style quoting and surrounding whitespace', () => {
    expect(findProviderImportLinkArg(['"kun://import?preset=litellm&key=sk-y"']))
      .toBe('kun://import?preset=litellm&key=sk-y')
    expect(findProviderImportLinkArg(["  'kun://import?preset=litellm&key=sk-z'  "]))
      .toBe('kun://import?preset=litellm&key=sk-z')
  })

  it('matches case-insensitively and returns the first hit', () => {
    expect(findProviderImportLinkArg([
      'KUN://IMPORT?preset=litellm&key=sk-1',
      'kun://import?preset=litellm&key=sk-2'
    ])).toBe('KUN://IMPORT?preset=litellm&key=sk-1')
  })

  it('returns null for unrelated arguments', () => {
    expect(findProviderImportLinkArg(['kun://other?x=1', '--inspect'])).toBeNull()
    expect(findProviderImportLinkArg([])).toBeNull()
  })

  it('finds a Magpie provider import on a cold start', () => {
    const raw = magpieLink()
    expect(findProviderImportLinkArg(['--flag', `"${raw}"`])).toBe(raw)
  })
})

function magpieLink(port = 3425): string {
  const gateway = `http://127.0.0.1:${port}`
  const body = {
    kind: 'custom',
    id: 'magpie',
    name: 'Magpie',
    auth: { method: 'apiKey', apiKey: 'magpie-kun' },
    endpoints: [
      { protocol: 'openai-chat', baseUrl: `${gateway}/v1`, targets: ['kun'], modelsUrl: `${gateway}/v1/models` },
      { protocol: 'openai-responses', baseUrl: `${gateway}/v1`, targets: ['kun'], modelsUrl: `${gateway}/v1/models` },
      { protocol: 'anthropic-messages', baseUrl: gateway, targets: ['kun'], modelsUrl: `${gateway}/v1/models` }
    ]
  }
  return `kun://provider/import?v=1&data=${Buffer.from(JSON.stringify(body)).toString('base64url')}`
}

describe('stageProviderImportLink + commitProviderImportLink', () => {
  it('stages a preset link without exposing the key, then resolves on commit', () => {
    const staged = stageProviderImportLink('kun://import?preset=litellm&key=sk-live-secret')
    expect(staged.ok).toBe(true)
    if (!staged.ok) return
    expect(staged.staged.draft.hasKey).toBe(true)
    expect(staged.staged.draft.keyHint).toBe('sk-l…cret')
    expect(JSON.stringify(staged.staged)).not.toContain('sk-live-secret')

    const committed = commitProviderImportLink(staged.staged.token, settings())
    expect(committed.ok).toBe(true)
    if (!committed.ok) return
    expect(committed.profile.id).toBe('litellm')
    expect(committed.profile.apiKey).toBe('sk-live-secret')
  })

  it('rejects a replayed token', () => {
    const staged = stageProviderImportLink('kun://import?preset=litellm&key=sk-once')
    expect(staged.ok).toBe(true)
    if (!staged.ok) return
    expect(commitProviderImportLink(staged.staged.token, settings()).ok).toBe(true)
    expect(commitProviderImportLink(staged.staged.token, settings()).ok).toBe(false)
  })

  it('rejects malformed links before staging', () => {
    expect(stageProviderImportLink('kun://import').ok).toBe(false)
    expect(stageProviderImportLink('https://example.com/x').ok).toBe(false)
  })

  it('creates a Magpie profile from the local gateway and does not overwrite one that already exists', () => {
    const staged = stageProviderImportLink(magpieLink(4000))
    expect(staged.ok).toBe(true)
    if (!staged.ok) return
    const created = commitProviderImportLink(staged.staged.token, settings())
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.unchanged).toBeUndefined()
    expect(created.profile).toMatchObject({
      id: 'magpie',
      name: 'Magpie',
      apiKey: 'magpie-kun',
      baseUrl: 'http://127.0.0.1:4000/v1',
      endpointFormat: 'chat_completions',
      endpoints: {
        chat_completions: 'http://127.0.0.1:4000/v1',
        responses: 'http://127.0.0.1:4000/v1',
        messages: 'http://127.0.0.1:4000'
      },
      models: []
    })

    const again = stageProviderImportLink(magpieLink(3425))
    expect(again.ok).toBe(true)
    if (!again.ok) return
    const current = settings()
    const existing = {
      ...created.profile,
      name: 'Renamed Magpie',
      apiKey: 'user-key',
      models: ['keep-me']
    }
    const skipped = commitProviderImportLink(again.staged.token, {
      ...current,
      provider: { ...current.provider, providers: [...current.provider.providers, existing] }
    })
    expect(skipped).toMatchObject({
      ok: true,
      unchanged: true,
      profile: { id: 'magpie', name: 'Renamed Magpie', apiKey: 'user-key', models: ['keep-me'] }
    })
  })

  it('rejects a token after the staging TTL expires', () => {
    vi.useFakeTimers()
    try {
      const staged = stageProviderImportLink('kun://import?preset=litellm&key=sk-expire')
      expect(staged.ok).toBe(true)
      if (!staged.ok) return
      vi.setSystemTime(Date.now() + 11 * 60 * 1_000)
      expect(commitProviderImportLink(staged.staged.token, settings()).ok).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
