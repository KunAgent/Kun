import { describe, expect, it } from 'vitest'
import { startNodeHttpServer } from '../src/server/node-http-server.js'
import { readJsonBody } from '../src/server/read-json-body.js'
import { Router } from '../src/server/router.js'
import { FaultInjectionController, faultInjectionSpecForTests } from '../src/services/fault-injection-controller.js'

describe('Node HTTP server', () => {
  it('hides internal exception details in 500 responses', async () => {
    const router = new Router()
    router.add('GET', '/boom', () => {
      throw new Error('leaked stack detail: /tmp/private-token')
    })
    const server = await startNodeHttpServer({
      router,
      host: '127.0.0.1',
      port: 0
    })

    try {
      const response = await fetch(`http://${server.host}:${server.port}/boom`)
      const body = await response.json() as { code?: string; message?: string }

      expect(response.status).toBe(500)
      expect(body).toEqual({
        code: 'internal_error',
        message: 'Internal server error.'
      })
      expect(JSON.stringify(body)).not.toContain('private-token')
    } finally {
      await server.close()
    }
  })

  it('returns a 413 response after rejecting an oversized declared request body', async () => {
    const router = new Router()
    router.add('POST', '/body', async (request) => {
      const body = await readJsonBody(request, 32)
      return body.ok ? new Response('{}') : body.response
    })
    const server = await startNodeHttpServer({ router, host: '127.0.0.1', port: 0 })

    try {
      const response = await fetch(`http://${server.host}:${server.port}/body`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'x'.repeat(128) })
      })

      expect(response.status).toBe(413)
      await expect(response.json()).resolves.toMatchObject({ code: 'validation_error' })
    } finally {
      await server.close()
    }
  })

  it('aborts the Fetch request when an SSE client disconnects', async () => {
    const router = new Router()
    let resolveAbort: (() => void) | undefined
    const aborted = new Promise<void>((resolve) => {
      resolveAbort = resolve
    })
    router.add('GET', '/events', (request) => {
      request.signal.addEventListener('abort', () => resolveAbort?.(), { once: true })
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: connected\n\n'))
        }
      }), { headers: { 'content-type': 'text/event-stream' } })
    })
    const server = await startNodeHttpServer({ router, host: '127.0.0.1', port: 0 })
    const controller = new AbortController()

    try {
      const response = await fetch(`http://${server.host}:${server.port}/events`, { signal: controller.signal })
      await response.body!.getReader().read()
      controller.abort()
      await aborted
    } finally {
      await server.close()
    }
  })

  it('force-closes a live SSE connection during shutdown', async () => {
    const router = new Router()
    router.add('GET', '/events', () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: connected\n\n'))
      }
    }), { headers: { 'content-type': 'text/event-stream' } }))
    const server = await startNodeHttpServer({ router, host: '127.0.0.1', port: 0 })

    const response = await fetch(`http://${server.host}:${server.port}/events`)
    await response.body!.getReader().read()

    await expect(Promise.race([
      server.close(),
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('server close timed out')), 1_000))
    ])).resolves.toBeUndefined()
  })

  it.each([
    ['http-429', 429],
    ['http-timeout', 504]
  ] as const)('injects %s at the HTTP boundary', async (kind, status) => {
    const router = new Router()
    router.add('GET', '/ok', () => new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' }
    }))
    const faultInjection = new FaultInjectionController()
    faultInjection.configure(faultInjectionSpecForTests(kind))
    const server = await startNodeHttpServer({ router, host: '127.0.0.1', port: 0, faultInjection })
    try {
      const response = await fetch(`http://${server.host}:${server.port}/ok`)
      expect(response.status).toBe(status)
      expect(await response.json()).toMatchObject({ code: 'fault_injected', kind })
    } finally {
      await server.close()
    }
  })

  it('can return malformed JSON for parser recovery tests', async () => {
    const router = new Router()
    router.add('GET', '/ok', () => new Response('{"ok":true}'))
    const faultInjection = new FaultInjectionController()
    faultInjection.configure(faultInjectionSpecForTests('invalid-json'))
    const server = await startNodeHttpServer({ router, host: '127.0.0.1', port: 0, faultInjection })
    try {
      const response = await fetch(`http://${server.host}:${server.port}/ok`)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('{"fault_injected":')
    } finally {
      await server.close()
    }
  })

  it('disconnects an SSE response after the first chunk when configured', async () => {
    const router = new Router()
    router.add('GET', '/events', () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: first\\n\\n'))
        controller.enqueue(new TextEncoder().encode('data: second\\n\\n'))
      }
    }), { headers: { 'content-type': 'text/event-stream' } }))
    const faultInjection = new FaultInjectionController()
    faultInjection.configure(faultInjectionSpecForTests('sse-disconnect'))
    const server = await startNodeHttpServer({ router, host: '127.0.0.1', port: 0, faultInjection })

    try {
      let disconnected = false
      try {
        const response = await fetch(`http://${server.host}:${server.port}/events`)
        const reader = response.body!.getReader()
        await expect(reader.read()).resolves.toMatchObject({ done: false })
        await reader.read()
      } catch {
        disconnected = true
      }
      expect(disconnected).toBe(true)
    } finally {
      await server.close()
    }
  })
})
