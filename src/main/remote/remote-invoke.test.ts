import { describe, expect, it, vi } from 'vitest'

const registeredListeners = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      registeredListeners.set(channel, listener)
    }),
    removeHandler: vi.fn((channel: string) => {
      registeredListeners.delete(channel)
    })
  }
}))

import { dispatchRemoteInvoke, RemoteInvokeError } from './remote-invoke'
import { installRemoteIpcRegistry } from './remote-ipc-registry'
import { RemoteClientSender } from './remote-sender'
import {
  REMOTE_ALLOWED_EVENT_CHANNELS,
  REMOTE_ALLOWED_INVOKE_CHANNELS,
  REMOTE_BROADCAST_EVENT_CHANNELS
} from './remote-allowlist'

const sender = new RemoteClientSender('test', () => undefined)

describe('dispatchRemoteInvoke', () => {
  it('rejects channels outside the allowlist', async () => {
    await expect(dispatchRemoteInvoke({ channel: 'uninstall:start' }, sender)).rejects.toMatchObject({
      status: 403
    })
    await expect(dispatchRemoteInvoke({ channel: 'remote:password:set' }, sender)).rejects.toMatchObject({
      status: 403
    })
    await expect(dispatchRemoteInvoke({ channel: 'model-provider:credential:reveal' }, sender)).rejects.toMatchObject({
      status: 403
    })
    await expect(dispatchRemoteInvoke({ channel: 'credentials:reset-unreadable' }, sender)).rejects.toMatchObject({
      status: 403
    })
    await expect(dispatchRemoteInvoke({}, sender)).rejects.toBeInstanceOf(RemoteInvokeError)
  })

  it('dispatches an allowlisted channel through the recorded ipc handler', async () => {
    const { ipcMain } = await import('electron')
    installRemoteIpcRegistry()
    ipcMain.handle('app:version', (event: { sender: unknown }) => ({
      senderIsRemote: event.sender === sender,
      version: '9.9.9'
    }))
    const result = await dispatchRemoteInvoke({ channel: 'app:version' }, sender)
    expect(result).toEqual({ senderIsRemote: true, version: '9.9.9' })
  })

  it('rejects allowlisted channels that are not registered', async () => {
    await expect(dispatchRemoteInvoke({ channel: 'upstream:models' }, sender)).rejects.toMatchObject({
      status: 404
    })
  })

  it('surfaces handler errors as invoke failures', async () => {
    const { ipcMain } = await import('electron')
    installRemoteIpcRegistry()
    ipcMain.handle('log:get-path', () => {
      throw new Error('no log dir')
    })
    await expect(dispatchRemoteInvoke({ channel: 'log:get-path' }, sender)).rejects.toMatchObject({
      status: 500,
      message: 'no log dir'
    })
  })
})

describe('remote allowlist shape', () => {
  it('covers the core runtime data plane', () => {
    for (const channel of [
      'settings:get',
      'settings:set',
      'runtime:request',
      'runtime:sse:start',
      'runtime:sse:stop',
      'runtime:sse:ack',
      'terminal:create',
      'file:read-workspace',
      'git:branches'
    ]) {
      expect(REMOTE_ALLOWED_INVOKE_CHANNELS.has(channel)).toBe(true)
    }
  })

  it('keeps remote management and sensitive surfaces desktop-only', () => {
    for (const channel of [
      'remote:status:get',
      'remote:config:set',
      'remote:password:set',
      'remote:sessions:revoke',
      'model-provider:credential:reveal',
      'computer-use:permissions',
      'gui:update-install',
      'uninstall:start',
      'extension:install'
    ]) {
      expect(REMOTE_ALLOWED_INVOKE_CHANNELS.has(channel)).toBe(false)
    }
  })

  it('scopes event and broadcast sets to non-overlapping purposes', () => {
    expect(REMOTE_ALLOWED_EVENT_CHANNELS.has('runtime:sse-event')).toBe(true)
    expect(REMOTE_BROADCAST_EVENT_CHANNELS.has('runtime:status')).toBe(true)
    expect(REMOTE_BROADCAST_EVENT_CHANNELS.has('app:quitting')).toBe(true)
    expect(REMOTE_ALLOWED_EVENT_CHANNELS.has('gui:update-state')).toBe(false)
    expect(REMOTE_BROADCAST_EVENT_CHANNELS.has('gui:update-state')).toBe(true)
  })
})
