import { describe, expect, it } from 'vitest'
import type { AppSettingsV1 } from '../../shared/app-settings'
import { remoteFeedAccessError } from './remote-feed-authorization'

const settings = { write: { paperMode: { discover: { feeds: [
  { id: 'f1', title: 'Host approved', url: 'https://example.org/rss' }
] } } } } as AppSettingsV1
const getSettings = async () => settings
const approved = new Set(['https://example.org/rss'])

describe('Remote feed authorization', () => {
  it('admits only the exact host-approved feed URL', async () => {
    expect(await remoteFeedAccessError({ channel: 'paper-discover:feed',
      args: [{ url: 'https://example.org/rss' }] }, approved, getSettings)).toBeNull()
    expect(await remoteFeedAccessError({ channel: 'paper-discover:feed',
      args: [{ url: 'https://127.0.0.1/private' }] }, approved, getSettings)).toContain('host-approved')
  })
  it('rejects a Remote settings patch that adds or changes a feed URL', async () => {
    for (const channel of ['settings:set', 'settings:save-silent']) {
      expect(await remoteFeedAccessError({ channel,
        args: [{ write: { paperMode: { discover: { feeds: [
          { id: 'f1', url: 'https://example.org/rss' }, { id: 'attacker', url: 'https://attacker.example/rss' }
        ] } } } }] }, approved, getSettings)).toContain('cannot change')
    }
    expect(await remoteFeedAccessError({ channel: 'settings:set',
      args: [{ write: { paperMode: { discover: { feeds: [{ id: 'f1', url: 'https://attacker.example/rss' }] } } } }] },
      approved, getSettings)).toContain('cannot change')
  })
  it('allows unrelated settings changes and unchanged host feed URLs', async () => {
    expect(await remoteFeedAccessError({ channel: 'settings:set', args: [{ appearance: { theme: 'dark' } }] },
      approved, getSettings)).toBeNull()
    expect(await remoteFeedAccessError({ channel: 'settings:set', args: [{ write: { paperMode: { discover: {
      feeds: [{ id: 'f1', title: 'Renamed', url: 'https://example.org/rss' }]
    } } } }] }, approved, getSettings)).toBeNull()
  })
})
