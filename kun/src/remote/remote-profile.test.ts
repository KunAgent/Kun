import { describe, expect, it } from 'vitest'
import { evaluateRemotePathAccess, isProtectedPath, normalizeRemotePath, parseRemoteProfile } from './remote-profile.js'

describe('remote-profile', () => {
  it('parses a valid secret-free profile with defaults', () => {
    const profile = parseRemoteProfile({
      name: 'Production API',
      host: 'prod-api',
      workspace: '/srv/api',
      mode: 'operations',
      production: true,
      healthCheck: 'http://127.0.0.1:8080/health',
      testCommand: 'npm test',
      protectedPaths: ['.env', '/etc']
    })
    expect(profile).toMatchObject({ name: 'Production API', host: 'prod-api', mode: 'operations', production: true })
  })

  it('defaults mode to observe and production to false', () => {
    const profile = parseRemoteProfile({ name: 'Dev', host: 'dev', workspace: '/app' })
    expect(profile.mode).toBe('observe')
    expect(profile.production).toBe(false)
    expect(profile.protectedPaths).toEqual([])
  })

  it('rejects profiles that carry secrets', () => {
    expect(() => parseRemoteProfile({ name: 'x', host: 'h', workspace: '/a', password: 'hunter2' })).toThrow(/secret/i)
    expect(() => parseRemoteProfile({ name: 'x', host: 'h', workspace: '/a', privateKey: '...' })).toThrow(/secret/i)
    expect(() => parseRemoteProfile({ name: 'x', host: 'h', workspace: '/a', api_key: 'k' })).toThrow(/secret/i)
  })

  it('rejects unknown keys via strict schema', () => {
    expect(() => parseRemoteProfile({ name: 'x', host: 'h', workspace: '/a', extra: 1 })).toThrow()
  })

  it('matches protected paths by exact and prefix', () => {
    const profile = { protectedPaths: ['.env', '/etc'] }
    expect(isProtectedPath(profile, '/etc/shadow')).toBe(true)
    expect(isProtectedPath(profile, '/srv/app/.env')).toBe(true)
    expect(isProtectedPath(profile, '/srv/app/src/index.ts')).toBe(false)
  })

  it('normalizes paths and blocks `..` traversal bypass', () => {
    expect(normalizeRemotePath('/srv/app/../../etc/shadow')).toBe('/etc/shadow')
    const profile = { protectedPaths: ['/etc'] }
    // A traversal that resolves into /etc must be caught.
    expect(isProtectedPath(profile, '/srv/app/../../etc/shadow')).toBe(true)
    // A path that only superficially contains "etc" is not protected.
    expect(isProtectedPath(profile, '/srv/etcd/data')).toBe(false)
  })

  it('evaluates capability + path access (target + capability + path)', () => {
    const profile = { protectedPaths: ['.env', '/etc'] }
    expect(evaluateRemotePathAccess({ capability: 'read', path: '/srv/app/src/x.ts', profile }).decision).toBe('allow')
    expect(evaluateRemotePathAccess({ capability: 'read', path: '/srv/app/.env', profile }).decision).toBe('confirm')
    expect(evaluateRemotePathAccess({ capability: 'write', path: '/etc/hosts', profile }).decision).toBe('confirm')
    // Writing a protected path on production is denied outright.
    expect(evaluateRemotePathAccess({ capability: 'write', path: '/etc/hosts', profile, production: true }).decision).toBe('deny')
  })
})
