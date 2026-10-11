/** Opt-in live official-source smoke. No network runs during the normal unit suite. */
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  LOCAL_SANOTTS_RUNTIME_FILES,
  localSanottsRuntimeFileUrl,
  localSanottsVoiceFileUrl
} from '../../shared/local-sanotts'
import { LOCAL_SANOTTS_VOICES } from '../../shared/local-sanotts-voices'

vi.mock('electron', () => ({ app: { getVersion: () => 'download-smoke' } }))
import { downloadVerifiedAsset, readVerifiedAssetSize } from './local-sanotts-assets'

const output = process.env.KUN_SANOTTS_DOWNLOAD_TEST_DIR
const root = output ? resolve(output) : ''

describe.skipIf(!output)('official pinned sanoTTS downloads (live network)', () => {
  it('downloads and verifies the runtime and every complete voice, then reuses them offline', async () => {
    const assets = [
      ...LOCAL_SANOTTS_RUNTIME_FILES.map(file => ({
        ...file,
        url: localSanottsRuntimeFileUrl(file.fileName, 'github-pages'),
        targetPath: join(root, 'runtime', file.fileName)
      })),
      ...LOCAL_SANOTTS_VOICES.flatMap(voice => voice.files.map(file => ({
        ...file,
        url: localSanottsVoiceFileUrl(voice.id, file.fileName, 'github-pages'),
        targetPath: join(root, 'voices', voice.id, file.fileName)
      })))
    ]
    await mkdir(root, { recursive: true })
    for (const asset of assets) {
      await downloadVerifiedAsset({ ...asset, controller: new AbortController() })
      expect(await readVerifiedAssetSize(asset.targetPath, asset)).toBe(asset.sizeBytes)
    }
    const noNetwork = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    try {
      for (const asset of assets) {
        await downloadVerifiedAsset({ ...asset, controller: new AbortController() })
      }
      expect(noNetwork).not.toHaveBeenCalled()
    } finally {
      noNetwork.mockRestore()
    }
  }, 300_000)
})
