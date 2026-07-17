import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createArtifactPackage, verifyArtifactPackage } from './artifact-package'

describe('artifact package', () => {
  it('signs a deterministic manifest and rejects content tampering', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    let wrappedKeyBytes = 0
    const packaged = await createArtifactPackage({
      deliveryId: 'delivery-1', meetingId: 'meeting-1', senderMemberId: 'member-1',
      files: new Map([
        ['README.md', Buffer.from('hello')],
        ['src/index.ts', Buffer.from('export const value = 1\n')]
      ]),
      wrapContentKey: async (key) => {
        wrappedKeyBytes = key.byteLength
        return [{ recipientMemberId: 'member-2', envelope: 'opaque-hpke-envelope' }]
      },
      signingPrivateKey: privateKey.export({ type: 'pkcs8', format: 'der' })
    })

    expect(wrappedKeyBytes).toBe(32)
    expect(verifyArtifactPackage({
      manifest: packaged.manifest,
      content: packaged.content,
      signingPublicKey: publicKey.export({ type: 'spki', format: 'der' })
    })).toEqual(new Map([
      ['README.md', Buffer.from('hello')],
      ['src/index.ts', Buffer.from('export const value = 1\n')]
    ]))
    const tampered = Buffer.from(packaged.content)
    tampered[0] ^= 1
    expect(() => verifyArtifactPackage({
      manifest: packaged.manifest, content: tampered,
      signingPublicKey: publicKey.export({ type: 'spki', format: 'der' })
    })).toThrow(/content/i)
  })
})
