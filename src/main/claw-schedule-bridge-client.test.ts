import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { postJson, WorkflowBridgeError } from './claw-schedule-bridge-client'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

async function closedPort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

function listeningServer(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as AddressInfo).port })
    })
    cleanups.push(
      () =>
        new Promise<void>((done) => {
          server.closeAllConnections()
          server.close(() => done())
        })
    )
  })
}

describe('postJson failure classification', () => {
  it('reports the unreachable port and the underlying errno instead of "fetch failed"', async () => {
    const port = await closedPort()

    const failure = await postJson(
      { baseUrl: `http://127.0.0.1:${port}`, secret: '' },
      '/workflow/internal/list',
      {},
      { timeoutMs: 2_000 }
    ).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(WorkflowBridgeError)
    expect((failure as WorkflowBridgeError).code).toBe('connect')
    expect((failure as Error).message).toContain(`http://127.0.0.1:${port}/workflow/internal/list`)
    expect((failure as Error).message).toMatch(/ECONNREFUSED|ECONNRESET/)
  })

  it('reports the HTTP status without leaking the endpoint secret', async () => {
    const { port } = await listeningServer((_request, response) => {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: false, message: 'Unauthorized.' }))
    })

    const failure = await postJson(
      { baseUrl: `http://127.0.0.1:${port}`, secret: 'top-secret' },
      '/workflow/internal/list',
      {}
    ).catch((error: unknown) => error)

    expect((failure as WorkflowBridgeError).code).toBe('http')
    expect((failure as WorkflowBridgeError).status).toBe(401)
    expect((failure as Error).message).toContain('HTTP 401')
    expect((failure as Error).message).toContain('Unauthorized.')
    expect((failure as Error).message).not.toContain('top-secret')
  })

  it('distinguishes a timeout from a connection failure', async () => {
    const { port } = await listeningServer(() => {
      /* accept the request and never answer */
    })

    const failure = await postJson(
      { baseUrl: `http://127.0.0.1:${port}`, secret: '' },
      '/workflow/internal/run',
      {},
      { timeoutMs: 50 }
    ).catch((error: unknown) => error)

    expect((failure as WorkflowBridgeError).code).toBe('timeout')
    expect((failure as Error).message).toContain('received no response within 50ms')
  })

  it('reports caller cancellation instead of a bridge failure', async () => {
    const { port } = await listeningServer(() => {
      /* accept the request and never answer */
    })
    const controller = new AbortController()
    controller.abort()

    const failure = await postJson(
      { baseUrl: `http://127.0.0.1:${port}`, secret: '' },
      '/workflow/internal/list',
      {},
      { timeoutMs: 5_000, signal: controller.signal }
    ).catch((error: unknown) => error)

    expect((failure as WorkflowBridgeError).code).toBe('cancelled')
  })
})
