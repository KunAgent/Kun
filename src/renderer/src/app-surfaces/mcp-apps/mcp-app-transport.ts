import type { JSONRPCMessage, Transport } from '@modelcontextprotocol/client'
import { appSandboxApi, subscribeAppSandbox } from '../app-sandbox-client'

/**
 * MCP transport between an `AppBridge` in the workbench and the official
 * ext-apps `App` running in a sandboxed page. Messages travel through Main,
 * which pins them to this instance; the page posts to `window.parent` and the
 * shell preload forwards to Main, so the page needs no Kun-specific SDK.
 */
export class AppSandboxTransport implements Transport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void
  private unsubscribe: (() => void) | null = null
  private closed = false

  constructor(private readonly instanceId: string) {}

  async start(): Promise<void> {
    if (this.unsubscribe) return
    this.unsubscribe = subscribeAppSandbox(
      this.instanceId,
      (message) => {
        if (!message || typeof message !== 'object') return
        if ((message as { jsonrpc?: unknown }).jsonrpc !== '2.0') return
        this.onmessage?.(message as JSONRPCMessage)
      },
      () => void this.close()
    )
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.closed) throw new Error('The app page is closed.')
    const delivered = await appSandboxApi()?.post(this.instanceId, message)
    if (!delivered) {
      const error = new Error('The app page is not ready.')
      this.onerror?.(error)
      throw error
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.unsubscribe?.()
    this.unsubscribe = null
    this.onclose?.()
  }
}
