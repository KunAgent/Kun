import { createServer, request as httpRequest } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  BrowserUseNetworkPolicyError,
  BrowserUsePolicyProxy,
  browserUseProxyConfiguration,
  classifyBrowserUseAddress,
  normalizeBrowserUseOrigin,
  resolveBrowserUseNetworkTarget,
  sanitizeBrowserUseUrl
} from './network-policy'

describe('Browser Use origin policy', () => {
  it('normalizes exact origins and strips path/query authority', () => {
    expect(normalizeBrowserUseOrigin('https://Example.com:443/path?q=secret', 'public'))
      .toBe('https://example.com')
    expect(sanitizeBrowserUseUrl('https://example.com/path?q=secret#token'))
      .toBe('https://example.com/path')
  })

  it.each([
    'file:///tmp/secret',
    'javascript:alert(1)',
    'http://localhost:3000',
    'https://metadata.google.internal/latest',
    'https://user:secret@example.com'
  ])('rejects unsafe public origin %s', (url) => {
    expect(() => normalizeBrowserUseOrigin(url, 'public')).toThrow(BrowserUseNetworkPolicyError)
  })

  it('permits only explicit loopback origins in development mode', () => {
    expect(normalizeBrowserUseOrigin('http://127.0.0.1:4173/page', 'local-development'))
      .toBe('http://127.0.0.1:4173')
    expect(() => normalizeBrowserUseOrigin(
      'http://192.168.1.10:4173',
      'local-development'
    )).toThrow('requires localhost')
  })
})

describe('Browser Use address policy', () => {
  it.each([
    ['93.184.216.34', true],
    ['127.0.0.1', false],
    ['10.0.0.1', false],
    ['169.254.169.254', false],
    ['168.63.129.16', false],
    ['::1', false],
    ['fd00::1', false],
    ['::ffff:127.0.0.1', false]
  ])('classifies %s public=%s', (address, expected) => {
    expect(classifyBrowserUseAddress(address).publicUnicast).toBe(expected)
  })

  it('rejects a mixed public/private DNS answer instead of choosing the public one', async () => {
    await expect(resolveBrowserUseNetworkTarget('https://example.com', {
      mode: 'public',
      resolve: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.5', family: 4 }
      ]
    })).rejects.toMatchObject({ code: 'non_public_destination' })
  })

  it('fails closed with dns_timeout when the resolver never settles', async () => {
    const startedAt = Date.now()
    await expect(resolveBrowserUseNetworkTarget('https://github.com', {
      mode: 'public',
      dnsTimeoutMs: 50,
      resolve: () => new Promise(() => undefined)
    })).rejects.toMatchObject({ code: 'dns_timeout' })
    expect(Date.now() - startedAt).toBeLessThan(5_000)
  })

  it('keeps literal IP destinations on the fast path without DNS resolution', async () => {
    const resolve = vi.fn(async () => [{ address: '93.184.216.34', family: 4 as const }])
    await expect(resolveBrowserUseNetworkTarget('https://93.184.216.34/path', {
      mode: 'public',
      resolve
    })).resolves.toMatchObject({ port: 443 })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('pins local development to one exact scheme/host/port origin', async () => {
    await expect(resolveBrowserUseNetworkTarget('http://127.0.0.1:4173/ws', {
      mode: 'local-development',
      exactLocalOrigin: 'http://127.0.0.1:4173'
    })).resolves.toMatchObject({ port: 4173 })
    await expect(resolveBrowserUseNetworkTarget('http://127.0.0.1:4174', {
      mode: 'local-development',
      exactLocalOrigin: 'http://127.0.0.1:4173'
    })).rejects.toMatchObject({ code: 'local_origin_mismatch' })
    await expect(resolveBrowserUseNetworkTarget('https://example.com', {
      mode: 'local-development',
      exactLocalOrigin: 'http://127.0.0.1:4173'
    })).rejects.toMatchObject({ code: 'local_origin_mismatch' })
  })
})

describe('BrowserUsePolicyProxy', () => {
  it('uses fixed proxy rules and removes the implicit loopback bypass', () => {
    expect(browserUseProxyConfiguration('http://127.0.0.1:34567')).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'http=127.0.0.1:34567;https=127.0.0.1:34567;ws=127.0.0.1:34567;wss=127.0.0.1:34567',
      proxyBypassRules: '<-loopback>'
    })
  })

  it('answers CONNECT with 403 dns_timeout and audits the block when DNS never settles', async () => {
    const events: Array<{ outcome: string; sanitizedUrl: string; code?: string }> = []
    const proxy = new BrowserUsePolicyProxy({
      mode: 'public',
      dnsTimeoutMs: 100,
      resolve: () => new Promise(() => undefined),
      onPolicyEvent: (event) => events.push(event)
    })
    const proxyUrl = new URL(await proxy.start())
    try {
      const status = await new Promise<string | undefined>((resolve, reject) => {
        const request = httpRequest({
          host: proxyUrl.hostname,
          port: Number(proxyUrl.port),
          method: 'CONNECT',
          path: 'github.com:443',
          headers: { host: 'github.com:443' }
        })
        request.once('connect', (response, socket: import('node:net').Socket) => {
          socket.destroy()
          resolve(response.statusCode?.toString())
        })
        request.once('response', (response) => {
          response.resume()
          response.once('end', () => resolve(response.statusCode?.toString()))
        })
        request.once('error', reject)
        request.end()
      })
      expect(status).toBe('403')
      expect(events).toContainEqual({
        outcome: 'blocked',
        sanitizedUrl: 'https://github.com/',
        code: 'dns_timeout'
      })
    } finally {
      await proxy.stop()
    }
  })

  it('fails closed when a public request targets loopback', async () => {
    const events: Array<{ outcome: string; sanitizedUrl: string; code?: string }> = []
    const proxy = new BrowserUsePolicyProxy({
      mode: 'public',
      onPolicyEvent: (event) => events.push(event)
    })
    const internals = proxy as unknown as { leave: () => void }
    const originalLeave = internals.leave.bind(proxy)
    const leaveSpy = vi.spyOn(internals, 'leave').mockImplementation(originalLeave)
    const proxyUrl = new URL(await proxy.start())
    try {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest({
          host: proxyUrl.hostname,
          port: Number(proxyUrl.port),
          method: 'GET',
          path: 'http://127.0.0.1:9/private'
        }, (response) => {
          response.resume()
          response.once('end', () => resolve(response.statusCode))
        })
        request.once('error', reject)
        request.end()
      })
      expect(status).toBe(403)
      expect(events).toContainEqual({
        outcome: 'blocked',
        sanitizedUrl: 'http://127.0.0.1:9/private',
        code: 'non_public_destination'
      })
      expect(leaveSpy).toHaveBeenCalledOnce()
    } finally {
      await proxy.stop()
    }
  })

  it('proxies an explicitly granted local WebSocket origin without bypassing policy', async () => {
    const upstream = createServer()
    upstream.on('upgrade', (request, socket) => {
      if (request.headers.upgrade !== 'websocket') {
        socket.destroy()
        return
      }
      socket.end(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Connection: Upgrade\r\n' +
        'Upgrade: websocket\r\n\r\n'
      )
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    const address = upstream.address()
    if (!address || typeof address === 'string') throw new Error('test server did not bind')
    const origin = `http://127.0.0.1:${address.port}`
    const proxy = new BrowserUsePolicyProxy({
      mode: 'local-development',
      exactLocalOrigin: origin
    })
    const proxyUrl = new URL(await proxy.start())
    try {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest({
          host: proxyUrl.hostname,
          port: Number(proxyUrl.port),
          method: 'GET',
          path: `ws://127.0.0.1:${address.port}/socket?secret=redacted`,
          headers: {
            connection: 'Upgrade',
            upgrade: 'websocket',
            'sec-websocket-key': 'dGVzdC1rZXk=',
            'sec-websocket-version': '13'
          }
        })
        request.once('upgrade', (response, socket) => {
          socket.destroy()
          resolve(response.statusCode)
        })
        request.once('response', (response) => {
          response.resume()
          resolve(response.statusCode)
        })
        request.once('error', reject)
        request.end()
      })
      expect(status).toBe(101)
    } finally {
      await proxy.stop()
      await new Promise<void>((resolve) => upstream.close(() => resolve()))
    }
  })

  it('returns a closed error instead of connecting directly when the vetted upstream fails', async () => {
    const reserved = createServer()
    await new Promise<void>((resolve) => reserved.listen(0, '127.0.0.1', resolve))
    const address = reserved.address()
    if (!address || typeof address === 'string') throw new Error('test server did not bind')
    await new Promise<void>((resolve) => reserved.close(() => resolve()))
    const origin = `http://127.0.0.1:${address.port}`
    const proxy = new BrowserUsePolicyProxy({
      mode: 'local-development',
      exactLocalOrigin: origin,
      connectTimeoutMs: 100
    })
    const internals = proxy as unknown as { leave: () => void }
    const originalLeave = internals.leave.bind(proxy)
    const leaveSpy = vi.spyOn(internals, 'leave').mockImplementation(originalLeave)
    const proxyUrl = new URL(await proxy.start())
    try {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest({
          host: proxyUrl.hostname,
          port: Number(proxyUrl.port),
          method: 'GET',
          path: `${origin}/closed`
        }, (response) => {
          response.resume()
          response.once('end', () => resolve(response.statusCode))
        })
        request.once('error', reject)
        request.end()
      })
      expect(status).toBe(502)
      expect(leaveSpy).toHaveBeenCalledOnce()
    } finally {
      await proxy.stop()
    }
  })

  it('releases a completed HTTP response exactly once', async () => {
    const upstream = createServer((_request, response) => response.end('ok'))
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    const address = upstream.address()
    if (!address || typeof address === 'string') throw new Error('test server did not bind')
    const origin = `http://127.0.0.1:${address.port}`
    const proxy = new BrowserUsePolicyProxy({
      mode: 'local-development',
      exactLocalOrigin: origin,
      maxConcurrentConnections: 1
    })
    const internals = proxy as unknown as { leave: () => void }
    const originalLeave = internals.leave.bind(proxy)
    const leaveSpy = vi.spyOn(internals, 'leave').mockImplementation(originalLeave)
    const proxyUrl = new URL(await proxy.start())
    try {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest({
          host: proxyUrl.hostname,
          port: Number(proxyUrl.port),
          method: 'GET',
          path: `${origin}/ok`
        }, (response) => {
          response.resume()
          response.once('end', () => resolve(response.statusCode))
        })
        request.once('error', reject)
        request.end()
      })
      expect(status).toBe(200)
      expect(leaveSpy).toHaveBeenCalledOnce()
    } finally {
      await proxy.stop()
      await new Promise<void>((resolve) => upstream.close(() => resolve()))
    }
  })

  it('releases an aborted downstream HTTP request exactly once', async () => {
    let markUpstreamReceived!: () => void
    const upstreamReceived = new Promise<void>((resolve) => {
      markUpstreamReceived = resolve
    })
    const upstream = createServer(() => markUpstreamReceived())
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    const address = upstream.address()
    if (!address || typeof address === 'string') throw new Error('test server did not bind')
    const origin = `http://127.0.0.1:${address.port}`
    const proxy = new BrowserUsePolicyProxy({
      mode: 'local-development',
      exactLocalOrigin: origin,
      maxConcurrentConnections: 1
    })
    const internals = proxy as unknown as { leave: () => void }
    const originalLeave = internals.leave.bind(proxy)
    const leaveSpy = vi.spyOn(internals, 'leave').mockImplementation(originalLeave)
    const proxyUrl = new URL(await proxy.start())
    try {
      const requestClosed = new Promise<void>((resolve) => {
        const request = httpRequest({
          host: proxyUrl.hostname,
          port: Number(proxyUrl.port),
          method: 'GET',
          path: `${origin}/slow`
        })
        request.once('error', () => resolve())
        request.end()
        void upstreamReceived.then(() => request.destroy())
      })
      await requestClosed
      await vi.waitFor(() => expect(leaveSpy).toHaveBeenCalledOnce())
    } finally {
      await proxy.stop()
      await new Promise<void>((resolve) => upstream.close(() => resolve()))
    }
  })
})
