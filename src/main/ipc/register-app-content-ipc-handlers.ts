import {
  app,
  ipcMain,
  shell
} from 'electron'
import {
  mkdir,
  readFile
} from 'node:fs/promises'
import {
  createHash
} from 'node:crypto'
import {
  isAbsolute,
  relative,
  resolve,
  sep
} from 'node:path'
import {
  z
} from 'zod'
import type {
  GuiUpdateDownloadResult,
  GuiUpdateInfo,
  GuiUpdateInstallResult
} from '../../shared/gui-update'
import {
  appBadgeCountSchema,
  computerUsePermissionKindSchema,
  conversationExportPayloadSchema,
  desktopCommandSchema,
  guiUpdateChannelSchema,
  logErrorPayloadSchema,
  notificationPayloadSchema,
  projectDesignMdLintPayloadSchema,
  shellOpenExternalUrlSchema,
  localWhisperDownloadPayloadSchema,
  localWhisperModelIdPayloadSchema,
  localWhisperSourceStatusPayloadSchema,
  speechTranscribePayloadSchema,
  writeExportPayloadSchema,
  memoryMarkdownExportPayloadSchema,
  designExportPayloadSchema,
  writeRichClipboardPayloadSchema,
  writeDocumentSha256PayloadSchema,
  writeInfographicPayloadSchema,
  writeInlineCompletionPayloadSchema,
  writePrototypeFilePayloadSchema,
  writeRetrievalPayloadSchema
} from './app-ipc-schemas'
import {
  lintProjectDesignMd
} from '../services/project-design-md-lint'
import {
  openPathWithShell
} from '../services/workspace-service'
import {
  clearWriteInlineCompletionDebugEntries,
  listWriteInlineCompletionDebugEntries,
  requestWriteInlineCompletion
} from '../services/write-inline-completion-service'
import {
  retrieveWriteContext
} from '../services/write-retrieval-service'
import {
  requestWriteInfographic
} from '../services/write-infographic-service'
import {
  authorizePrototypePath
} from '../services/prototype-embed-registry'
import {
  requestSpeechTranscription
} from '../services/speech-to-text-service'
import {
  cancelLocalWhisperModel,
  deleteLocalWhisperModel,
  checkLocalWhisperDownloadSources,
  downloadLocalWhisperModel,
  getLocalWhisperModelStatus,
  setLocalWhisperProgressEmitter
} from '../services/local-whisper-service'
import {
  getComputerUsePermissions,
  requestComputerUsePermission
} from '../services/computer-use-permissions'
import {
  copyWriteDocumentAsRichText,
  exportDesignPrototype,
  exportWriteDocument
} from '../services/write-export-service'
import {
  exportConversation
} from '../services/conversation-export-service'
import {
  exportMemoryMarkdown
} from '../services/memory-export-service'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import {
  assertTrustedWorkbenchSender,
  parseIpcPayload,
  runDesktopCommand,
  isMiniWindowMode
} from './app-ipc-handler-utils'

function resolveWriteDocumentPath(workspaceRoot: string, filePath: string): string | null {
  if (!isAbsolute(workspaceRoot)) return null
  const root = resolve(workspaceRoot)
  const candidate = isAbsolute(filePath) ? resolve(filePath) : resolve(root, filePath)
  const rel = relative(root, candidate)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null
  return candidate
}

export function registerAppContentIpcHandlers(options: RegisterAppIpcHandlersOptions): void {
  const {
    store,
    getMainWindow,
    showTurnCompleteNotification,
    getAppVersion,
    readGuiUpdateState,
    loadGuiUpdaterModule,
    resolveLogDirectory,
    logError
  } = options
  const withRegistryCredentials = options.withRegistryCredentials ?? (async (settings) => settings)
  setLocalWhisperProgressEmitter((payload) => {
    getMainWindow()?.webContents.send('speech:local-whisper:progress', payload)
  })
  ipcMain.handle('write:export', async (_, payload: unknown) =>
    exportWriteDocument(
      parseIpcPayload('write:export', writeExportPayloadSchema, payload),
      { parentWindow: getMainWindow() }
    )
  )
  ipcMain.handle('conversation:export', async (_, payload: unknown) =>
    exportConversation(
      parseIpcPayload('conversation:export', conversationExportPayloadSchema, payload),
      { parentWindow: getMainWindow() }
    )
  )
  ipcMain.handle('memory:export-markdown', async (_, payload: unknown) =>
    exportMemoryMarkdown(
      parseIpcPayload('memory:export-markdown', memoryMarkdownExportPayloadSchema, payload),
      { parentWindow: getMainWindow() }
    )
  )
  ipcMain.handle('design:export-prototype', async (_, payload: unknown) =>
    exportDesignPrototype(
      parseIpcPayload('design:export-prototype', designExportPayloadSchema, payload),
      { parentWindow: getMainWindow() }
    )
  )
  ipcMain.handle('design:lint-project-design-md', async (_, payload: unknown) => {
    const request = parseIpcPayload('design:lint-project-design-md', projectDesignMdLintPayloadSchema, payload)
    return lintProjectDesignMd(request.content)
  })
  ipcMain.handle('write:copy-rich-text', async (_, payload: unknown) =>
    copyWriteDocumentAsRichText(
      parseIpcPayload('write:copy-rich-text', writeRichClipboardPayloadSchema, payload)
    )
  )
  ipcMain.handle('write:inline-completion', async (_, payload: unknown) =>
    requestWriteInlineCompletion(
      await withRegistryCredentials(await store.load()),
      parseIpcPayload('write:inline-completion', writeInlineCompletionPayloadSchema, payload)
    )
  )
  ipcMain.handle('write:retrieve-context', async (_, payload: unknown) => {
    try {
      const context = await retrieveWriteContext(
        parseIpcPayload('write:retrieve-context', writeRetrievalPayloadSchema, payload)
      )
      return { ok: true as const, context }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })
  ipcMain.handle('write:read-document-sha256', async (_, payload: unknown) => {
    try {
      const request = parseIpcPayload(
        'write:read-document-sha256',
        writeDocumentSha256PayloadSchema,
        payload
      )
      const absolutePath = resolveWriteDocumentPath(request.workspaceRoot, request.filePath)
      if (!absolutePath) {
        return { ok: false as const, message: 'write document path escapes the workspace' }
      }
      const bytes = await readFile(absolutePath)
      return { ok: true as const, sha256: createHash('sha256').update(bytes).digest('hex') }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })
  ipcMain.handle('write:generate-infographic', async (_, payload: unknown) =>
    requestWriteInfographic(
      await withRegistryCredentials(await store.load()),
      parseIpcPayload('write:generate-infographic', writeInfographicPayloadSchema, payload)
    )
  )
  ipcMain.handle('write:authorize-prototype', async (_, payload: unknown) => {
    const request = parseIpcPayload('write:authorize-prototype', writePrototypeFilePayloadSchema, payload)
    return authorizePrototypePath(request.path, request.workspaceRoot)
  })
  ipcMain.handle('write:open-prototype', async (_, payload: unknown) => {
    const request = parseIpcPayload('write:open-prototype', writePrototypeFilePayloadSchema, payload)
    const authorized = await authorizePrototypePath(request.path, request.workspaceRoot)
    if (!authorized.ok) return authorized
    return openPathWithShell(authorized.absolutePath)
  })
  ipcMain.handle('speech:transcribe', async (_, payload: unknown) =>
    requestSpeechTranscription(
      await withRegistryCredentials(await store.load()),
      parseIpcPayload('speech:transcribe', speechTranscribePayloadSchema, payload)
    )
  )
  ipcMain.handle('speech:local-whisper:status', async (_, modelId: unknown) =>
    getLocalWhisperModelStatus(parseIpcPayload('speech:local-whisper:status', localWhisperModelIdPayloadSchema, modelId))
  )
  ipcMain.handle('speech:local-whisper:download', async (_, modelId: unknown) =>
    {
      const payload = parseIpcPayload('speech:local-whisper:download', localWhisperDownloadPayloadSchema, modelId)
      return downloadLocalWhisperModel(payload.modelId, payload.sourceId)
    }
  )
  ipcMain.handle('speech:local-whisper:cancel', async (_, modelId: unknown) =>
    cancelLocalWhisperModel(parseIpcPayload('speech:local-whisper:cancel', localWhisperModelIdPayloadSchema, modelId))
  )
  ipcMain.handle('speech:local-whisper:sources', async (_, payload: unknown) =>
    {
      const request = parseIpcPayload('speech:local-whisper:sources', localWhisperSourceStatusPayloadSchema, payload)
      return checkLocalWhisperDownloadSources(request.modelId)
    }
  )
  ipcMain.handle('speech:local-whisper:delete', async (_, modelId: unknown) =>
    deleteLocalWhisperModel(parseIpcPayload('speech:local-whisper:delete', localWhisperModelIdPayloadSchema, modelId))
  )
  ipcMain.handle('write:inline-completion-debug:list', async () => listWriteInlineCompletionDebugEntries())
  ipcMain.handle('write:inline-completion-debug:clear', async () => {
    clearWriteInlineCompletionDebugEntries()
    return true
  })
  ipcMain.handle('window:mini-mode:get', (event) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    return isMiniWindowMode(getMainWindow())
  })
  ipcMain.handle('desktop:command', async (event, command: unknown) => {
    runDesktopCommand(
      parseIpcPayload('desktop:command', desktopCommandSchema, command),
      event.sender,
      getMainWindow
    )
  })
  ipcMain.handle('shell:open-external', async (_, url: unknown) => {
    const validatedUrl = parseIpcPayload('shell:open-external', shellOpenExternalUrlSchema, url)
    await shell.openExternal(validatedUrl)
  })
  ipcMain.handle('computer-use:permissions', async () => getComputerUsePermissions())
  ipcMain.handle('computer-use:request-permission', async (_, kind: unknown) => {
    const parsed = parseIpcPayload(
      'computer-use:request-permission',
      computerUsePermissionKindSchema,
      kind
    )
    return requestComputerUsePermission(parsed)
  })
  ipcMain.handle('app:badge-count', async (event, count: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const badgeCount = parseIpcPayload('app:badge-count', appBadgeCountSchema, count)
    if (process.platform !== 'darwin' && process.platform !== 'linux') {
      return { applied: false }
    }
    try {
      return { applied: app.setBadgeCount(badgeCount) }
    } catch {
      return { applied: false }
    }
  })
  ipcMain.handle('notification:turn-complete', async (_, payload: unknown) =>
    showTurnCompleteNotification(
      parseIpcPayload('notification:turn-complete', notificationPayloadSchema, payload)
    )
  )
  ipcMain.handle('app:version', async () => getAppVersion())
  ipcMain.handle('gui:update-state', async () => readGuiUpdateState())
  ipcMain.handle('gui:update-check', async (_, channel: unknown): Promise<GuiUpdateInfo> => {
    const module = await loadGuiUpdaterModule()
    return module.checkGuiUpdate(
      parseIpcPayload(
        'gui:update-check',
        z.object({ channel: guiUpdateChannelSchema }).strict(),
        { channel }
      ).channel
    )
  })
  ipcMain.handle('gui:update-download', async (_, channel: unknown): Promise<GuiUpdateDownloadResult> => {
    const module = await loadGuiUpdaterModule()
    return module.downloadGuiUpdate(
      parseIpcPayload(
        'gui:update-download',
        z.object({ channel: guiUpdateChannelSchema }).strict(),
        { channel }
      ).channel
    )
  })
  ipcMain.handle('gui:update-install', async (): Promise<GuiUpdateInstallResult> => {
    const module = await loadGuiUpdaterModule()
    return module.installGuiUpdate()
  })

  ipcMain.handle('log:error', async (_, payload: unknown) => {
    const request = parseIpcPayload('log:error', logErrorPayloadSchema, payload)
    logError(request.category, request.message, request.detail)
  })
  ipcMain.handle('log:get-path', async () => resolveLogDirectory())
  ipcMain.handle('log:open-dir', async () => {
    const dir = resolveLogDirectory()
    try {
      await mkdir(dir, { recursive: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, message }
    }
    const error = await shell.openPath(dir)
    if (error) return { ok: false, message: error }
    return { ok: true }
  })
}
