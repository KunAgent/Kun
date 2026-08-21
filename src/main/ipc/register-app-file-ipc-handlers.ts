import {
  app,
  ipcMain,
  shell,
  type WebContents
} from 'electron'
import {
  randomUUID
} from 'node:crypto'
import {
  stat
} from 'node:fs/promises'
import {
  isAbsolute,
  join,
  resolve
} from 'node:path'
import {
  z
} from 'zod'
import {
  localPdfTextTargetPayloadSchema,
  localOfficeDocumentTargetPayloadSchema,
  streamIdSchema,
  workspaceDirectoryCreatePayloadSchema,
  workspaceClipboardImageSavePayloadSchema,
  workspaceImageBytesSavePayloadSchema,
  workspaceImagePickPayloadSchema,
  workspaceDirectoryTargetPayloadSchema,
  workspaceEntryDeletePayloadSchema,
  workspaceEntryRenamePayloadSchema,
  workspaceFileCreatePayloadSchema,
  workspaceFileRevealTargetPayloadSchema,
  workspaceFileTargetPayloadSchema,
  workspaceFileWatchPayloadSchema,
  workspaceFileWritePayloadSchema,
  workspaceOfficePreviewTargetPayloadSchema,
  workspaceOfficeSemanticTargetPayloadSchema,
  workspacePreviewLeaseReleasePayloadSchema,
  workspacePreviewLeaseTargetPayloadSchema
} from './app-ipc-schemas'
import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspaceEntry,
  listWorkspaceDirectory,
  readClipboardImage,
  readWorkspaceImage,
  readWorkspaceFile,
  readWorkspacePdf,
  renameWorkspaceEntry,
  resolveWorkspaceFile,
  pickAndSaveWorkspaceImage,
  saveWorkspaceClipboardImage,
  saveWorkspaceImageBytes,
  writeWorkspaceFile
} from '../services/workspace-service'
import {
  readLocalPdfText
} from '../services/write-pdf-text-service'
import {
  readLocalOfficeDocument
} from '../services/office-document-service'
import { readWorkspaceOfficePreview } from '../services/office-workspace-preview-service'
import { readWorkspaceOfficeSemantic } from '../services/office-workspace-semantic-service'
import {
  resolveOfficeCliBinary
} from '../officecli-resources'
import {
  startWorkspaceFileWatcher,
  type WorkspaceFileWatcherHandle
} from '../services/workspace-file-watcher'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import {
  assertTrustedWorkbenchSender,
  parseIpcPayload,
  saveWorkspaceFileAs
} from './app-ipc-handler-utils'
import type {
  WorkspaceFileWatchMode,
  WorkspaceFileWatchPayload
} from '../../shared/workspace-file'
import { registerWorkspaceSpreadsheetIpcHandlers } from './register-workspace-spreadsheet-ipc-handlers'

const extensionArtifactActionSchema = z.strictObject({
  artifactId: z.string().min(16).max(512).regex(/^[A-Za-z0-9_-]+$/),
  ownerExtensionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}\.[a-z0-9][a-z0-9-]{0,63}$/),
  ownerExtensionVersion: z.string().min(1).max(64),
  workspaceId: z.string().regex(/^[a-f0-9]{64}$/),
  workspaceRoot: z.string().min(1).max(16_384).refine(isAbsolute),
  action: z.enum(['open', 'reveal'])
})
const extensionArtifactResolutionSchema = z.strictObject({
  artifactId: z.string().min(16).max(512),
  absolutePath: z.string().min(1).max(16_384).refine(isAbsolute),
  displayName: z.string().min(1).max(256),
  mimeType: z.string().min(3).max(128)
})

type WorkspaceFileWatchRecord = {
  watcher: WorkspaceFileWatcherHandle
  sender: WebContents
  path: string
  workspaceRoot: string
  mode: WorkspaceFileWatchMode
  timer: ReturnType<typeof setTimeout> | null
}

type WorkspaceFileWatchSenderRecord = {
  sender: WebContents
  onDestroyed: () => void
}

type WorkspaceFileSignalResult =
  | {
      ok: true
      path: string
      size: number
      mtimeMs: number
    }
  | { ok: false; message: string }

async function readWorkspaceFileSignal(
  payload: WorkspaceFileWatchPayload
): Promise<WorkspaceFileSignalResult> {
  const resolved = await resolveWorkspaceFile(payload)
  if (!resolved.ok) return resolved
  try {
    const fileInfo = await stat(resolved.path)
    if (!fileInfo.isFile()) {
      return { ok: false, message: 'Path must point to a regular workspace file.' }
    }
    return {
      ok: true,
      path: resolved.path,
      size: fileInfo.size,
      mtimeMs: fileInfo.mtimeMs
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
export function registerAppFileIpcHandlers(options: RegisterAppIpcHandlersOptions): void {
  const { getMainWindow, runtimeRequest, logError } = options
  registerWorkspaceSpreadsheetIpcHandlers({ getMainWindow, logError, logInfo: options.logInfo })
  const workspaceFileWatchers = new Map<string, WorkspaceFileWatchRecord>()
  const workspaceFileWatchSenders = new Map<number, WorkspaceFileWatchSenderRecord>()
  const releaseWorkspaceFileWatchSender = (sender: WebContents): void => {
    const stillUsed = Array.from(workspaceFileWatchers.values()).some(
      (record) => record.sender.id === sender.id
    )
    if (stillUsed) return
    const record = workspaceFileWatchSenders.get(sender.id)
    if (!record) return
    record.sender.removeListener('destroyed', record.onDestroyed)
    workspaceFileWatchSenders.delete(sender.id)
  }

  const disposeWorkspaceFileWatch = (watchId: string): boolean => {
    const record = workspaceFileWatchers.get(watchId)
    if (!record) return false
    if (record.timer) clearTimeout(record.timer)
    try {
      record.watcher.close()
    } catch (error) {
      logError('workspace-watch', 'Failed to close workspace file watcher', {
        watchId,
        message: error instanceof Error ? error.message : String(error)
      })
    }
    workspaceFileWatchers.delete(watchId)
    releaseWorkspaceFileWatchSender(record.sender)
    return true
  }

  const disposeWorkspaceFileWatchesForSender = (sender: WebContents): void => {
    for (const [watchId, record] of workspaceFileWatchers) {
      if (record.sender.id === sender.id) {
        disposeWorkspaceFileWatch(watchId)
      }
    }
  }

  const retainWorkspaceFileWatchSender = (sender: WebContents): void => {
    if (workspaceFileWatchSenders.has(sender.id)) return
    const onDestroyed = (): void => {
      workspaceFileWatchSenders.delete(sender.id)
      disposeWorkspaceFileWatchesForSender(sender)
    }
    workspaceFileWatchSenders.set(sender.id, { sender, onDestroyed })
    sender.once('destroyed', onDestroyed)
  }

  const emitWorkspaceFileChange = async (watchId: string): Promise<void> => {
    const record = workspaceFileWatchers.get(watchId)
    if (!record) return
    const changedAt = new Date().toISOString()
    try {
      if (record.mode === 'signal') {
        const result = await readWorkspaceFileSignal({
          path: record.path,
          workspaceRoot: record.workspaceRoot,
          mode: 'signal'
        })
        const latest = workspaceFileWatchers.get(watchId)
        if (!latest || latest.sender.isDestroyed()) return
        if (result.ok) {
          latest.sender.send('file:workspace-changed', {
            ok: true,
            mode: 'signal',
            watchId,
            workspaceRoot: latest.workspaceRoot,
            path: result.path,
            content: '',
            size: result.size,
            mtimeMs: result.mtimeMs,
            truncated: false,
            changedAt
          })
          return
        }
        latest.sender.send('file:workspace-changed', {
          ok: false,
          mode: 'signal',
          watchId,
          workspaceRoot: latest.workspaceRoot,
          path: latest.path,
          message: result.message,
          changedAt
        })
        return
      }
      const result = await readWorkspaceFile({
        path: record.path,
        workspaceRoot: record.workspaceRoot
      })
      const latest = workspaceFileWatchers.get(watchId)
      if (!latest || latest.sender.isDestroyed()) return
      if (result.ok) {
        latest.sender.send('file:workspace-changed', {
          ok: true,
          watchId,
          workspaceRoot: latest.workspaceRoot,
          path: result.path,
          content: result.content,
          size: result.size,
          truncated: result.truncated,
          changedAt
        })
        return
      }
      latest.sender.send('file:workspace-changed', {
        ok: false,
        watchId,
        workspaceRoot: latest.workspaceRoot,
        path: latest.path,
        message: result.message,
        changedAt
      })
    } catch (error) {
      const latest = workspaceFileWatchers.get(watchId)
      if (!latest || latest.sender.isDestroyed()) return
      latest.sender.send('file:workspace-changed', {
        ok: false,
        ...(latest.mode === 'signal' ? { mode: 'signal' as const } : {}),
        watchId,
        workspaceRoot: latest.workspaceRoot,
        path: latest.path,
        message: error instanceof Error ? error.message : String(error),
        changedAt
      })
    }
  }

  const scheduleWorkspaceFileChange = (watchId: string): void => {
    const record = workspaceFileWatchers.get(watchId)
    if (!record) return
    if (record.timer) clearTimeout(record.timer)
    record.timer = setTimeout(() => {
      const latest = workspaceFileWatchers.get(watchId)
      if (!latest) return
      latest.timer = null
      void emitWorkspaceFileChange(watchId)
    }, 90)
  }

  ipcMain.handle('file:resolve-workspace', async (_, payload: unknown) =>
    resolveWorkspaceFile(
      parseIpcPayload('file:resolve-workspace', workspaceFileTargetPayloadSchema, payload)
    )
  )
  ipcMain.handle('file:open-workspace-system', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const resolved = await resolveWorkspaceFile(
      parseIpcPayload('file:open-workspace-system', workspaceFileTargetPayloadSchema, payload)
    )
    if (!resolved.ok) return resolved
    const message = await shell.openPath(resolved.path)
    return message ? { ok: false as const, message } : { ok: true as const }
  })
  ipcMain.handle('file:reveal-workspace-file', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const resolved = await resolveWorkspaceFile(
      parseIpcPayload('file:reveal-workspace-file', workspaceFileRevealTargetPayloadSchema, payload)
    )
    if (!resolved.ok) return resolved
    shell.showItemInFolder(resolved.path)
    return { ok: true as const }
  })
  ipcMain.handle('file:list-workspace-directory', async (_, payload: unknown) =>
    listWorkspaceDirectory(
      parseIpcPayload('file:list-workspace-directory', workspaceDirectoryTargetPayloadSchema, payload)
    )
  )
  ipcMain.handle('file:read-workspace', async (_, payload: unknown) =>
    readWorkspaceFile(
      parseIpcPayload('file:read-workspace', workspaceFileTargetPayloadSchema, payload)
    )
  )
  ipcMain.handle('file:read-workspace-image', async (_, payload: unknown) =>
    readWorkspaceImage(
      parseIpcPayload('file:read-workspace-image', workspaceFileTargetPayloadSchema, payload)
    )
  )
  ipcMain.handle('file:read-workspace-pdf', async (_, payload: unknown) =>
    readWorkspacePdf(
      parseIpcPayload('file:read-workspace-pdf', workspaceFileTargetPayloadSchema, payload)
    )
  )
  ipcMain.handle('file:open-workspace-preview', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    return options.workspacePreviewProtocols.createLease(
      event.sender,
      parseIpcPayload(
        'file:open-workspace-preview',
        workspacePreviewLeaseTargetPayloadSchema,
        payload
      )
    )
  })
  ipcMain.handle('file:release-workspace-preview', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const request = parseIpcPayload(
      'file:release-workspace-preview',
      workspacePreviewLeaseReleasePayloadSchema,
      payload
    )
    return options.workspacePreviewProtocols.release(event.sender.id, request.leaseId)
  })
  ipcMain.handle('file:read-local-pdf-text', async (_, payload: unknown) => {
    const result = await readLocalPdfText(
      parseIpcPayload('file:read-local-pdf-text', localPdfTextTargetPayloadSchema, payload)
    )
    if (!result.ok) return result
    return {
      ok: true,
      path: result.path,
      size: result.size,
      mtimeMs: result.mtimeMs,
      pageCount: result.pageCount,
      text: result.pages.map((page) => page.text).join('\n\n'),
      hasText: result.hasText,
      ocrApplied: result.ocrApplied,
      ocrPageCount: result.ocrPageCount,
      truncated: result.truncated
    }
  })
  ipcMain.handle('file:read-local-office-document', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const target = parseIpcPayload(
      'file:read-local-office-document',
      localOfficeDocumentTargetPayloadSchema,
      payload
    )
    const binaryPath = resolveOfficeCliBinary({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appRoot: app.getAppPath(),
      explicitPath: process.env.KUN_OFFICECLI_BINARY
    })
    if (!binaryPath) {
      return {
        ok: false as const,
        code: 'officecli_unavailable',
        message: 'Office document support is unavailable because the bundled OfficeCLI binary was not found.'
      }
    }
    const abortController = new AbortController()
    const cancelWhenRendererCloses = (): void => abortController.abort()
    event.sender.once('destroyed', cancelWhenRendererCloses)
    try {
      return await readLocalOfficeDocument(target, {
        binaryPath,
        signal: abortController.signal
      })
    } finally {
      event.sender.removeListener('destroyed', cancelWhenRendererCloses)
    }
  })
  ipcMain.handle('file:read-workspace-office-preview', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const target = parseIpcPayload(
      'file:read-workspace-office-preview',
      workspaceOfficePreviewTargetPayloadSchema,
      payload
    )
    const resolved = await resolveWorkspaceFile(target)
    if (!resolved.ok) return resolved
    const abortController = new AbortController()
    const cancelWhenRendererCloses = (): void => abortController.abort()
    event.sender.once('destroyed', cancelWhenRendererCloses)
    try {
      return await readWorkspaceOfficePreview({
        path: resolved.path,
        expectedSha256: target.expectedSha256
      }, {
        signal: abortController.signal
      })
    } finally {
      event.sender.removeListener('destroyed', cancelWhenRendererCloses)
    }
  })
  ipcMain.handle('file:read-workspace-office-semantic', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const target = parseIpcPayload(
      'file:read-workspace-office-semantic',
      workspaceOfficeSemanticTargetPayloadSchema,
      payload
    )
    const resolved = await resolveWorkspaceFile(target)
    if (!resolved.ok) return resolved
    const abortController = new AbortController()
    const cancelWhenRendererCloses = (): void => abortController.abort()
    event.sender.once('destroyed', cancelWhenRendererCloses)
    try {
      return await readWorkspaceOfficeSemantic({
        path: resolved.path,
        expectedSha256: target.expectedSha256
      }, {
        binaryPath: resolveOfficeCliBinary({
          isPackaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
          appRoot: app.getAppPath(),
          explicitPath: process.env.KUN_OFFICECLI_BINARY
        }),
        signal: abortController.signal
      })
    } finally {
      event.sender.removeListener('destroyed', cancelWhenRendererCloses)
    }
  })
  ipcMain.handle('file:save-as', async (_, payload: unknown) =>
    saveWorkspaceFileAs(payload, getMainWindow)
  )
  ipcMain.handle('extension:artifact:open', async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    const input = parseIpcPayload(
      'extension:artifact:open',
      extensionArtifactActionSchema,
      payload
    )
    const result = await options.runtimeRequest(
      '/v1/extensions/media/artifacts/resolve',
      'POST',
      JSON.stringify({
        artifactId: input.artifactId,
        ownerExtensionId: input.ownerExtensionId,
        ownerExtensionVersion: input.ownerExtensionVersion,
        workspaceId: input.workspaceId,
        workspaceRoot: input.workspaceRoot
      })
    )
    if (!result.ok) {
      return { ok: false, message: 'Generated artifact is unavailable.' }
    }
    let decoded: unknown
    try {
      decoded = JSON.parse(result.body)
    } catch {
      return { ok: false, message: 'Generated artifact metadata is invalid.' }
    }
    const resolved = extensionArtifactResolutionSchema.safeParse(decoded)
    if (!resolved.success || resolved.data.artifactId !== input.artifactId) {
      return { ok: false, message: 'Generated artifact metadata is invalid.' }
    }
    if (input.action === 'reveal') {
      shell.showItemInFolder(resolved.data.absolutePath)
      return { ok: true }
    }
    const error = await shell.openPath(resolved.data.absolutePath)
    return error
      ? { ok: false, message: 'The generated artifact could not be opened.' }
      : { ok: true }
  })
  ipcMain.handle('file:write-workspace', async (_, payload: unknown) =>
    writeWorkspaceFile(
      parseIpcPayload('file:write-workspace', workspaceFileWritePayloadSchema, payload)
    )
  )
  ipcMain.handle('file:create-workspace', async (_, payload: unknown) =>
    createWorkspaceFile(
      parseIpcPayload('file:create-workspace', workspaceFileCreatePayloadSchema, payload)
    )
  )
  ipcMain.handle('file:create-workspace-directory', async (_, payload: unknown) =>
    createWorkspaceDirectory(
      parseIpcPayload('file:create-workspace-directory', workspaceDirectoryCreatePayloadSchema, payload)
    )
  )
  ipcMain.handle('file:save-workspace-clipboard-image', async (_, payload: unknown) =>
    saveWorkspaceClipboardImage(
      parseIpcPayload(
        'file:save-workspace-clipboard-image',
        workspaceClipboardImageSavePayloadSchema,
        payload
      )
    )
  )
  ipcMain.handle('file:pick-workspace-image', async (_, payload: unknown) =>
    pickAndSaveWorkspaceImage(
      parseIpcPayload('file:pick-workspace-image', workspaceImagePickPayloadSchema, payload),
      { parentWindow: getMainWindow() }
    )
  )
  ipcMain.handle('file:save-workspace-image-bytes', async (_, payload: unknown) =>
    saveWorkspaceImageBytes(
      parseIpcPayload('file:save-workspace-image-bytes', workspaceImageBytesSavePayloadSchema, payload)
    )
  )
  ipcMain.handle('clipboard:read-image', async () => readClipboardImage())
  ipcMain.handle('file:rename-workspace-entry', async (_, payload: unknown) =>
    renameWorkspaceEntry(
      parseIpcPayload('file:rename-workspace-entry', workspaceEntryRenamePayloadSchema, payload)
    )
  )
  ipcMain.handle('file:delete-workspace-entry', async (_, payload: unknown) =>
    deleteWorkspaceEntry(
      parseIpcPayload('file:delete-workspace-entry', workspaceEntryDeletePayloadSchema, payload)
    )
  )
  ipcMain.handle('file:watch-workspace', async (event, payload: unknown) => {
    const request = parseIpcPayload('file:watch-workspace', workspaceFileWatchPayloadSchema, payload)
    const mode = request.mode ?? 'content'
    let watchedPath: string
    let initialContent = ''
    let initialSize = 0
    let initialMtimeMs = 0
    let initialTruncated = false
    let isImageWatch = false
    if (mode === 'signal') {
      const initial = await readWorkspaceFileSignal(request)
      if (!initial.ok) return initial
      watchedPath = initial.path
      initialSize = initial.size
      initialMtimeMs = initial.mtimeMs
    } else {
      const initial = await readWorkspaceFile(request)
      if (initial.ok) {
        watchedPath = initial.path
        initialContent = initial.content
        initialSize = initial.size
        initialTruncated = initial.truncated
      } else {
        const initialImage = await readWorkspaceImage(request)
        if (!initialImage.ok) return initial
        watchedPath = initialImage.path
        initialSize = initialImage.size
        isImageWatch = true
      }
    }

    const watchId = randomUUID()
    let watchReady = false
    let watchFatalMessage = ''
    try {
      const watcher = startWorkspaceFileWatcher({
        targetPath: watchedPath,
        onChange: () => scheduleWorkspaceFileChange(watchId),
        onFallback: ({ reason, error }) => {
          const code = (error as NodeJS.ErrnoException | undefined)?.code
          logError('workspace-watch', 'Workspace file watcher is using polling.', {
            watchId,
            path: watchedPath,
            watcherType: 'polling',
            reason,
            ...(code ? { code } : {}),
            ...(error ? { message: error.message } : {})
          })
        },
        onFatalError: (error) => {
          watchFatalMessage = error.message
          logError('workspace-watch', 'Workspace file watcher failed.', {
            watchId,
            path: watchedPath,
            message: error.message
          })
          if (!watchReady) return
          const latest = workspaceFileWatchers.get(watchId)
          if (!latest) return
          try {
            if (!latest.sender.isDestroyed()) {
              latest.sender.send('file:workspace-changed', {
                ok: false,
                ...(latest.mode === 'signal' ? { mode: 'signal' as const } : {}),
                watchId,
                workspaceRoot: latest.workspaceRoot,
                path: latest.path,
                message: error.message,
                changedAt: new Date().toISOString()
              })
            }
          } catch (sendError) {
            logError('workspace-watch', 'Failed to report workspace watcher failure.', {
              watchId,
              message: sendError instanceof Error ? sendError.message : String(sendError)
            })
          } finally {
            disposeWorkspaceFileWatch(watchId)
          }
        }
      })
      workspaceFileWatchers.set(watchId, {
        watcher,
        sender: event.sender,
        path: watchedPath,
        workspaceRoot: request.workspaceRoot,
        mode,
        timer: null
      })
      retainWorkspaceFileWatchSender(event.sender)
      // Close the read → watch race: a file can be atomically replaced after
      // the first read but before the directory watch starts. Re-read only
      // after the watch is live, so callers never bootstrap a stale SVG and a
      // later write is still delivered by the watcher.
      if (mode === 'signal') {
        const refreshed = await readWorkspaceFileSignal(request)
        if (!refreshed.ok) {
          disposeWorkspaceFileWatch(watchId)
          return refreshed
        }
        initialSize = refreshed.size
        initialMtimeMs = refreshed.mtimeMs
      } else if (!isImageWatch) {
        const refreshed = await readWorkspaceFile(request)
        if (!refreshed.ok) {
          disposeWorkspaceFileWatch(watchId)
          return refreshed
        }
        initialContent = refreshed.content
        initialSize = refreshed.size
        initialTruncated = refreshed.truncated
      } else {
        const refreshed = await readWorkspaceImage(request)
        if (!refreshed.ok) {
          disposeWorkspaceFileWatch(watchId)
          return refreshed
        }
        initialSize = refreshed.size
      }
      if (watchFatalMessage) {
        disposeWorkspaceFileWatch(watchId)
        return { ok: false as const, message: watchFatalMessage }
      }
      watchReady = true
      if (mode === 'signal') {
        return {
          ok: true as const,
          mode: 'signal' as const,
          watchId,
          path: watchedPath,
          content: '',
          size: initialSize,
          mtimeMs: initialMtimeMs,
          truncated: false as const,
          startedAt: new Date().toISOString()
        }
      }
      return {
        ok: true as const,
        watchId,
        path: watchedPath,
        content: initialContent,
        size: initialSize,
        truncated: initialTruncated,
        startedAt: new Date().toISOString()
      }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })
  ipcMain.handle('file:unwatch-workspace', async (_, watchId: unknown) =>
    disposeWorkspaceFileWatch(parseIpcPayload('file:unwatch-workspace', streamIdSchema, watchId))
  )
}
