import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  auditPackage,
  computeContentHash,
  evaluateUpdate,
  verifyPackageSignature
} from './package-audit.js'

describe('package supply-chain audit', () => {
  it('verifies downloaded bytes against the declared hash', () => {
    const content = Buffer.from('package bytes')
    const result = auditPackage({
      source: 'mcp',
      manifest: {
        name: '@example/tool',
        version: '1.2.3',
        publisher: 'example',
        contentHash: computeContentHash(content),
        permissions: ['network']
      },
      content,
      strict: false,
      sensitivePermissionConsent: true
    })

    expect(result.hashVerified).toBe(true)
    expect(result.findings).toContainEqual(expect.objectContaining({ code: 'hash_verified' }))
    expect(result.installable).toBe(true)
  })

  it('blocks hash mismatches and missing strict package bytes', () => {
    expect(auditPackage({
      source: 'mcp',
      manifest: { name: '@example/tool', version: '1.2.3', publisher: 'example', contentHash: 'deadbeef' },
      content: Buffer.from('different'),
      strict: true
    })).toMatchObject({
      installable: false,
      hashVerified: false,
      findings: expect.arrayContaining([
        expect.objectContaining({ code: 'hash_mismatch', severity: 'block' })
      ])
    })

    expect(auditPackage({
      source: 'mcp',
      manifest: { name: '@example/tool', version: '1.2.3', publisher: 'example' },
      strict: true
    })).toMatchObject({
      installable: false,
      hashVerified: false,
      findings: expect.arrayContaining([
        expect.objectContaining({ code: 'content_missing', severity: 'block' })
      ])
    })
  })

  it('verifies signatures only with runtime-trusted publisher keys', () => {
    const content = Buffer.from('signed bytes')
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const signatureBase64 = sign(null, content, privateKey).toString('base64')
    const publisherPublicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

    expect(verifyPackageSignature({ content, signatureBase64, publisherPublicKeyPem })).toBe(true)

    const verified = auditPackage({
      source: 'skill',
      manifest: {
        name: 'review',
        version: '1.0.0',
        publisher: 'kun',
        contentHash: computeContentHash(content),
        signatureBase64
      },
      content,
      trustedPublisherKeys: { kun: publisherPublicKeyPem },
      strict: true
    })
    expect(verified.signatureVerified).toBe(true)
    expect(verified.findings).toContainEqual(expect.objectContaining({ code: 'signature_verified' }))

    const unknownSigner = auditPackage({
      source: 'skill',
      manifest: {
        name: 'review',
        version: '1.0.0',
        publisher: 'kun',
        contentHash: computeContentHash(content),
        signatureBase64
      },
      content,
      strict: true
    })
    expect(unknownSigner.installable).toBe(false)
    expect(unknownSigner.findings).toContainEqual(expect.objectContaining({ code: 'unknown_signer', severity: 'block' }))
  })

  it('requires consent for newly sensitive update permissions', () => {
    expect(evaluateUpdate({
      current: { name: 'tool', version: '1.2.3', permissions: ['network'] },
      next: { name: 'tool', version: '1.3.0', permissions: ['network'] },
      autoUpdate: true
    })).toEqual({ allowed: true, requiresConsent: false, reason: 'minor/patch update within policy' })

    expect(evaluateUpdate({
      current: { name: 'tool', version: '1.2.3', permissions: ['network'] },
      next: { name: 'tool', version: '2.0.0', permissions: ['network'] },
      autoUpdate: true
    })).toMatchObject({ allowed: false, requiresConsent: true })

    expect(evaluateUpdate({
      current: { name: 'tool', version: '1.2.3', permissions: [] },
      next: { name: 'tool', version: '1.2.4', permissions: ['secret'] },
      autoUpdate: true
    })).toMatchObject({ allowed: false, requiresConsent: true })
  })
})
