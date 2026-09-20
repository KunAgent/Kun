import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/kun-sanotts-concurrency' } }))
vi.mock('./local-sanotts-assets', async (original) => ({
  ...await original<any>(), readAssetSize: vi.fn().mockResolvedValue(null),
  downloadVerifiedAsset: vi.fn()
}))
import { readAssetSize, downloadVerifiedAsset } from './local-sanotts-assets'
import { downloadLocalSanottsRuntime, downloadLocalSanottsVoice } from './local-sanotts-download-service'

it('downloads runtime and a voice independently', async () => {
  let finish!: () => void
  vi.mocked(downloadVerifiedAsset).mockReturnValue(new Promise<void>(resolve => { finish = resolve }))
  const first = downloadLocalSanottsRuntime()
  await vi.waitFor(() => expect(downloadVerifiedAsset).toHaveBeenCalledTimes(1))
  const second = downloadLocalSanottsVoice('amy')
  await vi.waitFor(() => expect(downloadVerifiedAsset).toHaveBeenCalledTimes(2))
  vi.mocked(readAssetSize).mockResolvedValue(123)
  finish()
  await Promise.all([first, second])
  expect(vi.mocked(downloadVerifiedAsset).mock.calls.length).toBeGreaterThanOrEqual(2)
})
