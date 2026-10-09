import { ipcMain, shell } from 'electron'
import type { Kun3dAssetListResult, Kun3dAssetReadResult } from '../../shared/kun-3d-assets'
import { ensureKun3dAssetRoot, kun3dAssetRoot, listKun3dAssets, readKun3dAsset } from '../kun-3d-assets'
import { kun3dAssetReadPayloadSchema } from './app-ipc-schemas'
import { parseIpcPayload } from './app-ipc-handler-utils'

/** The 3D asset space: list, read and open `~/.kun/3d-assets`. Desktop only; not exposed to remote clients. */
export function registerAppKun3dIpcHandlers(options: { root?: () => string } = {}): void {
  const root = options.root ?? (() => kun3dAssetRoot())
  ipcMain.handle('kun3d:list', async (): Promise<Kun3dAssetListResult> => listKun3dAssets(root()))
  ipcMain.handle('kun3d:read', async (_, payload: unknown): Promise<Kun3dAssetReadResult> => {
    const request = parseIpcPayload('kun3d:read', kun3dAssetReadPayloadSchema, payload)
    return readKun3dAsset(root(), request.key)
  })
  ipcMain.handle('kun3d:open-folder', async (): Promise<{ ok: boolean; message?: string }> => {
    const directory = root()
    try {
      await ensureKun3dAssetRoot(directory)
      const message = await shell.openPath(directory)
      return message ? { ok: false, message } : { ok: true }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })
}
