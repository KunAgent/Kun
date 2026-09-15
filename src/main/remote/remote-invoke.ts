import type { IpcMainInvokeEvent } from 'electron'
import type { RemoteClientSender } from './remote-sender'
import { remoteInvokeEvent } from './remote-sender'
import { remoteIpcHandlerFor } from './remote-ipc-registry'
import { REMOTE_ALLOWED_INVOKE_CHANNELS } from './remote-allowlist'

export type RemoteInvokeBody = {
  channel?: unknown
  args?: unknown
}

export class RemoteInvokeError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function remoteInvokeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error || 'Remote invoke failed')
}

/**
 * Remote clients may read/write general settings but must not reconfigure the
 * Remote gateway itself (enable flag, bind, port, password hash, sessions) —
 * those changes stay on the host through the dedicated remote:* channels.
 */
function sanitizeRemoteInvokeArgs(channel: string, args: unknown[]): unknown[] {
  if (channel !== 'settings:set' && channel !== 'settings:save-silent') return args
  return args.map((arg) => {
    if (arg && typeof arg === 'object' && 'remote' in arg) {
      const { remote: _remote, ...rest } = arg as Record<string, unknown>
      return rest
    }
    return arg
  })
}

/**
 * Dispatches one Remote invoke through the same `ipcMain.handle` listener the
 * desktop renderer reaches, using the client's sender stub as event.sender.
 */
export async function dispatchRemoteInvoke(
  body: RemoteInvokeBody,
  sender: RemoteClientSender
): Promise<unknown> {
  const channel = typeof body?.channel === 'string' ? body.channel : ''
  if (!channel || !REMOTE_ALLOWED_INVOKE_CHANNELS.has(channel)) {
    throw new RemoteInvokeError(403, `IPC channel is not available over Remote: ${channel || 'unknown'}`)
  }
  const handler = remoteIpcHandlerFor(channel)
  if (!handler) {
    throw new RemoteInvokeError(404, `IPC channel is not registered: ${channel}`)
  }
  const args = sanitizeRemoteInvokeArgs(channel, Array.isArray(body.args) ? body.args : [])
  const event = remoteInvokeEvent(sender) as unknown as IpcMainInvokeEvent
  try {
    return await handler(event, ...args)
  } catch (error) {
    throw new RemoteInvokeError(500, remoteInvokeErrorMessage(error))
  }
}
