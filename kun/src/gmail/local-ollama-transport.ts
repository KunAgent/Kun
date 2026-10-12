import { request as httpRequest } from 'node:http'
import { createServer } from 'node:net'
import { Readable } from 'node:stream'
import { spawnOwnedProcess, stopOwnedProcess } from '../process/owned-process.js'

/** Binds only loopback; the managed server must subsequently prove ownership of this port. */
export async function reserveLocalOllamaPort(): Promise<number> {
  const server = createServer()
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') { server.close(); reject(new Error('Local model port is unavailable')); return }
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

/** Node's direct HTTP transport never consults global fetch, proxies or redirect handlers. */
export function createDirectLocalOllamaFetch(origin: string, assertCurrent: () => void): typeof fetch {
  const allowed = new URL(origin)
  if (allowed.protocol !== 'http:' || allowed.hostname !== '127.0.0.1' || !allowed.port ||
      allowed.username || allowed.password || allowed.pathname !== '/' || allowed.search || allowed.hash) {
    throw new Error('The local model origin is invalid')
  }
  return async (input, init) => {
    assertCurrent()
    const source = new Request(input, init)
    const url = new URL(source.url)
    if (url.origin !== allowed.origin || url.username || url.password || url.hash || url.search) {
      throw new Error('Local model requests must use the app-owned loopback origin')
    }
    source.signal.throwIfAborted()
    return new Promise<Response>((resolve, reject) => {
      const headers: Record<string, string> = {}
      source.headers.forEach((value, name) => { headers[name] = value })
      // Neither a caller-supplied Host nor an Origin can redirect this private transport.
      delete headers.host
      delete headers.origin
      const request = httpRequest(url, { method: source.method, headers, agent: false }, (response) => {
        const status = response.statusCode ?? 502
        if (status >= 300 && status < 400) {
          response.destroy()
          reject(new Error('The app-owned local model cannot redirect requests'))
          return
        }
        try { assertCurrent() }
        catch (error) { response.destroy(); reject(error); return }
        const responseHeaders = new Headers()
        for (const [name, value] of Object.entries(response.headers)) {
          if (value === undefined) continue
          for (const part of Array.isArray(value) ? value : [value]) responseHeaders.append(name, part)
        }
        const body = source.method === 'HEAD' || status === 204 || status === 304 ? null :
          Readable.toWeb(response) as ReadableStream<Uint8Array>
        resolve(new Response(body, { status, headers: responseHeaders }))
      })
      const abort = () => request.destroy(new Error('Local model request was cancelled'))
      source.signal.addEventListener('abort', abort, { once: true })
      request.on('error', () => reject(new Error('The app-owned local model is unavailable')))
      request.on('close', () => source.signal.removeEventListener('abort', abort))
      request.setTimeout(30 * 60_000, () => request.destroy(new Error('Local model request timed out')))
      try {
        assertCurrent()
        if (source.body) {
          const body = Readable.fromWeb(source.body as Parameters<typeof Readable.fromWeb>[0])
          body.once('error', () => request.destroy(new Error('Local model request body failed')))
          body.pipe(request)
        } else request.end()
      } catch (error) { request.destroy(); reject(error) }
    })
  }
}

/** Only the managed process may listen on the selected exact IPv4 loopback address. */
export async function assertLocalOllamaPortOwner(port: number, pid: number): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(pid) || pid < 2) throw new Error('Invalid local model identity')
  const child = await spawnOwnedProcess('/usr/sbin/lsof',
    ['-nP', '-a', `-iTCP@127.0.0.1:${port}`, '-sTCP:LISTEN', '-FpFn'], {
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'pipe'], ownerLossGraceMs: 1_000
    })
  try {
    const report = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = []
      let bytes = 0
      const timer = setTimeout(() => reject(new Error('Local model ownership verification timed out')), 4_000)
      child.stdout?.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > 32_768) reject(new Error('Local model ownership report exceeded its limit'))
        else chunks.push(chunk)
      })
      child.stderr?.resume()
      child.once('error', () => { clearTimeout(timer); reject(new Error('Local model ownership could not be verified')) })
      child.once('exit', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve(Buffer.concat(chunks).toString('utf8'))
        else reject(new Error('Local model listener is unavailable'))
      })
    })
    const owners = report.split(/\r?\n/u).filter((line) => line.startsWith('p'))
    const endpoints = report.split(/\r?\n/u).filter((line) => line.startsWith('n'))
    if (owners.length !== 1 || owners[0] !== `p${pid}` || endpoints.length !== 1 || endpoints[0] !== `n127.0.0.1:${port}`) {
      throw new Error('The local model listener is not exclusively owned by Kun')
    }
  } finally { await stopOwnedProcess(child, { graceMs: 0, timeoutMs: 3_000 }) }
}
