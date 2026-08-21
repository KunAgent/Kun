import { app, ipcMain, type BrowserWindow } from 'electron'
import {
  workspaceSpreadsheetConvertPayloadSchema,
  workspaceSpreadsheetSavePayloadSchema
} from './app-ipc-schemas'
import { assertTrustedWorkbenchSender, parseIpcPayload } from './app-ipc-handler-utils'
import { resolveWorkspaceFile } from '../services/workspace-service'
import { resolveOfficeCliBinary } from '../officecli-resources'
import {
  convertWorkspaceSpreadsheet,
  saveWorkspaceSpreadsheet
} from '../services/workspace-spreadsheet-service'

export function registerWorkspaceSpreadsheetIpcHandlers(options: {
  getMainWindow: () => BrowserWindow | null
  logError?: (category: string, message: string, detail?: unknown) => void
  logInfo?: (category: string, message: string, detail?: unknown) => void
}): void {
  const { getMainWindow } = options
  ipcMain.handle('file:save-workspace-spreadsheet', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const input = parseIpcPayload(
      'file:save-workspace-spreadsheet',
      workspaceSpreadsheetSavePayloadSchema,
      payload
    )
    const resolved = await resolveWorkspaceFile(input)
    if (!resolved.ok) return { ...resolved, code: 'invalid_request' as const }
    const binaryPath = resolveOfficeCliBinary({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appRoot: app.getAppPath(),
      explicitPath: process.env.KUN_OFFICECLI_BINARY
    })
    if (!binaryPath) {
      return {
        ok: false as const,
        code: 'officecli_unavailable' as const,
        message: 'Spreadsheet saving is unavailable because the bundled OfficeCLI binary was not found.'
      }
    }
    const abortController = new AbortController()
    const cancelWhenRendererCloses = (): void => abortController.abort()
    event.sender.once('destroyed', cancelWhenRendererCloses)
    try {
      return await saveWorkspaceSpreadsheet({
        path: resolved.path,
        expectedSha256: input.expectedSha256,
        mutations: input.mutations
      }, {
        binaryPath,
        signal: abortController.signal,
        logSave: (detail) => {
          const logger = detail.status === 'failed' ? options.logError : options.logInfo
          logger?.(
            'spreadsheet-save',
            detail.status === 'failed' ? 'Spreadsheet save failed' : 'Spreadsheet save completed',
            detail
          )
        }
      })
    } finally {
      event.sender.removeListener('destroyed', cancelWhenRendererCloses)
    }
  })

  ipcMain.handle('file:convert-workspace-spreadsheet', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const input = parseIpcPayload(
      'file:convert-workspace-spreadsheet',
      workspaceSpreadsheetConvertPayloadSchema,
      payload
    )
    const resolved = await resolveWorkspaceFile(input)
    if (!resolved.ok) return { ...resolved, code: 'invalid_request' as const }
    const abortController = new AbortController()
    const cancelWhenRendererCloses = (): void => abortController.abort()
    event.sender.once('destroyed', cancelWhenRendererCloses)
    try {
      return await convertWorkspaceSpreadsheet({
        path: resolved.path,
        expectedSha256: input.expectedSha256
      }, { signal: abortController.signal })
    } finally {
      event.sender.removeListener('destroyed', cancelWhenRendererCloses)
    }
  })
}
