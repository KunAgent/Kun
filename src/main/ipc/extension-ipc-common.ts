import {
  webContents,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import type {
  ExtensionConsentRequest,
  ExtensionRuntimeRequestResult
} from '../../shared/extension-ipc'
import {
  MAX_EXTENSION_IPC_BODY_BYTES
} from './app-ipc-schemas/extensions'
import {
  ExtensionConsentError,
  type ExtensionConsentBinding
} from '../extensions/extension-consent-service'
import type {
  RegisterExtensionIpcHandlersOptions,
  RuntimeRequest
} from './extension-ipc-handler-options'
import { trustedRendererSenderIsCurrent } from '../renderer-trust-policy'
import { trustedWorkbenchRendererUrl } from '../main-window'

export async function performProtectedRuntimeOperation(
  options: RegisterExtensionIpcHandlersOptions,
  event: IpcMainInvokeEvent,
  binding: Omit<ExtensionConsentBinding, 'protectedWindowSessionId'>,
  consentRequestId: string | undefined,
  copy: { title: string; message: string; detail?: string },
  perform: () => Promise<ExtensionRuntimeRequestResult>
): Promise<ExtensionRuntimeRequestResult> {
  try {
    if (consentRequestId) {
      options.protectedActions.consume(consentRequestId, binding)
      return perform()
    }
    const result = await options.protectedActions.authorizeAndPerform(binding, copy, perform)
    return result ?? runtimeFailure('EXTENSION_CONSENT_DENIED', 'The protected operation was cancelled.', 403)
  } catch (error) {
    if (error instanceof ExtensionConsentError) {
      return runtimeFailure(error.code, error.message, 403)
    }
    options.logError?.('extension-consent', 'Protected extension operation failed.', {
      extensionId: binding.extensionId,
      operationKind: binding.operationKind,
      message: error instanceof Error ? error.message : String(error)
    })
    throw error
  } finally {
    void event
  }
}

export function consentBindingFromRequest(
  request: ExtensionConsentRequest,
  senderId: number
): Omit<ExtensionConsentBinding, 'protectedWindowSessionId'> {
  return {
    extensionId: request.extensionId,
    extensionVersion: request.extensionVersion,
    operationKind: request.operationKind,
    parameters: request.parameters,
    workspaceRoot: request.workspaceRoot,
    senderId
  }
}

export function assertTrustedWorkbenchSender(
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  getMainWindow: () => BrowserWindow | null
): void {
  if (!trustedRendererSenderIsCurrent(event, getMainWindow(), {
    trustedRendererUrl: trustedWorkbenchRendererUrl(),
    surface: 'workbench'
  })) {
    throw new Error('Extension IPC sender is not the trusted workbench frame.')
  }
}

export async function revokeContentScripts(
  options: RegisterExtensionIpcHandlersOptions,
  sender: WebContents,
  extensionId: string,
  reason: string,
  workspaceRoot?: string
): Promise<void> {
  try {
    await options.contentScripts.revokeExtension(sender, extensionId, reason, workspaceRoot)
  } catch (error) {
    options.logError?.('extension-content-script', 'Failed to revoke Direct DOM content.', {
      extensionId,
      reason,
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

export function disposeViewSessions(
  options: RegisterExtensionIpcHandlersOptions,
  extensionId: string,
  workspaceRoot?: string
): number {
  return workspaceRoot === undefined
    ? options.viewSessions.disposeForExtension(extensionId)
    : options.viewSessions.disposeForExtensionWorkspace(extensionId, workspaceRoot)
}

export function parsePayload<T>(
  channel: string,
  schema: { parse(value: unknown): T },
  payload: unknown
): T {
  let serialized: string
  try {
    if (payload === undefined) {
      serialized = ''
    } else {
      const encoded = JSON.stringify(payload)
      if (encoded === undefined) throw new Error('payload is not JSON')
      serialized = encoded
    }
  } catch {
    throw new Error(`Invalid payload for ${channel}: payload is not JSON.`)
  }
  if (Buffer.byteLength(serialized) > MAX_EXTENSION_IPC_BODY_BYTES) {
    throw new Error(`Invalid payload for ${channel}: payload is too large.`)
  }
  try {
    return schema.parse(payload)
  } catch (error) {
    throw new Error(`Invalid payload for ${channel}: ${error instanceof Error ? error.message : 'Bad request.'}`)
  }
}

export function stringifyBoundedRuntimeBody(
  channel: string,
  payload: unknown,
  maxBytes: number
): string {
  const body = JSON.stringify(payload)
  if (Buffer.byteLength(body) > maxBytes) {
    throw new Error(`Invalid payload for ${channel}: payload is too large.`)
  }
  return body
}
export function runtimeFailure(code: string, message: string, status: number): ExtensionRuntimeRequestResult {
  return { ok: false, status, body: JSON.stringify({ code, message }) }
}

export function runtimeResultError(result: ExtensionRuntimeRequestResult): Error {
  const parsed = safeJsonParse(result.body)
  const message = isRecord(parsed) && typeof parsed.message === 'string'
    ? parsed.message
    : `Kun extension request failed (${result.status}).`
  return new Error(message.slice(0, 2_000))
}

export function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
