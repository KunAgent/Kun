import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/kun-pr1301-model-test' } }))
vi.mock('./local-kokoro-assets', async (original) => ({
  ...await original<any>(), readAssetSize: vi.fn().mockResolvedValue(null),
  downloadVerifiedAsset: vi.fn()
}))
import { readAssetSize, downloadVerifiedAsset } from './local-kokoro-assets'
import { downloadLocalKokoroModel } from './local-kokoro-download-service'

it('downloads different model tiers independently', async () => {
  let finish!: () => void
  vi.mocked(downloadVerifiedAsset).mockReturnValue(new Promise<void>(resolve => { finish = resolve }))
  const first = downloadLocalKokoroModel('kokoro-82m-int8')
  await vi.waitFor(() => expect(downloadVerifiedAsset).toHaveBeenCalledTimes(1))
  const second = downloadLocalKokoroModel('kokoro-82m-fp16')
  await vi.waitFor(() => expect(downloadVerifiedAsset).toHaveBeenCalledTimes(2))
  vi.mocked(readAssetSize).mockResolvedValue(123)
  finish()
  const results = await Promise.all([first, second])
  expect(results.map(result => result.status?.modelId)).toEqual(['kokoro-82m-int8', 'kokoro-82m-fp16'])
  expect(downloadVerifiedAsset).toHaveBeenCalledTimes(2)
})
