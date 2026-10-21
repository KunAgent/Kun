import { createServer, request as httpRequest, type Server } from 'node:http'
import { createServer as createNetServer, connect as netConnect, type Server as NetServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BrowserUsePolicyProxy,
  classifyBrowserUseAddress,
  resolveBrowserUseNetworkTarget,
  type BrowserUsePolicyEvent
} from './network-policy'
import { parseBrowserUseUpstreamProxy } from './network-policy-upstream'
import { resolveBrowserUseUpstreamProxy } from './browser-use-upstream-proxy'
import { describeLoadFailure } from './browser-use-manager-support'

const servers: Array<Server | NetServer> = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve) => server.close(() => resolve()))
  ))
})

async function listen(server: Server | NetServer): Promise<number> {
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server did not bind')
  return address.port
}

/** Minimal HTTP forward proxy: records CONNECT authorities and tunnels them to `targetPort`. */
async function fakeForwardProxy(targetPort: number): Promise<{ port: number; connects: string[] }> {
  const connects: string[] = []
  const server = createNetServer((client) => {
    client.once('data', (chunk) => {
      const requestLine = chunk.toString('latin1').split('\r\n')[0] ?? ''
      const connect = /^CONNECT (\S+) HTTP\/1\.1$/u.exec(requestLine)
      if (!connect) {
        client.end('HTTP/1.1 400 Bad Request\r\n\r\n')
        return
      }
      connects.push(connect[1]!)
      const upstream = netConnect({ host: '127.0.0.1', port: targetPort }, () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        upstream.pipe(client)
        client.pipe(upstream)
      })
      upstream.once('error', () => client.destroy())
      client.once('close', () => upstream.destroy())
    })
  })
  return { port: await listen(server), connects }
}

function connectThroughPolicyProxy(
  proxyPort: number,
  authority: string
): Promise<{ status: string; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = netConnect({ host: '127.0.0.1', port: proxyPort })
    let buffered = ''
    socket.once('connect', () => {
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`)
    })
    socket.on('data', (chunk) => {
      buffered += chunk.toString('latin1')
      const status = /^HTTP\/1\.1 (\d{3})/u.exec(buffered)?.[1]
      if (status && status !== '200') {
        socket.destroy()
        resolve({ status, body: '' })
        return
      }
      if (status === '200' && buffered.includes('\r\n\r\n') && !buffered.includes('tunneled')) {
        socket.write('GET / HTTP/1.1\r\nHost: example.test\r\nConnection: close\r\n\r\n')
      }
      if (buffered.includes('tunneled')) {
        socket.destroy()
        resolve({ status: '200', body: buffered })
      }
    })
    socket.once('error', reject)
  })
}

describe('fake-IP tolerant destination vetting', () => {
  it('marks TUN fake-IP answers and accepts them in public mode', async () => {
    expect(classifyBrowserUseAddress('198.18.0.5')).toMatchObject({ fakeIp: true, publicUnicast: false })
    expect(classifyBrowserUseAddress('fc00::1')).toMatchObject({ fakeIp: true })
    expect(classifyBrowserUseAddress('fd00::1')).toMatchObject({ fakeIp: false })
    expect(classifyBrowserUseAddress('10.0.0.1')).toMatchObject({ fakeIp: false })
    const target = await resolveBrowserUseNetworkTarget('https://example.com/', {
      mode: 'public',
      resolve: async () => [{ address: '198.18.0.5', family: 4 }]
    })
    expect(target.addresses).toEqual([{ address: '198.18.0.5', family: 4 }])
  })

  it('still rejects private answers alongside fake-IP ones', async () => {
    await expect(resolveBrowserUseNetworkTarget('https://example.com/', {
      mode: 'public',
      resolve: async () => [
        { address: '198.18.0.5', family: 4 },
        { address: '192.168.1.1', family: 4 }
      ]
    })).rejects.toMatchObject({ code: 'non_public_destination' })
  })
})

describe('upstream proxy selection', () => {
  it('accepts only credential-free http proxies', () => {
    expect(parseBrowserUseUpstreamProxy('http://127.0.0.1:7890')).toEqual({
      hostname: '127.0.0.1', port: 7890, label: '127.0.0.1:7890'
    })
    expect(parseBrowserUseUpstreamProxy('http://[::1]:7890')?.hostname).toBe('::1')
    expect(parseBrowserUseUpstreamProxy('socks5://127.0.0.1:7891')).toBeUndefined()
    expect(parseBrowserUseUpstreamProxy('http://user:pw@127.0.0.1:7890')).toBeUndefined()
    expect(parseBrowserUseUpstreamProxy('')).toBeUndefined()
  })

  it('picks the first HTTP proxy rule and treats DIRECT or lookup failure as direct', async () => {
    expect(await resolveBrowserUseUpstreamProxy('https://a.test/', async () => 'DIRECT')).toBe('')
    expect(await resolveBrowserUseUpstreamProxy(
      'https://a.test/', async () => 'SOCKS5 127.0.0.1:7891; PROXY 127.0.0.1:7890; DIRECT'
    )).toBe('http://127.0.0.1:7890/')
    expect(await resolveBrowserUseUpstreamProxy('https://a.test/', async () => 'SOCKS 127.0.0.1:7891')).toBe('')
    expect(await resolveBrowserUseUpstreamProxy('https://a.test/', async () => { throw new Error('x') })).toBe('')
  })
})

describe('BrowserUsePolicyProxy with a system proxy', () => {
  it('tunnels CONNECT through the system proxy by hostname after vetting', async () => {
    const origin = createServer((_request, response) => response.end('tunneled'))
    const originPort = await listen(origin)
    const forward = await fakeForwardProxy(originPort)
    const events: BrowserUsePolicyEvent[] = []
    const proxy = new BrowserUsePolicyProxy({
      mode: 'public',
      resolve: async () => [{ address: '93.184.216.34', family: 4 }],
      resolveUpstreamProxy: async () => `http://127.0.0.1:${forward.port}`,
      onPolicyEvent: (event) => events.push(event)
    })
    const proxyPort = Number(new URL(await proxy.start()).port)
    try {
      const result = await connectThroughPolicyProxy(proxyPort, `example.test:${originPort}`)
      expect(result.status).toBe('200')
      expect(result.body).toContain('tunneled')
      expect(forward.connects).toEqual([`example.test:${originPort}`])
      expect(events).toContainEqual(expect.objectContaining({ outcome: 'allowed' }))
    } finally {
      await proxy.stop()
    }
  })

  it('forwards plain HTTP requests to the system proxy as absolute URLs', async () => {
    const seen: string[] = []
    const forward = createServer((request, response) => {
      seen.push(request.url ?? '')
      response.end('via-proxy')
    })
    const forwardPort = await listen(forward)
    const proxy = new BrowserUsePolicyProxy({
      mode: 'public',
      resolve: async () => [{ address: '93.184.216.34', family: 4 }],
      resolveUpstreamProxy: async () => `http://127.0.0.1:${forwardPort}`
    })
    const proxyUrl = new URL(await proxy.start())
    try {
      const body = await new Promise<string>((resolve, reject) => {
        const request = httpRequest({
          host: proxyUrl.hostname,
          port: Number(proxyUrl.port),
          method: 'GET',
          path: 'http://example.test/page?q=1'
        }, (response) => {
          let text = ''
          response.on('data', (chunk) => { text += String(chunk) })
          response.once('end', () => resolve(text))
        })
        request.once('error', reject)
        request.end()
      })
      expect(body).toBe('via-proxy')
      expect(seen).toEqual(['http://example.test/page?q=1'])
    } finally {
      await proxy.stop()
    }
  })

  it('answers 502 and reports the unreachable system proxy instead of a policy block', async () => {
    const reserved = createServer()
    const deadPort = await listen(reserved)
    await new Promise<void>((resolve) => reserved.close(() => resolve()))
    servers.splice(servers.indexOf(reserved), 1)
    const events: BrowserUsePolicyEvent[] = []
    const proxy = new BrowserUsePolicyProxy({
      mode: 'public',
      connectTimeoutMs: 500,
      resolve: async () => [{ address: '93.184.216.34', family: 4 }],
      resolveUpstreamProxy: async () => `http://127.0.0.1:${deadPort}`,
      onPolicyEvent: (event) => events.push(event)
    })
    const proxyPort = Number(new URL(await proxy.start()).port)
    try {
      const result = await connectThroughPolicyProxy(proxyPort, 'example.test:443')
      expect(result.status).toBe('502')
      expect(events).toContainEqual(expect.objectContaining({
        outcome: 'failed',
        code: 'upstream_proxy_unreachable',
        message: expect.stringContaining(`System proxy 127.0.0.1:${deadPort}`)
      }))
      expect(events.some((event) => event.outcome === 'blocked')).toBe(false)
    } finally {
      await proxy.stop()
    }
  })

  it('never routes local-development traffic through the system proxy', async () => {
    const origin = createServer((_request, response) => response.end('tunneled'))
    const originPort = await listen(origin)
    let asked = false
    const proxy = new BrowserUsePolicyProxy({
      mode: 'local-development',
      exactLocalOrigin: `https://127.0.0.1:${originPort}`,
      resolveUpstreamProxy: async () => { asked = true; return 'http://127.0.0.1:1' }
    })
    const proxyPort = Number(new URL(await proxy.start()).port)
    try {
      const result = await connectThroughPolicyProxy(proxyPort, `127.0.0.1:${originPort}`)
      expect(result.status).toBe('200')
      expect(asked).toBe(false)
    } finally {
      await proxy.stop()
    }
  })
})

describe('describeLoadFailure', () => {
  it('appends the policy verdict for the failing origin only', () => {
    const failure = {
      outcome: 'blocked' as const,
      sanitizedUrl: 'https://example.com/',
      code: 'non_public_destination',
      message: 'Destination resolved to a blocked private address.',
      at: 1
    }
    expect(describeLoadFailure('ERR_TUNNEL_CONNECTION_FAILED', 'https://example.com', failure)).toBe(
      'ERR_TUNNEL_CONNECTION_FAILED - Destination resolved to a blocked private address. [non_public_destination]'
    )
    expect(describeLoadFailure('ERR_TUNNEL_CONNECTION_FAILED', 'https://other.com', failure)).toBe(
      'ERR_TUNNEL_CONNECTION_FAILED'
    )
    expect(describeLoadFailure('', 'https://other.com', undefined)).toBe('The authorized page failed to load.')
  })
})
