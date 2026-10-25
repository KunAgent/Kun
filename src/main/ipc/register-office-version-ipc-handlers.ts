import { app, ipcMain, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { OfficeVersionFailure } from '../../shared/office-version'
import {
  officeVersionListPayloadSchema,
  officeVersionReadPayloadSchema,
  officeVersionRecordPayloadSchema,
  officeVersionRestorePayloadSchema
} from './app-ipc-schemas'
import { assertTrustedWorkbenchSender, parseIpcPayload } from './app-ipc-handler-utils'
import { resolveWorkspaceFile } from '../services/workspace-service'
import { createOfficeVersionStore, type OfficeVersionStore } from '../services/office-version-service'

/** Snapshots behind the artifact chat panel's undo, compare and Versions list. */
export function registerOfficeVersionIpcHandlers(options: {
  getMainWindow: () => BrowserWindow | null
  store?: OfficeVersionStore
}): void {
  const { getMainWindow } = options
  let store = options.store
  const versions = (): OfficeVersionStore => {
    store ??= createOfficeVersionStore(join(app.getPath('userData'), 'office-versions'))
    return store
  }
  const resolve = async (target: { path: string; workspaceRoot: string }): Promise<string | OfficeVersionFailure> => {
    const resolved = await resolveWorkspaceFile(target)
    return resolved.ok ? resolved.path : { ok: false, code: 'invalid', message: resolved.message }
  }

  ipcMain.handle('file:office-version-record', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const input = parseIpcPayload('file:office-version-record', officeVersionRecordPayloadSchema, payload)
    const path = await resolve(input)
    if (typeof path !== 'string') return path
    return versions().record({
      absolutePath: path,
      data: Buffer.from(input.dataBase64, 'base64'),
      sha256: input.sha256,
      ...(input.replacedBySha256 ? { replacedBySha256: input.replacedBySha256 } : {}),
      label: input.label,
      ...(input.threadId ? { threadId: input.threadId } : {})
    })
  })

  ipcMain.handle('file:office-version-list', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const input = parseIpcPayload('file:office-version-list', officeVersionListPayloadSchema, payload)
    const path = await resolve(input)
    return typeof path === 'string' ? versions().list(path) : path
  })

  ipcMain.handle('file:office-version-read', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const input = parseIpcPayload('file:office-version-read', officeVersionReadPayloadSchema, payload)
    const path = await resolve(input)
    return typeof path === 'string' ? versions().read(path, input.id) : path
  })

  ipcMain.handle('file:office-version-restore', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const input = parseIpcPayload('file:office-version-restore', officeVersionRestorePayloadSchema, payload)
    const path = await resolve(input)
    return typeof path === 'string' ? versions().restore(path, input.id, input.expectedSha256) : path
  })
}
