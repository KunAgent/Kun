import { describe, expect, it } from 'vitest'
import { appendHostMetadata } from './catalog-metadata'
describe('phone catalog safe host metadata', () => {
  it('derives target identity/app/platform from the host and strips undeclared runtime metadata', () => {
    const result = appendHostMetadata({ projects: [], host: { runtimeVersion: '0.4.0', protocolVersion: 1,
      releaseChannel: 'frontier', deviceId: 'forged', appVersion: 'forged', platform: 'forged', confirmedAt: 0,
      credentials: 'private fixture secret', workspace: '/private/fixture' } },
    { deviceId: 'actual-host', appVersion: '2.3.4', platform: 'macos' }, 1234)
    expect(result.host).toEqual({ runtimeVersion: '0.4.0', protocolVersion: 1, releaseChannel: 'frontier',
      deviceId: 'actual-host', appVersion: '2.3.4', platform: 'macos', confirmedAt: 1234 })
    expect(JSON.stringify(result)).not.toContain('private')
  })
  it('keeps legacy catalogs usable without inventing missing version metadata', () => {
    expect(appendHostMetadata({ capabilities: ['code'] }, { platform: 'linux' }, 20)).toEqual({
      capabilities: ['code'], host: { platform: 'linux', confirmedAt: 20 } })
    expect(appendHostMetadata({ host: { runtimeVersion: 'https://private.invalid/path', protocolVersion: NaN,
      releaseChannel: 'secret' } }, { platform: 'unknown', appVersion: 'invalid value' }, 20).host).toEqual({ confirmedAt: 20 })
  })
})
