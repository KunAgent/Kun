import { describe, expect, it } from 'vitest'
import {
  defaultRemoteAccessSettings,
  mergeRemoteAccessSettings,
  normalizeRemoteAccessSettings
} from './app-settings-remote'
import { normalizeAppSettings } from './app-settings-normalize'
import { settings as providerTestSettings } from './app-settings-provider.test-support'

describe('remote access settings', () => {
  it('defaults to disabled with auto port', () => {
    const remote = defaultRemoteAccessSettings()
    expect(remote.enabled).toBe(false)
    expect(remote.bind).toBe('lan')
    expect(remote.port).toBe(0)
    expect(remote.passwordHash).toBe('')
  })

  it('normalizes partial input and drops malformed hashes', () => {
    const remote = normalizeRemoteAccessSettings({
      enabled: true,
      bind: 'loopback',
      port: 3737,
      passwordHash: 'not-a-hash',
      sessionTtlHours: 12
    })
    expect(remote.enabled).toBe(true)
    expect(remote.bind).toBe('loopback')
    expect(remote.port).toBe(3737)
    expect(remote.passwordHash).toBe('')
    expect(remote.sessionTtlHours).toBe(12)
  })

  it('keeps a well-formed scrypt hash', () => {
    const hash = 'scrypt-v1$16384$abcd$0123'
    expect(normalizeRemoteAccessSettings({ passwordHash: hash }).passwordHash).toBe(hash)
  })

  it('clamps out-of-range ports and ttl', () => {
    const remote = normalizeRemoteAccessSettings({ port: 70_000, sessionTtlHours: 10_000 })
    expect(remote.port).toBe(65_535)
    expect(remote.sessionTtlHours).toBe(720)
    expect(normalizeRemoteAccessSettings({ port: -5 }).port).toBe(0)
  })

  it('merges patches over current values', () => {
    const merged = mergeRemoteAccessSettings(
      normalizeRemoteAccessSettings({ enabled: true, port: 4000 }),
      { bind: 'loopback' }
    )
    expect(merged.enabled).toBe(true)
    expect(merged.port).toBe(4000)
    expect(merged.bind).toBe('loopback')
  })

  it('is normalized inside full app settings', () => {
    const settings = normalizeAppSettings({
      ...providerTestSettings(),
      remote: { enabled: true, bind: 'bogus', port: -5 }
    } as never)
    expect(settings.remote.enabled).toBe(true)
    expect(settings.remote.bind).toBe('lan')
    expect(settings.remote.port).toBe(0)
  })
})
