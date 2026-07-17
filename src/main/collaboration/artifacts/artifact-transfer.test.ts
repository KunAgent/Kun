import { describe, expect, it, vi } from 'vitest'
import { ArtifactTransfer } from './artifact-transfer'

describe('ArtifactTransfer', () => {
  it('uploads only missing encrypted chunks when resuming', async () => {
    const uploaded = new Set([0])
    const uploadChunk = vi.fn(async (index: number) => { uploaded.add(index) })
    const transfer = new ArtifactTransfer({
      uploadedChunkIndexes: async () => [...uploaded],
      uploadChunk,
      complete: vi.fn(async () => undefined)
    })
    const result = await transfer.upload({
      deliveryId: 'delivery-1',
      contentKey: Buffer.alloc(32, 4),
      plaintext: Buffer.from('first chunk second chunk'),
      chunkBytes: 12
    })

    expect(result.uploadedChunkIndexes).toEqual([1])
    expect(uploadChunk).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(uploadChunk.mock.calls)).not.toContain('second chunk')
  })
})
