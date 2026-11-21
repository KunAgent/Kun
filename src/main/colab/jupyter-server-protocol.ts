import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import type { ColabNotebookOutput } from '../../shared/colab/colab-notebook-types'

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_RE = /\u001b\[[0-9;]*m/g

export type JupyterAuthHeaders = Record<string, string>

export type ParsedJupyterEndpoint = {
  baseUrl: string
  secret: string
  defaultName: string
}

/** Normalizes pasted JupyterLab / Notebook / JupyterHub URLs and extracts `?token=`. */
export function parseJupyterServerUrl(rawUrl: string, explicitSecret = ''): ParsedJupyterEndpoint {
  let candidate = rawUrl.trim()
  if (!candidate) throw new Error('Please enter a Jupyter server URL.')
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) {
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(candidate)
    candidate = `${isLocal ? 'http' : 'https'}://${candidate}`
  }
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error('Invalid Jupyter server URL.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Jupyter server URL must use http:// or https://.')
  }
  if (parsed.username || parsed.password) throw new Error('Enter Jupyter credentials in the token or password field.')
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(parsed.hostname)
  const tokenFromQuery = parsed.searchParams.get('token')?.trim() ?? ''
  const secret = explicitSecret.trim() || tokenFromQuery
  if (secret && parsed.protocol !== 'https:' && !isLocal) {
    throw new Error('Use HTTPS or a localhost tunnel to send Jupyter credentials securely.')
  }
  const cleanedPath = parsed.pathname
    .replace(/\/(lab|tree|notebooks|consoles|terminals|edit)(\/.*)?$/i, '')
    .replace(/\/+$/, '')
  const baseUrl = `${parsed.origin}${cleanedPath}`
  return {
    baseUrl,
    secret,
    defaultName: parsed.host
  }
}

export function encodeJupyterPath(remotePath: string): string {
  return remotePath
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

function collectCookies(resp: Response): Record<string, string> {
  const cookies: Record<string, string> = {}
  const headersWithSetCookie = resp.headers as unknown as { getSetCookie?: () => string[] }
  const rawList =
    typeof headersWithSetCookie.getSetCookie === 'function'
      ? headersWithSetCookie.getSetCookie()
      : (resp.headers.get('set-cookie') ?? '').split(/,(?=\s*[A-Za-z0-9_-]+=)/)
  for (const entry of rawList) {
    const first = entry.split(';')[0]?.trim()
    if (!first) continue
    const eq = first.indexOf('=')
    if (eq > 0) cookies[first.slice(0, eq).trim()] = first.slice(eq + 1).trim()
  }
  return cookies
}

function parseKernelspecsPayload(data: unknown): { defaultKernel: string; kernels: string[] } {
  const obj = (data && typeof data === 'object' ? data : {}) as {
    default?: unknown
    kernelspecs?: Record<string, unknown>
  }
  const kernels = obj.kernelspecs && typeof obj.kernelspecs === 'object' ? Object.keys(obj.kernelspecs) : []
  const def = typeof obj.default === 'string' && obj.default ? obj.default : kernels[0] || 'python3'
  return { defaultKernel: def, kernels: kernels.length > 0 ? kernels : [def] }
}

/** Authenticates via API token or Jupyter `/login` password exchange. */
export async function authenticateJupyterServer(
  baseUrl: string,
  secret: string,
  fetchFn: typeof fetch = fetch,
  access: 'kernel' | 'files' = 'kernel'
): Promise<
  | { ok: true; headers: JupyterAuthHeaders; authMode: 'token' | 'password' | 'none'; defaultKernel: string; kernels: string[] }
  | { ok: false; message: string }
> {
  const tokenHeaders: JupyterAuthHeaders = secret ? { Authorization: `token ${secret}` } : {}
  const url = `${baseUrl}${access === 'files' ? '/api/contents?content=0' : '/api/kernelspecs'}`
  const probe = (headers: JupyterAuthHeaders): Promise<Response> => fetchFn(url, {
    headers: { Accept: 'application/json', ...headers },
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000)
  })
  const discover = async (res: Response): Promise<{ defaultKernel: string; kernels: string[] }> => {
    const body: unknown = await res.json()
    if (access === 'kernel') return parseKernelspecsPayload(body)
    if (!body || typeof body !== 'object' || !('type' in body) || body.type !== 'directory') {
      throw new Error('The address did not return a Jupyter directory.')
    }
    return { defaultKernel: 'python3', kernels: [] }
  }
  const needsLogin = (res: Response): boolean => res.status === 401 || res.status === 403 ||
    (res.status >= 300 && res.status < 400)
  try {
    const res = await probe(tokenHeaders)
    if (res.ok) {
      return { ok: true, headers: tokenHeaders, authMode: secret ? 'token' : 'none', ...await discover(res) }
    }
    if (needsLogin(res) && secret) {
      const loginGet = await fetchFn(`${baseUrl}/login`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(12_000)
      })
      const c1 = collectCookies(loginGet)
      const xsrf = c1._xsrf || ''
      const cookieHeader1 = Object.entries(c1)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')
      const loginPost = await fetchFn(`${baseUrl}/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(cookieHeader1 ? { Cookie: cookieHeader1 } : {}),
          ...(xsrf ? { 'X-XSRFToken': xsrf } : {})
        },
        body: new URLSearchParams({ ...(xsrf ? { _xsrf: xsrf } : {}), password: secret }),
        signal: AbortSignal.timeout(12_000)
      })
      const merged = { ...c1, ...collectCookies(loginPost) }
      const cookieHeader = Object.entries(merged)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')
      const sessionHeaders: JupyterAuthHeaders = {
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        ...(merged._xsrf ? { 'X-XSRFToken': merged._xsrf } : {})
      }
      const retry = await probe(sessionHeaders)
      if (retry.ok) return { ok: true, headers: sessionHeaders, authMode: 'password', ...await discover(retry) }
    }
    if (needsLogin(res)) {
      return { ok: false, message: 'Jupyter authentication failed: invalid or missing token/password.' }
    }
    return { ok: false, message: `Jupyter server returned HTTP ${res.status}.` }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function startJupyterKernel(
  baseUrl: string,
  headers: JupyterAuthHeaders,
  kernelName: string,
  fetchFn: typeof fetch = fetch
): Promise<{ ok: true; kernelId: string; kernelName: string } | { ok: false; message: string }> {
  try {
    const res = await fetchFn(`${baseUrl}/api/kernels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify({ name: kernelName }),
      signal: AbortSignal.timeout(20_000)
    })
    if (!res.ok) return { ok: false, message: `Failed to start kernel (HTTP ${res.status}).` }
    const data = (await res.json()) as { id?: string; name?: string }
    if (!data?.id) return { ok: false, message: 'Jupyter server did not return a kernel id.' }
    return { ok: true, kernelId: data.id, kernelName: data.name || kernelName }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function postJupyterKernelAction(
  baseUrl: string,
  headers: JupyterAuthHeaders,
  kernelId: string,
  action: 'interrupt' | 'restart',
  fetchFn: typeof fetch = fetch
): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetchFn(`${baseUrl}/api/kernels/${encodeURIComponent(kernelId)}/${action}`, {
      method: 'POST',
      headers: { ...headers },
      signal: AbortSignal.timeout(15_000)
    })
    return res.ok ? { ok: true } : { ok: false, message: `HTTP ${res.status}` }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function deleteJupyterKernel(
  baseUrl: string,
  headers: JupyterAuthHeaders,
  kernelId: string,
  fetchFn: typeof fetch = fetch
): Promise<void> {
  await fetchFn(`${baseUrl}/api/kernels/${encodeURIComponent(kernelId)}`, {
    method: 'DELETE',
    headers: { ...headers },
    signal: AbortSignal.timeout(10_000)
  }).catch(() => undefined)
}

export type JupyterSocketLike = {
  send: (data: string) => void
  close: () => void
  once: (event: 'open' | 'error' | 'close', listener: (...args: unknown[]) => void) => void
  on: (event: 'message', listener: (raw: Buffer | string) => void) => void
}

export type JupyterWebSocketFactory = (
  url: string,
  options: { headers: JupyterAuthHeaders; handshakeTimeout: number }
) => JupyterSocketLike

/** Executes code on a Jupyter kernel over WebSocket Messaging Protocol v5.3. */
export function executeJupyterKernelCode(input: {
  baseUrl: string
  kernelId: string
  headers: JupyterAuthHeaders
  code: string
  storeHistory?: boolean
  onOutput: (output: ColabNotebookOutput) => void
  onClear?: () => void
  onSocketReady?: (abort: () => void) => void
  createWebSocket?: JupyterWebSocketFactory
}): Promise<{ ok: boolean; interrupted: boolean; message?: string }> {
  const wsBase = input.baseUrl.replace(/^http/i, 'ws')
  const sessionUuid = randomUUID()
  const msgId = randomUUID()
  const wsUrl = `${wsBase}/api/kernels/${encodeURIComponent(input.kernelId)}/channels?session_id=${encodeURIComponent(sessionUuid)}`

  return new Promise((resolve) => {
    let settled = false
    let interrupted = false
    let sawError = false
    let replyReceived = false
    let replyOk = true
    let idleAfterRequest = false

    const ws: JupyterSocketLike = input.createWebSocket
      ? input.createWebSocket(wsUrl, { headers: input.headers, handshakeTimeout: 15_000 })
      : (new WebSocket(wsUrl, { headers: input.headers, handshakeTimeout: 15_000 }) as unknown as JupyterSocketLike)

    const finish = (res: { ok: boolean; interrupted: boolean; message?: string }): void => {
      if (settled) return
      settled = true
      try {
        ws.close()
      } catch {
        // Ignore close error.
      }
      resolve(res)
    }

    input.onSocketReady?.(() => {
      interrupted = true
      finish({ ok: false, interrupted: true })
    })

    ws.once('open', () => {
      ws.send(
        JSON.stringify({
          header: {
            msg_id: msgId,
            username: 'kun',
            session: sessionUuid,
            date: new Date().toISOString(),
            msg_type: 'execute_request',
            version: '5.3'
          },
          parent_header: {},
          metadata: {},
          content: {
            code: input.code,
            silent: false,
            store_history: input.storeHistory ?? true,
            user_expressions: {},
            allow_stdin: false,
            stop_on_error: true
          },
          buffers: [],
          channel: 'shell'
        })
      )
    })

    ws.on('message', (raw) => {
      let frame: {
        msg_type?: string
        header?: { msg_type?: string }
        parent_header?: { msg_id?: string }
        content?: Record<string, unknown>
      }
      try {
        const text = typeof raw === 'string' ? raw : raw.toString('utf8')
        frame = JSON.parse(text)
      } catch {
        return
      }
      if (frame.parent_header?.msg_id !== msgId) return
      const msgType = frame.msg_type || frame.header?.msg_type || ''
      const content = frame.content ?? {}

      if (msgType === 'stream') {
        const name = content.name === 'stderr' ? 'stderr' : 'stdout'
        const text = String(content.text ?? '')
        if (text) input.onOutput({ type: 'stream', name, text })
      } else if (msgType === 'clear_output') {
        input.onClear?.()
      } else if (msgType === 'display_data' || msgType === 'update_display_data' || msgType === 'execute_result') {
        const data = (content.data && typeof content.data === 'object' ? content.data : {}) as Record<string, unknown>
        const pngRaw = data['image/png']
        const png = Array.isArray(pngRaw) ? pngRaw.join('') : typeof pngRaw === 'string' ? pngRaw : null
        if (png) {
          input.onOutput({ type: 'image', mime: 'image/png', data: png.replace(/\s+/g, '') })
        } else if (typeof data['text/plain'] === 'string') {
          input.onOutput({ type: 'stream', name: 'stdout', text: `${data['text/plain']}\n` })
        }
      } else if (msgType === 'error') {
        sawError = true
        const ename = String(content.ename ?? 'Error')
        const evalue = String(content.evalue ?? '')
        const tbList = Array.isArray(content.traceback) ? content.traceback.map((t) => String(t)) : []
        const traceback = tbList.join('\n').replace(ANSI_ESCAPE_RE, '')
        input.onOutput({ type: 'error', ename, evalue, traceback })
      } else if (msgType === 'execute_reply') {
        replyReceived = true
        replyOk = content.status === 'ok'
        if (idleAfterRequest) finish({ ok: replyOk && !sawError && !interrupted, interrupted })
      } else if (msgType === 'status' && content.execution_state === 'idle') {
        idleAfterRequest = true
        if (replyReceived) finish({ ok: replyOk && !sawError && !interrupted, interrupted })
      }
    })

    ws.once('error', (err) => {
      finish({ ok: false, interrupted, message: err instanceof Error ? err.message : String(err) })
    })
    ws.once('close', () => {
      if (!settled) {
        finish({
          ok: replyReceived && replyOk && !sawError && !interrupted,
          interrupted,
          message: replyReceived || interrupted ? undefined : 'Jupyter kernel WebSocket closed unexpectedly.'
        })
      }
    })
  })
}
