import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { generate } from 'selfsigned'
import { afterEach, describe, expect, it } from 'vitest'
import { createProxyFetch } from '../src/adapters/model/proxy-fetch.js'
import {
  cachedProxyAgentCountForTests,
  disposeProxyAgents,
  proxyTransportRequest
} from '../src/adapters/model/proxy-transport.js'
import { deferred, listen, startForwardProxy, startFtpServer } from './helpers/proxy/servers.js'

const fixtures = new URL('./helpers/proxy/', import.meta.url)
const closeServers: (() => Promise<void>)[] = []
const execFileAsync = promisify(execFile)

async function requestInChild(options: {
  url: string
  proxyUrl: string
  repeat?: number
  trustedCertificate?: string
}): Promise<{
  responses?: { status: number; body: string }[]
  cachedAgents?: number
  error?: { code?: string; message: string }
}> {
  const { trustedCertificate, ...request } = options
  const { stdout } = await execFileAsync(process.execPath, [
    '--experimental-strip-types',
    fileURLToPath(new URL('request-child.mjs', fixtures)),
    JSON.stringify(request)
  ], {
    // TLS trust is limited to this child and this test-only certificate. Normal
    // certificate verification, including hostname checking, remains enabled.
    env: trustedCertificate
      ? { ...process.env, NODE_EXTRA_CA_CERTS: trustedCertificate }
      : process.env,
    timeout: 10_000,
    killSignal: 'SIGKILL'
  })
  return JSON.parse(stdout)
}

afterEach(async () => {
  disposeProxyAgents()
  await Promise.all(closeServers.splice(0).map((close) => close()))
})

describe('proxy dependency compatibility with real local servers', () => {
  it('forwards HTTP request and response streams and reuses the production agent cache', async () => {
    const finishResponse = deferred()
    let uploaded = ''
    let transferEncoding: string | undefined
    let contentLength: string | undefined
    const origin = await listen(createServer((request, response) => {
      request.on('error', () => {})
      // Test cached agent reuse independently of origin socket persistence.
      response.setHeader('connection', 'close')
      if (request.url !== '/stream') {
        response.end('cached')
        return
      }
      transferEncoding = request.headers['transfer-encoding']
      contentLength = request.headers['content-length']
      request.on('data', (chunk: Buffer) => {
        uploaded += chunk.toString()
      })
      request.on('end', () => {
        response.writeHead(201, { 'content-type': 'text/event-stream' })
        response.write('data: first\n\n')
        void finishResponse.promise.then(() => response.end('data: last\n\n'))
      })
    }))
    closeServers.push(origin.close)
    const proxy = await startForwardProxy()
    closeServers.push(proxy.close)
    const fetch = createProxyFetch(` ${proxy.url} `)!
    const pending = fetch(`http://127.0.0.1:${origin.port}/stream`, {
      method: 'POST',
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('streamed upload'))
          controller.close()
        }
      }),
      duplex: 'half'
    } as RequestInit & { duplex: 'half' })
    const response = await pending
    expect(response.status).toBe(201)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    const reader = response.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe('data: first\n\n')
    expect(first.done).toBe(false)
    finishResponse.resolve()
    const last = await reader.read()
    expect(new TextDecoder().decode(last.value)).toBe('data: last\n\n')
    expect((await reader.read()).done).toBe(true)
    expect(uploaded).toBe('streamed upload')
    expect(transferEncoding).toBe('chunked')
    expect(contentLength).toBeUndefined()

    expect(await (await fetch(`http://127.0.0.1:${origin.port}/again`)).text()).toBe('cached')
    expect(cachedProxyAgentCountForTests()).toBe(1)
    disposeProxyAgents()
    expect(cachedProxyAgentCountForTests()).toBe(0)
    expect(await (await fetch(`http://127.0.0.1:${origin.port}/rebuilt`)).text()).toBe('cached')
    expect(cachedProxyAgentCountForTests()).toBe(1)
    expect(proxy.requests).toEqual(['stream', 'again', 'rebuilt'].map((path) =>
      `http://127.0.0.1:${origin.port}/${path}`))
  })

  it('verifies TLS through an HTTPS CONNECT tunnel and reuses the connection', async () => {
    const requests: string[] = []
    // Generate a fresh key for this run; keep it in memory. Only the public
    // certificate is written to a temporary file for the child's scoped trust.
    const pems = await generate([{ name: 'commonName', value: 'localhost' }], {
      keySize: 2048,
      algorithm: 'sha256',
      notBeforeDate: new Date(Date.now() - 60_000),
      notAfterDate: new Date(Date.now() + 86_400_000),
      extensions: [
        { name: 'basicConstraints', cA: true },
        { name: 'subjectAltName', altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' }
        ] }
      ]
    })
    const certificateDirectory = await mkdtemp(join(tmpdir(), 'kun-proxy-tls-'))
    closeServers.push(() => rm(certificateDirectory, { recursive: true, force: true }))
    const trustedCertificate = join(certificateDirectory, 'localhost-cert.pem')
    await writeFile(trustedCertificate, pems.cert, { mode: 0o600 })
    const origin = await listen(createHttpsServer({
      key: pems.private,
      cert: pems.cert
    }, (request, response) => {
      requests.push(String(request.headers['x-proxy-compatibility']))
      response.end('secure response')
    }))
    closeServers.push(origin.close)
    const proxy = await startForwardProxy()
    closeServers.push(proxy.close)
    const url = `https://127.0.0.1:${origin.port}/secure`

    const untrusted = await requestInChild({ url, proxyUrl: proxy.url })
    expect(untrusted.error?.code).toBe('DEPTH_ZERO_SELF_SIGNED_CERT')
    expect(requests).toEqual([])
    proxy.tunnels.length = 0

    const trusted = await requestInChild({
      url, proxyUrl: proxy.url, repeat: 2, trustedCertificate
    })
    expect(trusted).toEqual({
      responses: [
        { status: 200, body: 'secure response' },
        { status: 200, body: 'secure response' }
      ],
      cachedAgents: 1
    })
    expect(requests).toEqual(['local-test', 'local-test'])
    expect(proxy.tunnels).toEqual([`127.0.0.1:${origin.port}`])
    expect(proxy.requests).toEqual([])
  }, 15_000)

  it('aborts an in-flight streamed upload and closes the forwarded origin request', async () => {
    const firstUpload = deferred()
    const originAborted = deferred()
    const origin = await listen(createServer((request) => {
      request.on('data', () => firstUpload.resolve())
      request.on('aborted', () => originAborted.resolve())
      request.on('error', () => {})
    }))
    closeServers.push(origin.close)
    const proxy = await startForwardProxy()
    closeServers.push(proxy.close)
    const controller = new AbortController()
    const body = new PassThrough()
    const pending = proxyTransportRequest({
      url: new URL(`http://127.0.0.1:${origin.port}/abort`),
      method: 'POST',
      headers: {},
      proxyUrl: proxy.url,
      body: { buffer: null, stream: body },
      signal: controller.signal
    })
    const rejection = expect(pending).rejects.toThrow('The operation was aborted.')
    body.write('partial upload')
    await firstUpload.promise
    controller.abort()
    await rejection
    await originAborted.promise
    expect(body.destroyed).toBe(true)
    expect(proxy.requests).toHaveLength(1)
  })

  it('retrieves and executes a PAC file over FTP before forwarding the request', async () => {
    const origin = await listen(createServer((_request, response) => response.end('PAC routed')))
    closeServers.push(origin.close)
    const proxy = await startForwardProxy()
    closeServers.push(proxy.close)
    const ftp = await startFtpServer({
      pac: `function FindProxyForURL(url, host) { return "PROXY ${new URL(proxy.url).host}"; }`
    })
    closeServers.push(ftp.close)
    const fetch = createProxyFetch(ftp.url)!
    const url = `http://127.0.0.1:${origin.port}/pac`
    expect(await (await fetch(url)).text()).toBe('PAC routed')
    expect(proxy.requests).toEqual([url])
    expect(ftp.commands).toContain('MDTM /proxy.pac')
    expect(ftp.commands).toContain('RETR /proxy.pac')
    expect(ftp.commands).toContain('PASV')
    expect(ftp.dataConnections()).toBe(1)
  })

  it('bounds malicious Unix LIST parsing in the PAC FTP MDTM fallback', async () => {
    // Unbounded owner/group regexes retry quadratically over this malformed
    // line. The final valid Unix entry selects that parser for the whole list.
    const maliciousLine = `-rw-r--r-- 1 ${'a '.repeat(100_000)}!`
    const ftp = await startFtpServer({
      pac: 'function FindProxyForURL() { return "DIRECT"; }',
      listing: `${maliciousLine}\r\n-rw-r--r-- 1 owner group 42 Jan 01 2026 proxy.pac\r\n`
    })
    closeServers.push(ftp.close)
    const result = await requestInChild({ url: 'http://127.0.0.1:1/unused', proxyUrl: ftp.url })

    // Unix LIST has no machine-readable modifiedAt, so get-uri returns
    // ENOTFOUND after parsing. Completing under the external child deadline is
    // the regression assertion; a synchronous regex cannot defeat that timer.
    expect(result.error?.code).toBe('ENOTFOUND')
    expect(ftp.commands).toContain('MDTM /proxy.pac')
    expect(ftp.commands.some((command) => command.startsWith('LIST '))).toBe(true)
    expect(ftp.commands).not.toContain('RETR /proxy.pac')
    expect(ftp.dataConnections()).toBe(1)
  }, 15_000)

  it('keeps cross-host passive FTP data connections rejected by default', async () => {
    const ftp = await startFtpServer({
      pac: 'function FindProxyForURL() { return "DIRECT"; }',
      listing: '-rw-r--r-- 1 owner group 42 Jan 01 2026 proxy.pac\r\n',
      separateDataHost: true
    })
    closeServers.push(ftp.close)
    const result = await requestInChild({ url: 'http://127.0.0.1:1/unused', proxyUrl: ftp.url })
    expect(result.error?.message).toContain('PASV returned another host (192.0.2.1)')
    expect(ftp.commands).toContain('EPSV')
    expect(ftp.commands).toContain('PASV')
    expect(ftp.dataConnections()).toBe(0)
    expect(ftp.commands.some((command) => /^(LIST|RETR)\b/.test(command))).toBe(false)
  }, 15_000)
})
