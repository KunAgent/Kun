import { describe, expect, it } from 'vitest'
import { normalizeCustomCaBundleConfig } from './custom-ca'

describe('custom CA bundle contract', () => {
  it('normalizes an absolute bundle path and lowercases its fingerprint', () => {
    expect(normalizeCustomCaBundleConfig({
      enabled: true,
      bundlePath: 'C:\\certs\\corp.pem',
      expectedSha256: 'A'.repeat(64)
    })).toEqual({
      ok: true,
      value: {
        enabled: true,
        bundlePath: 'C:\\certs\\corp.pem',
        expectedSha256: 'a'.repeat(64)
      }
    })
  })

  it('supports disabled configuration only without retained certificate data', () => {
    expect(normalizeCustomCaBundleConfig({ enabled: false, bundlePath: '' })).toEqual({
      ok: true,
      value: { enabled: false, bundlePath: '' }
    })
    expect(normalizeCustomCaBundleConfig({ enabled: false, bundlePath: '/tmp/old.pem' }).ok).toBe(false)
  })

  it.each([
    [{ enabled: true, bundlePath: 'relative.pem' }, 'path-not-absolute'],
    [{ enabled: true, bundlePath: '/tmp/ca.pem', expectedSha256: 'not-a-hash' }, 'invalid-sha256'],
    [{ enabled: true, bundlePath: '/tmp/ca\u0000.pem' }, 'path-control-character'],
    [{ enabled: true, bundlePath: '/tmp/ca.pem', insecureSkipVerify: true }, 'unknown-field']
  ])('rejects unsafe configuration %#', (input, error) => {
    expect(normalizeCustomCaBundleConfig(input)).toEqual({ ok: false, error })
  })

  it('accepts POSIX and UNC absolute paths but rejects arrays and missing enabled', () => {
    expect(normalizeCustomCaBundleConfig({ enabled: true, bundlePath: '/etc/ssl/corp.pem' }).ok).toBe(true)
    expect(normalizeCustomCaBundleConfig({ enabled: true, bundlePath: '\\\\server\\share\\corp.pem' }).ok).toBe(true)
    expect(normalizeCustomCaBundleConfig([])).toEqual({ ok: false, error: 'not-an-object' })
    expect(normalizeCustomCaBundleConfig({ bundlePath: '/tmp/ca.pem' })).toEqual({ ok: false, error: 'invalid-enabled' })
  })
})
