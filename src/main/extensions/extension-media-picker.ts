import {
  MediaPickFilesRequestSchema,
  MediaPickFilesResultSchema,
  MediaPickSaveTargetRequestSchema,
  MediaPickSaveTargetResultSchema,
  type MediaPickFilesResult,
  type MediaPickSaveTargetResult,
  type MediaPickerFilter,
  type Locale
} from '@kun/extension-api'
import { dialog, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { randomBytes } from 'node:crypto'
import { basename, join } from 'node:path'
import {
  ExtensionMediaSelectionRegistrationRequestSchema,
  ExtensionMediaSelectionRegistrationResultSchema,
  ExtensionMediaViewBindingSchema,
  type ExtensionMediaViewBinding
} from '../../shared/extension-media-ipc'
import type {
  ExtensionViewSessionRecord,
  ExtensionViewSessionRegistry
} from './extension-view-sessions'

type RuntimeRequestResult = { ok: boolean; status: number; body: string }
type RuntimeRequest = (
  path: string,
  method?: string,
  body?: string,
  headers?: Record<string, string>
) => Promise<RuntimeRequestResult>

export class ExtensionMediaPickerError extends Error {
  constructor(
    readonly code:
      | 'MEDIA_INTERACTION_REQUIRED'
      | 'MEDIA_SCOPE_DENIED'
      | 'MEDIA_INVALID_ARGUMENT'
      | 'MEDIA_LIMIT_EXCEEDED'
      | 'MEDIA_REGISTRATION_FAILED',
    message: string
  ) {
    super(message)
    this.name = 'ExtensionMediaPickerError'
  }
}

type ExtensionMediaBindingContext = {
  event: IpcMainInvokeEvent
  record: ExtensionViewSessionRecord
  viewSessions: ExtensionViewSessionRegistry
  getMainWindow: () => BrowserWindow | null
  runtimeRequest: RuntimeRequest
}

export type ExtensionMediaPickerContext = ExtensionMediaBindingContext & {
  getWorkbenchLocale: () => Promise<Locale>
  onCleanupFailure?: (detail: { selectionCount: number }) => void
}

/**
 * Runs the import picker entirely in Electron Main. Paths and the protected
 * operation token only cross the authenticated Main-to-Kun route.
 */
export async function pickExtensionMediaFiles(
  context: ExtensionMediaPickerContext,
  requestInput: unknown
): Promise<MediaPickFilesResult> {
  const request = MediaPickFilesRequestSchema.parse(requestInput ?? {})
  const binding = requireProtectedViewBinding(context)
  const parent = requireMainWindow(context.getMainWindow)
  const locale = await context.getWorkbenchLocale()
  assertProtectedViewBindingCurrent(context, binding)
  const selected = await dialog.showOpenDialog(parent, {
    title: mediaPickerTitle(locale, 'import', context.record.extensionId),
    properties: request.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
    ...(request.filters.length > 0 ? { filters: electronFilters(request.filters) } : {})
  })
  assertProtectedViewBindingCurrent(context, binding)
  if (selected.canceled || selected.filePaths.length === 0) {
    return MediaPickFilesResultSchema.parse({ outcome: 'cancelled', files: [] })
  }
  if (selected.filePaths.length > request.maxFiles) {
    throw new ExtensionMediaPickerError(
      'MEDIA_LIMIT_EXCEEDED',
      `Selected file count exceeds the limit of ${request.maxFiles}.`
    )
  }
  const selections = await registerSelections(context.runtimeRequest, {
    binding,
    mode: 'read',
    paths: selected.filePaths
  })
  try {
    assertProtectedViewBindingCurrent(context, binding)
  } catch (error) {
    const released = await releaseRegisteredSelections(context.runtimeRequest, binding, selections)
    if (!released) throw cleanupFailure(context, selections.length)
    throw error
  }
  return MediaPickFilesResultSchema.parse({ outcome: 'selected', files: selections })
}

/** Main-owned export destination picker. It never creates or truncates a file. */
export async function pickExtensionMediaSaveTarget(
  context: ExtensionMediaPickerContext,
  requestInput: unknown
): Promise<MediaPickSaveTargetResult> {
  const request = MediaPickSaveTargetRequestSchema.parse(requestInput ?? {})
  const binding = requireProtectedViewBinding(context)
  const parent = requireMainWindow(context.getMainWindow)
  const suggestedName = request.suggestedName === undefined
    ? undefined
    : requireSafeSuggestedName(request.suggestedName)
  const locale = await context.getWorkbenchLocale()
  assertProtectedViewBindingCurrent(context, binding)
  const selected = await dialog.showSaveDialog(parent, {
    title: mediaPickerTitle(locale, 'export', context.record.extensionId),
    ...(suggestedName && context.record.workspaceRoot
      ? { defaultPath: join(context.record.workspaceRoot, suggestedName) }
      : suggestedName ? { defaultPath: suggestedName } : {}),
    ...(request.filters.length > 0 ? { filters: electronFilters(request.filters) } : {})
  })
  assertProtectedViewBindingCurrent(context, binding)
  if (selected.canceled || !selected.filePath) {
    return MediaPickSaveTargetResultSchema.parse({ outcome: 'cancelled' })
  }
  const [target] = await registerSelections(context.runtimeRequest, {
    binding,
    mode: 'export',
    paths: [selected.filePath]
  })
  if (target) {
    try {
      assertProtectedViewBindingCurrent(context, binding)
    } catch (error) {
      const released = await releaseRegisteredSelections(context.runtimeRequest, binding, [target])
      if (!released) throw cleanupFailure(context, 1)
      throw error
    }
  }
  if (!target) {
    throw new ExtensionMediaPickerError(
      'MEDIA_REGISTRATION_FAILED',
      'Kun did not register the selected export destination.'
    )
  }
  return MediaPickSaveTargetResultSchema.parse({ outcome: 'selected', target })
}

export function requireProtectedViewBinding(
  context: ExtensionMediaBindingContext
): ExtensionMediaViewBinding {
  const { event } = context
  const frame = event.senderFrame
  let record: ExtensionViewSessionRecord
  try {
    record = context.viewSessions.requireCurrentGuestMainFrame(
      event.sender.id,
      context.record.sessionId,
      context.record.nonce,
      frame
    )
  } catch {
    throw new ExtensionMediaPickerError(
      'MEDIA_SCOPE_DENIED',
      'Protected media selection requires the bound View main frame.'
    )
  }
  if (
    record.state !== 'active' ||
    record.guestWebContentsId !== event.sender.id ||
    record.guestMainFrameProcessId === undefined ||
    record.guestMainFrameRoutingId === undefined ||
    !frame ||
    frame.processId !== record.guestMainFrameProcessId ||
    frame.routingId !== record.guestMainFrameRoutingId
  ) {
    throw new ExtensionMediaPickerError(
      'MEDIA_SCOPE_DENIED',
      'Protected media selection requires the bound View main frame.'
    )
  }
  if (!record.workspaceRoot) {
    throw new ExtensionMediaPickerError(
      'MEDIA_SCOPE_DENIED',
      'Protected media selection requires an active trusted workspace.'
    )
  }
  return ExtensionMediaViewBindingSchema.parse({
    sessionId: record.sessionId,
    runtimeSessionId: record.runtimeSessionId,
    sessionNonce: record.nonce,
    extensionId: record.extensionId,
    extensionVersion: record.extensionVersion,
    contributionId: record.contributionId,
    workspaceRoot: record.workspaceRoot,
    senderWebContentsId: record.guestWebContentsId,
    senderMainFrameProcessId: record.guestMainFrameProcessId,
    senderMainFrameRoutingId: record.guestMainFrameRoutingId
  })
}

/** Rechecks the original document binding after an asynchronous Host action. */
export function assertProtectedViewBindingCurrent(
  context: ExtensionMediaBindingContext,
  binding: ExtensionMediaViewBinding
): void {
  const current = requireProtectedViewBinding(context)
  if (
    current.senderWebContentsId !== binding.senderWebContentsId ||
    current.senderMainFrameProcessId !== binding.senderMainFrameProcessId ||
    current.senderMainFrameRoutingId !== binding.senderMainFrameRoutingId
  ) {
    throw new ExtensionMediaPickerError(
      'MEDIA_SCOPE_DENIED',
      'Protected media selection requires the original View main frame.'
    )
  }
}

function requireMainWindow(getMainWindow: () => BrowserWindow | null): BrowserWindow {
  const parent = getMainWindow()
  if (!parent || parent.isDestroyed()) {
    throw new ExtensionMediaPickerError(
      'MEDIA_INTERACTION_REQUIRED',
      'Protected media selection requires an active desktop window.'
    )
  }
  return parent
}

function electronFilters(filters: readonly MediaPickerFilter[]): Electron.FileFilter[] {
  return filters.map((filter) => ({
    name: filter.name,
    extensions: [...filter.extensions]
  }))
}

function mediaPickerTitle(
  locale: Locale,
  operation: 'import' | 'export',
  extensionId: string
): string {
  const simplifiedChinese = /^zh(?:-|$)/i.test(locale.language)
  if (simplifiedChinese) {
    return operation === 'import'
      ? `为 ${extensionId} 选择媒体文件`
      : `为 ${extensionId} 选择导出位置`
  }
  return operation === 'import'
    ? `Select media files for ${extensionId}`
    : `Choose export destination for ${extensionId}`
}

function requireSafeSuggestedName(value: string): string {
  const name = value.trim()
  if (
    name.length === 0 ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    basename(name) !== name
  ) {
    throw new ExtensionMediaPickerError(
      'MEDIA_INVALID_ARGUMENT',
      'The suggested export name must be a file name without a path.'
    )
  }
  return name
}

async function registerSelections(
  runtimeRequest: RuntimeRequest,
  input: {
    binding: ExtensionMediaViewBinding
    mode: 'read' | 'export'
    paths: readonly string[]
  }
) {
  const request = ExtensionMediaSelectionRegistrationRequestSchema.parse({
    operationToken: randomBytes(32).toString('base64url'),
    binding: input.binding,
    mode: input.mode,
    selections: input.paths.map((absolutePath) => ({
      absolutePath,
      displayName: basename(absolutePath)
    }))
  })
  const result = await runtimeRequest(
    '/v1/extensions/media/selections',
    'POST',
    JSON.stringify(request)
  )
  if (!result.ok) {
    throw new ExtensionMediaPickerError(
      'MEDIA_REGISTRATION_FAILED',
      safeRuntimeFailure(result)
    )
  }
  let payload: unknown
  try {
    payload = JSON.parse(result.body)
  } catch {
    throw new ExtensionMediaPickerError(
      'MEDIA_REGISTRATION_FAILED',
      'Kun returned an invalid protected media registration response.'
    )
  }
  return ExtensionMediaSelectionRegistrationResultSchema.parse(payload).selections
}

async function releaseRegisteredSelections(
  runtimeRequest: RuntimeRequest,
  binding: ExtensionMediaViewBinding,
  selections: readonly { handleId: string }[]
): Promise<boolean> {
  let pending = [...selections]
  for (let attempt = 0; attempt < 3 && pending.length > 0; attempt += 1) {
    const results = await Promise.allSettled(pending.map((selection) => runtimeRequest(
      `/v1/extensions/view-sessions/${encodeURIComponent(binding.runtimeSessionId)}/requests`,
      'POST',
      JSON.stringify({
        requestId: `media-cleanup-${randomBytes(18).toString('base64url')}`,
        method: 'media.release',
        params: { resource: 'handle', handleId: selection.handleId },
        timeoutMs: 10_000
      }),
      {
        'x-kun-extension-session-id': binding.runtimeSessionId,
        'x-kun-extension-session-nonce': binding.sessionNonce
      }
    )))
    pending = pending.filter((_selection, index) => {
      const result = results[index]
      return !result || result.status === 'rejected' || !isConfirmedHandleRelease(result.value)
    })
  }
  return pending.length === 0
}

function isConfirmedHandleRelease(result: RuntimeRequestResult): boolean {
  if (!result.ok) return false
  try {
    const payload = JSON.parse(result.body) as { result?: { released?: unknown } }
    return payload.result?.released === true
  } catch {
    return false
  }
}

function cleanupFailure(
  context: ExtensionMediaPickerContext,
  selectionCount: number
): ExtensionMediaPickerError {
  context.onCleanupFailure?.({ selectionCount })
  return new ExtensionMediaPickerError(
    'MEDIA_REGISTRATION_FAILED',
    'Kun could not confirm rollback of a protected media selection.'
  )
}

function safeRuntimeFailure(result: RuntimeRequestResult): string {
  try {
    const payload = JSON.parse(result.body) as { code?: unknown }
    if (typeof payload.code === 'string' && /^[a-z0-9_-]{1,128}$/i.test(payload.code)) {
      return `Kun rejected protected media registration (${payload.code}).`
    }
  } catch {
    // Fall through to an intentionally path-free status message.
  }
  return `Kun rejected protected media registration (HTTP ${result.status}).`
}
