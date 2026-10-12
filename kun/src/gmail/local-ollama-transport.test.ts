import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import { createDirectLocalOllamaFetch } from './local-ollama-transport.js'

async function listening(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}
async function closing(server: Server): Promise<void> {
  await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections() })
}

describe('direct private model transport', () => {
  it('bypasses global fetch and proxies, strips forged Host, and rejects foreign origins or redirects', async () => {
    let receivedHost = ''
    const server = createServer((request, response) => {
      receivedHost = request.headers.host ?? ''
      if (request.url === '/redirect') { response.writeHead(302, { location: 'https://example.com/' }); response.end(); return }
      response.setHeader('content-type', 'application/json')
      response.end('{"owned":true}')
    })
    const origin = await listening(server)
    const saved = process.env.HTTPS_PROXY
    process.env.HTTPS_PROXY = 'http://127.0.0.1:9'
    const global = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('Global fetch must not run') })
    const assertCurrent = vi.fn()
    try {
      const direct = createDirectLocalOllamaFetch(origin, assertCurrent)
      const response = await direct(`${origin}/v1/chat/completions`, { method: 'POST', headers: { host: 'attacker.invalid' }, body: '{}' })
      expect(await response.json()).toEqual({ owned: true })
      expect(receivedHost).toBe(new URL(origin).host)
      expect(global).not.toHaveBeenCalled()
      await expect(direct(`${origin}/redirect`, { redirect: 'follow' })).rejects.toThrow('cannot redirect')
      await expect(direct(`${origin.replace('127.0.0.1', 'localhost')}/v1/chat/completions`)).rejects.toThrow('loopback origin')
      await expect(direct(`${origin}/v1/chat/completions?destination=cloud`)).rejects.toThrow('loopback origin')
      expect(assertCurrent).toHaveBeenCalled()
    } finally {
      global.mockRestore()
      if (saved === undefined) delete process.env.HTTPS_PROXY
      else process.env.HTTPS_PROXY = saved
      await closing(server)
    }
  })

  it('revalidates server lifetime when response headers arrive', async () => {
    let reply!: () => void
    const server = createServer((_request, response) => { reply = () => response.end('{}') })
    const origin = await listening(server)
    let alive = true
    const direct = createDirectLocalOllamaFetch(origin, () => { if (!alive) throw new Error('Owner exited') })
    try {
      const pending = direct(`${origin}/v1/chat/completions`, { method: 'POST', body: '{}' })
      await vi.waitFor(() => expect(reply).toBeTypeOf('function'))
      alive = false
      reply()
      await expect(pending).rejects.toThrow('Owner exited')
    } finally { await closing(server) }
  })
})
