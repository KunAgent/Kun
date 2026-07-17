import { createCipheriv, createHash, randomBytes } from 'node:crypto'

export type EncryptedArtifactChunk = {
  deliveryId: string
  index: number
  count: number
  plaintextBytes: number
  nonce: string
  tag: string
  ciphertext: string
  ciphertextSha256: string
}

type TransferPort = {
  uploadedChunkIndexes(deliveryId: string): Promise<number[]>
  uploadChunk(index: number, chunk: EncryptedArtifactChunk): Promise<void>
  complete(deliveryId: string, input: { chunkCount: number; plaintextBytes: number }): Promise<void>
}

export class ArtifactTransfer {
  constructor(private readonly port: TransferPort) {}

  async upload(input: {
    deliveryId: string
    contentKey: Buffer
    plaintext: Buffer
    chunkBytes?: number
  }): Promise<{ uploadedChunkIndexes: number[]; chunkCount: number }> {
    if (input.contentKey.byteLength !== 32) throw new Error('Artifact content key must be 32 bytes')
    if (input.plaintext.byteLength > 100 * 1024 * 1024) throw new Error('Artifact exceeds the 100 MB delivery limit')
    const chunkBytes = input.chunkBytes ?? 1024 * 1024
    if (!Number.isInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > 4 * 1024 * 1024) {
      throw new Error('Invalid artifact chunk size')
    }
    const count = Math.max(1, Math.ceil(input.plaintext.byteLength / chunkBytes))
    const existing = new Set(await this.port.uploadedChunkIndexes(input.deliveryId))
    const uploaded: number[] = []
    for (let index = 0; index < count; index += 1) {
      if (existing.has(index)) continue
      const plaintext = input.plaintext.subarray(index * chunkBytes, Math.min((index + 1) * chunkBytes, input.plaintext.byteLength))
      const chunk = encryptChunk(input.deliveryId, index, count, plaintext, input.contentKey)
      await this.port.uploadChunk(index, chunk)
      uploaded.push(index)
    }
    await this.port.complete(input.deliveryId, { chunkCount: count, plaintextBytes: input.plaintext.byteLength })
    return { uploadedChunkIndexes: uploaded, chunkCount: count }
  }
}

function encryptChunk(
  deliveryId: string,
  index: number,
  count: number,
  plaintext: Buffer,
  key: Buffer
): EncryptedArtifactChunk {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(Buffer.from(`kun-artifact-chunk-v1\0${deliveryId}\0${index}\0${count}`))
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return {
    deliveryId,
    index,
    count,
    plaintextBytes: plaintext.byteLength,
    nonce: nonce.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    ciphertextSha256: createHash('sha256').update(ciphertext).digest('hex')
  }
}
