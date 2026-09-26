import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'

const REMOTE_SENDER_MARKER = Symbol.for('kun.remote.sender')

let nextRemoteSenderId = -1

/**
 * Minimal WebContents stand-in for one Remote browser client. IPC handlers
 * only rely on `id`, `send`, `isDestroyed`, `once('destroyed')` and
 * `removeListener`; EventEmitter covers the listener surface.
 */
export class RemoteClientSender extends EventEmitter {
  readonly [REMOTE_SENDER_MARKER] = true
  readonly id: number
  readonly clientId: string
  private destroyed = false
  private readonly emitToClient: (channel: string, payload: unknown) => void

  constructor(clientId: string, emitToClient: (channel: string, payload: unknown) => void) {
    super()
    this.setMaxListeners(0)
    this.id = nextRemoteSenderId
    nextRemoteSenderId -= 1
    this.clientId = clientId
    this.emitToClient = emitToClient
  }

  send(channel: string, ...args: unknown[]): void {
    if (this.destroyed) return
    this.emitToClient(channel, args.length <= 1 ? args[0] : args)
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  destroy(): void {
    if (this.destroyed) return
    // 'remote:will-destroy' fires while send() still works so subscribers can
    // flush terminal frames (e.g. runtime:sse-error) into the client's buffer
    // before the destroyed flag blocks further sends.
    this.emit('remote:will-destroy')
    this.destroyed = true
    this.emit('destroyed')
    this.removeAllListeners()
  }
}

export function isRemoteClientSender(sender: unknown): sender is RemoteClientSender {
  return (
    typeof sender === 'object' &&
    sender !== null &&
    (sender as Record<symbol, unknown>)[REMOTE_SENDER_MARKER] === true
  )
}

export function remoteInvokeEvent(sender: RemoteClientSender): {
  sender: WebContents
  senderFrame: undefined
} {
  return { sender: sender as unknown as WebContents, senderFrame: undefined }
}
