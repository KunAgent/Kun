import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DirectHost } from './direct-host'
import { DirectStore, directConfiguration } from './direct-store'
import type { LinkDependencies } from './service-dependencies'
import type { RegisterAppIpcHandlersOptions } from '../ipc/app-ipc-handler-options'
import { assertTrustedWorkbenchSender } from '../ipc/app-ipc-handler-utils'
import { DIRECT_LINK_CHANNELS as channels } from '../../shared/direct-link'
import { hasKunAccountSession } from '../../shared/kun-account'
import { createDesktopEngine } from '../remote-desktop/engine'
import { createTerminalEngine } from '../remote-terminal/engine'
import { createRuntimeOriginWorkspace } from './terminal-origin'
import { logWarn } from '../logger'

export function registerDirectLink(options: RegisterAppIpcHandlersOptions, base: LinkDependencies, root: string) {
  let owner: string | null = null
  let host: DirectHost
  const invoke = async (call: { method: string; params: Record<string, unknown> }, authority: { accountId: string; deviceId: string; authorizationId: string; scopes: readonly string[]; current(): boolean }) => {
    const lease = await options.acquireRuntimeRequestLease()
    if (!authority.current()) throw Error('AUTHORIZATION_REJECTED')
    const response = await lease.request('/v1/remote/invoke', 'POST', JSON.stringify({ accountId: authority.accountId,
      deviceId: authority.deviceId, authorizationId: authority.authorizationId, scopes: authority.scopes,
      call: { ...call, requestId: randomUUID(), expiresAt: Date.now() + 15000 } }))
    if (!response.ok || !authority.current()) throw Error('AUTHORIZATION_REJECTED')
    return JSON.parse(response.body)
  }
  const desktop = createDesktopEngine(async () => host.iceServers(), async (authority, resource) => {
    await invoke({ method: `${resource.kind}.history`, params: resource.kind === 'code' ? { threadId: resource.id } : { agentId: resource.id } }, authority)
  })
  const terminal = createTerminalEngine({ invoke, readWorkspace: createRuntimeOriginWorkspace(options) })
  const store = (id: string) => {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw Error('INVALID_OWNER')
    return new DirectStore(join(root, id, 'direct.enc'))
  }
  host = new DirectHost({ root, owner: () => owner, link: { ...base, desktop, terminal },
    read: id => store(id).read(), write: (id, value) => store(id).write(value), revoke: (id, grant) => store(id).revoke(grant), validate: directConfiguration })
  const observe = (state: Awaited<ReturnType<LinkDependencies['account']['getState']>>) => {
    const next = hasKunAccountSession(state) ? state.user?.id ?? null : null
    if (next === owner) return
    owner = next
    void host.endSession().then(() => host.restore()).catch(() => logWarn('mobile-link', 'DIRECT_RESTORE_FAILED'))
  }
  const release = base.account.onState(observe)
  const ending = base.account.onSessionEnding?.(async () => { owner = null; await host.endSession() })
  void base.account.getState().then(observe).catch(() => {})
  ipcMain.handle(channels.status, event => { assertTrustedWorkbenchSender(event, options.getMainWindow); return host.status() })
  ipcMain.handle(channels.retry, async event => { assertTrustedWorkbenchSender(event, options.getMainWindow); await host.restore(); return host.status() })
  ipcMain.handle(channels.configure, (event, value) => { assertTrustedWorkbenchSender(event, options.getMainWindow); return host.configure(value) })
  ipcMain.handle(channels.pair, (event, scopes) => { assertTrustedWorkbenchSender(event, options.getMainWindow); return host.pair(scopes) })
  ipcMain.handle(channels.revoke, (event, id) => { assertTrustedWorkbenchSender(event, options.getMainWindow); return host.revoke(id) })
  app.once('before-quit', () => { release(); ending?.(); owner = null; void host.endSession() })
  return host
}
