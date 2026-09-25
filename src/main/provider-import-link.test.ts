import { describe, expect, it } from 'vitest'
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
})

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
})
