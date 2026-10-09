import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { AccountError } from './errors'
import { KUN_ACCOUNT_CALLBACK_PATH, KUN_ACCOUNT_CALLBACK_PORT } from './config'
import { sendAccountCallbackPage as page } from './callback-page'

export interface AccountCallback { code: Promise<string>; close(): void; port: number }

export async function listenForAccountCode(state: string, signal: AbortSignal, port = KUN_ACCOUNT_CALLBACK_PORT, timeoutMs = 5 * 60_000): Promise<AccountCallback> {
  if (signal.aborted) throw new AccountError('cancelled')
  let resolveCode: (code: string) => void
  let rejectCode: (error: AccountError) => void
  let settled = false
  let timer: ReturnType<typeof setTimeout>
  const code = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject })
  void code.catch(() => {}) // The browser is opened after the listener has bound.
  function finish(error?: AccountError, value?: string): void {
    if (settled) return
    settled = true
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    server.close()
    server.closeIdleConnections()
    if (error) rejectCode(error)
    else resolveCode(value!)
  }
  const abort = () => finish(new AccountError('cancelled'))
  const server = createServer({ maxHeaderSize: 8192 }, (request, response) => {
    const address = server.address()
    const expectedHost = `127.0.0.1:${address && typeof address === 'object' ? address.port : port}`
    if (settled || request.method !== 'GET' || request.headers.host !== expectedHost || !request.url || request.url.length > 4096) {
      page(response, false, request); return
    }
    const url = new URL(request.url, `http://${expectedHost}`)
    const supplied = url.searchParams.get('state') || ''
    if (url.origin !== `http://${expectedHost}` || url.pathname !== KUN_ACCOUNT_CALLBACK_PATH ||
        ['state', 'code', 'error'].some((key) => url.searchParams.getAll(key).length > 1) ||
        Buffer.byteLength(supplied) !== Buffer.byteLength(state) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(state))) {
      page(response, false, request); return
    }
    if (url.searchParams.has('error')) { page(response, false, request); finish(new AccountError('cancelled')); return }
    const value = url.searchParams.get('code')
    if (!value || value.length > 2048) { page(response, false, request); return }
    page(response, true, request)
    finish(undefined, value)
  })
  server.requestTimeout = 10_000
  server.headersTimeout = 10_000
  await new Promise<void>((resolve, reject) => {
    server.once('error', () => { finish(new AccountError('port_busy')); reject(new AccountError('port_busy')) })
    server.listen(port, '127.0.0.1', () => resolve())
  })
  timer = setTimeout(() => finish(new AccountError('timeout')), timeoutMs)
  timer.unref()
  const boundPort = (server.address() as { port: number }).port
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  return { code, close: abort, port: boundPort }
}
