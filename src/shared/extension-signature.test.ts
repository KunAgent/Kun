import { describe, expect, it } from 'vitest'
import {
  buildExtensionSignaturePayload,
  isExtensionSignatureCurrent,
  parseExtensionPackageSignature
} from './extension-signature'

const valid = {
  algorithm: 'ed25519',
  publisherId: 'kun.example',
  keyId: 'release-2026',
  publicKeyBase64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  packageSha256: 'a'.repeat(64),
  signatureBase64: `${'A'.repeat(86)}==`,
  signedAt: '2026-07-01T00:00:00.000Z',
  expiresAt: '2026-08-01T00:00:00.000Z'
}

describe('parseExtensionPackageSignature', () => {
  it('normalizes timestamps and accepts a bounded ed25519 record', () => {
    const result = parseExtensionPackageSignature({ ...valid, signedAt: '2026-07-01T00:00:00Z' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.signedAt).toBe('2026-07-01T00:00:00.000Z')
      expect(result.data.algorithm).toBe('ed25519')
    }
  })

  it('rejects unsupported algorithms and malformed cryptographic fields', () => {
    expect(parseExtensionPackageSignature({ ...valid, algorithm: 'rsa' }).success).toBe(false)
    expect(parseExtensionPackageSignature({ ...valid, packageSha256: 'A'.repeat(64) }).success).toBe(false)
    expect(parseExtensionPackageSignature({ ...valid, signatureBase64: 'not-base64' }).success).toBe(false)
    expect(parseExtensionPackageSignature({ ...valid, publicKeyBase64: 'A'.repeat(44) }).success).toBe(false)
    expect(parseExtensionPackageSignature({ ...valid, signatureBase64: 'A'.repeat(88) }).success).toBe(false)
  })

  it('rejects control characters, reversed validity windows, and oversized identifiers', () => {
    expect(parseExtensionPackageSignature({ ...valid, publisherId: 'publisher\n' }).success).toBe(false)
    expect(parseExtensionPackageSignature({ ...valid, keyId: ' release-2026' }).success).toBe(false)
    expect(parseExtensionPackageSignature({ ...valid, signedAt: '2026-07-01' }).success).toBe(false)
    expect(parseExtensionPackageSignature({ ...valid, expiresAt: valid.signedAt }).success).toBe(false)
    expect(parseExtensionPackageSignature({ ...valid, keyId: 'x'.repeat(129) }).success).toBe(false)
  })

  it('rejects arrays and non-object values', () => {
    expect(parseExtensionPackageSignature([]).success).toBe(false)
    expect(parseExtensionPackageSignature(null).success).toBe(false)
  })
})

describe('buildExtensionSignaturePayload', () => {
  it('builds deterministic canonical payload bytes', () => {
    expect(
      buildExtensionSignaturePayload({
        extensionId: 'demo',
        version: '1.2.3',
        apiMajor: 2,
        packageSha256: 'b'.repeat(64)
      })
    ).toBe(JSON.stringify({ apiMajor: 2, extensionId: 'demo', packageSha256: 'b'.repeat(64), version: '1.2.3' }))
  })

  it('rejects invalid payload identity and digest', () => {
    expect(() => buildExtensionSignaturePayload({ extensionId: 'demo\n', version: '1', apiMajor: 1, packageSha256: 'a'.repeat(64) })).toThrow()
    expect(() => buildExtensionSignaturePayload({ extensionId: 'demo', version: '1', apiMajor: 1.2, packageSha256: 'a'.repeat(64) })).toThrow()
    expect(() => buildExtensionSignaturePayload({ extensionId: 'demo', version: '1', apiMajor: 1, packageSha256: 'invalid' })).toThrow()
  })
})

describe('isExtensionSignatureCurrent', () => {
  it('accepts a timestamp inside the signed validity window', () => {
    const parsed = parseExtensionPackageSignature(valid)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(isExtensionSignatureCurrent(parsed.data, Date.parse('2026-07-14T00:00:00.000Z'))).toBe(true)
      expect(isExtensionSignatureCurrent(parsed.data, Date.parse('2026-08-02T00:00:00.000Z'))).toBe(false)
      expect(isExtensionSignatureCurrent(parsed.data, Number.NaN)).toBe(false)
    }
  })
})
