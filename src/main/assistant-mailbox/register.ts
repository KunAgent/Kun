import { app, ipcMain, net } from 'electron'
import { hostname } from 'node:os'
import { join } from 'node:path'
import type { ArtAccountAccess } from '../art-assets/account-access'
import type { RegisterAppIpcHandlersOptions } from '../ipc/app-ipc-handler-options'
import { assertTrustedWorkbenchSender } from '../ipc/app-ipc-handler-utils'
import { logInfo, logWarn } from '../logger'
// The mailbox acts as the same host device as the phone link, so it shares that identity file.
import { loadIdentity } from '../mobile-link/identity'
import {
  ASSISTANT_MAILBOX_CHANNELS as channels, isAssistantKind,
  type AssistantAssignRequest, type AssistantEnrollmentRequest
} from '../../shared/assistant-mailbox'
import { assistantMailboxEnabled } from './mcp-config'
import { electronSecretCipher, type SecretCipher } from './secret-store'
import { fetchSiteIcon } from './site-icon'
import { AssistantMailboxService } from './service'
import { AssistantToolEndpoint, assistantToolEndpointPaths } from './tool-endpoint'
import { ASSISTANT_TOOL_ROUTES, assistantToolHandler } from './tool-routes'

const ORIGIN = 'https://api-kun-server.com'

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_REQUEST')
  return value as Record<string, unknown>
}

export function registerAssistantMailbox(options: RegisterAppIpcHandlersOptions, account: ArtAccountAccess): void {
  const userData = app.getPath('userData')
  let cipher: Promise<SecretCipher> | null = null
  const fetchViaNet: typeof fetch = (input, init) =>
    net.fetch(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, init)
  const service = new AssistantMailboxService({
    origin: ORIGIN,
    account,
    identity: (owner) => loadIdentity(join(userData, 'mobile-link', owner, 'identity.enc')),
    storageDir: join(userData, 'assistant-mailbox'),
    cipher: () => (cipher ??= electronSecretCipher().catch((error: unknown) => { cipher = null; throw error })),
    fetch: fetchViaNet,
    fetchIcon: (website) => fetchSiteIcon(website, fetchViaNet),
    deviceName: hostname(),
    platform: process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
    enabled: async () => assistantMailboxEnabled(await options.store.load()),
    emit: (status) => {
      const window = options.getMainWindow()
      if (window && !window.isDestroyed()) window.webContents.send(channels.changed, status)
    },
    log: (level, message, detail) => (level === 'warn' ? logWarn : logInfo)('assistant-mailbox', message, detail)
  })
  const endpoint = new AssistantToolEndpoint(assistantToolEndpointPaths(userData), ASSISTANT_TOOL_ROUTES, assistantToolHandler(service))
  void endpoint.start().catch((error: unknown) =>
    logWarn('assistant-mailbox', 'Tool endpoint failed to start', { error: error instanceof Error ? error.message : String(error) }))

  ipcMain.handle(channels.status, (event) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    return service.refresh()
  })
  ipcMain.handle(channels.refresh, (event) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    return service.refresh({ probe: true })
  })
  ipcMain.handle(channels.enroll, (event, value: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const input = record(value)
    if (typeof input.name !== 'string' || !isAssistantKind(input.kind)) throw new Error('INVALID_REQUEST')
    return service.createEnrollment({
      name: input.name, kind: input.kind, locale: input.locale === 'en' ? 'en' : 'zh',
      ...(typeof input.product === 'string' ? { product: input.product } : {}),
      ...(typeof input.website === 'string' ? { website: input.website } : {})
    } satisfies AssistantEnrollmentRequest)
  })
  const ids = (...values: unknown[]): string[] => {
    if (!values.every((value) => typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value))) throw new Error('INVALID_REQUEST')
    return values as string[]
  }
  ipcMain.handle(channels.approve, (event, enrollmentId: unknown, requestId: unknown, verificationCode: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const [enrollment, request] = ids(enrollmentId, requestId)
    if (typeof verificationCode !== 'string' || !/^[0-9A-Z]{5}-[0-9A-Z]{5}$/.test(verificationCode)) throw new Error('INVALID_REQUEST')
    return service.approve(enrollment, request, verificationCode)
  })
  ipcMain.handle(channels.reject, (event, enrollmentId: unknown, requestId: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const [enrollment, request] = ids(enrollmentId, requestId)
    return service.reject(enrollment, request)
  })
  ipcMain.handle(channels.cancelEnrollment, (event, enrollmentId: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    return service.cancelEnrollment(ids(enrollmentId)[0])
  })
  ipcMain.handle(channels.reply, (event, taskId: unknown, body: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    if (typeof body !== 'string') throw new Error('INVALID_REQUEST')
    return service.reply(ids(taskId)[0], body)
  })
  ipcMain.handle(channels.promptFor, (event, enrollmentId: unknown, locale: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    return service.promptFor(ids(enrollmentId)[0], locale === 'en' ? 'en' : 'zh')
  })
  ipcMain.handle(channels.updatePrompt, (event, id: unknown, locale: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    return service.updatePrompt(ids(id)[0], locale === 'en' ? 'en' : 'zh')
  })
  ipcMain.handle(channels.revoke, (event, id: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    if (typeof id !== 'string') throw new Error('INVALID_REQUEST')
    return service.revoke(id)
  })
  ipcMain.handle(channels.assign, (event, value: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const input = record(value)
    if (typeof input.assistantId !== 'string' || typeof input.body !== 'string') throw new Error('INVALID_REQUEST')
    const request: AssistantAssignRequest = { assistantId: input.assistantId, body: input.body }
    if (typeof input.title === 'string') request.title = input.title
    if (typeof input.deadline === 'string') request.deadline = input.deadline
    return service.assign(request)
  })
  ipcMain.handle(channels.cancel, (event, id: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    if (typeof id !== 'string') throw new Error('INVALID_REQUEST')
    return service.cancel(id)
  })
  // Resume polling for an enabled mailbox once startup work has settled.
  setTimeout(() => void service.refresh().catch(() => {}), 15_000).unref?.()
  app.once('before-quit', () => {
    service.dispose()
    void endpoint.stop()
  })
}
