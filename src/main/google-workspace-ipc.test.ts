import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { GOOGLE_WORKSPACE_CHANNELS } from '../shared/google-workspace'
import { runtimeRequestPayloadSchema } from './ipc/app-ipc-schemas'

vi.mock('./ipc/app-ipc-handler-utils', () => ({ assertTrustedWorkbenchSender: vi.fn() }))
import { registerGoogleWorkspaceIpc } from './google-workspace-ipc'

describe('Google Workspace IPC boundary', () => {
  it.each(['status', 'login', 'setup', 'test', 'logout', 'cancel', 'authorization-url'])('keeps %s outside generic runtime IPC', (action) => {
    for (const method of ['GET', 'POST']) {
      expect(runtimeRequestPayloadSchema.safeParse({ path: `/v1/integrations/google-workspace/${action}`, method }).success).toBe(false)
    }
  })
  it('registers only fixed, argument-free, trusted-workbench operations', async () => {
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>()
    const assertSender = vi.fn()
    const assertReady = vi.fn()
    const request = vi.fn(async () => ({ ok: true, status: 200, body: '{}' }))
    registerGoogleWorkspaceIpc({
      ipcMain: { handle: (channel: string, handler: never) => handlers.set(channel, handler) } as never,
      getMainWindow: () => null, request, openExternal: vi.fn(), assertSender, assertReady
    })
    expect([...handlers.keys()].sort()).toEqual(Object.values(GOOGLE_WORKSPACE_CHANNELS).sort())
    for (const handler of handlers.values()) {
      expect(() => handler({} as IpcMainInvokeEvent, { authorizationUrl: 'https://evil.test' })).toThrow('does not accept arguments')
    }
    expect(request).not.toHaveBeenCalled()
    assertSender.mockImplementation(() => { throw new Error('untrusted') })
    for (const handler of handlers.values()) expect(() => handler({} as IpcMainInvokeEvent)).toThrow('untrusted')
    expect(assertReady).not.toHaveBeenCalled()
  })
})
