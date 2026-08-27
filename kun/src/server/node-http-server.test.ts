import { describe, expect, it, vi } from 'vitest'
import { startNodeHttpServer } from './node-http-server.js'
import { jsonResponse } from './response.js'
import { Router } from './router.js'

describe('startNodeHttpServer', () => {
  it('waits for active request handlers before close resolves', async () => {
    const router = new Router()
    let finish!: () => void
    const gate = new Promise<void>((resolve) => { finish = resolve })
    router.add('GET', '/slow', async () => {
      await gate
      return jsonResponse({ done: true })
    })
    const server = await startNodeHttpServer({ router, host: '127.0.0.1', port: 0 })
    const request = fetch(`http://127.0.0.1:${server.port}/slow`).catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 10))
    const close = server.close()
    let closed = false
    void close.then(() => { closed = true })
    await Promise.resolve()
    expect(closed).toBe(false)

    finish()
    await close
    await request
    expect(closed).toBe(true)
  })

  it('logs sanitized context before returning an unexpected internal error', async () => {
    const router = new Router()
    router.add('POST', '/broken', () => {
      const error = new Error('rename metadata.jsonl.compact.tmp failed') as NodeJS.ErrnoException
      error.code = 'EPERM'
      throw error
    })
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const server = await startNodeHttpServer({
      router,
      host: '127.0.0.1',
      port: 0
    })
    try {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/broken?runtimeToken=do-not-log`,
        {
          method: 'POST',
          headers: { authorization: 'Bearer do-not-log' }
        }
      )
      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toEqual({
        code: 'internal_error',
        message: 'Internal server error.'
      })
      expect(log).toHaveBeenCalledWith(
        '[kun-http] unexpected request failure',
        {
          method: 'POST',
          pathname: '/broken',
          error: {
            name: 'Error',
            message: 'rename metadata.jsonl.compact.tmp failed',
            code: 'EPERM'
          }
        }
      )
      expect(JSON.stringify(log.mock.calls)).not.toContain('do-not-log')
    } finally {
      log.mockRestore()
      await server.close()
    }
  })

  it('does not crash when a response stream fails after headers were sent', async () => {
    const router = new Router()
    router.add('GET', '/broken-stream', () => {
      let first = true
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          if (first) {
            first = false
            controller.enqueue(new TextEncoder().encode('partial'))
            return
          }
          controller.error(new Error('stream failed after headers'))
        }
      }), {
        headers: { 'content-type': 'text/plain' }
      })
    })
    router.add('GET', '/health', () => jsonResponse({ status: 'ok' }))
    const server = await startNodeHttpServer({
      router,
      host: '127.0.0.1',
      port: 0
    })
    try {
      await fetch(`http://127.0.0.1:${server.port}/broken-stream`)
        .then((response) => response.text())
        .catch(() => undefined)
      await expect(fetch(`http://127.0.0.1:${server.port}/health`)
        .then((response) => response.json())).resolves.toEqual({ status: 'ok' })
    } finally {
      await server.close()
    }
  })

  it('does not crash when the client aborts a streaming response mid-body', async () => {
    const router = new Router()
    router.add('GET', '/abort-stream', () => {
      let started = false
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!started) {
            started = true
            controller.enqueue(new TextEncoder().encode('partial'))
            return
          }
          // Intentionally never completes: the client abort is what ends this.
        }
      }), {
        headers: { 'content-type': 'text/plain' }
      })
    })
    router.add('GET', '/health', () => jsonResponse({ status: 'ok' }))
    const server = await startNodeHttpServer({
      router,
      host: '127.0.0.1',
      port: 0
    })
    try {
      const controller = new AbortController()
      const response = await fetch(`http://127.0.0.1:${server.port}/abort-stream`, {
        signal: controller.signal
      })
      const reader = response.body?.getReader()
      await reader?.read()
      controller.abort()
      await reader?.cancel().catch(() => undefined)

      await expect(fetch(`http://127.0.0.1:${server.port}/health`)
        .then((response) => response.json())).resolves.toEqual({ status: 'ok' })
    } finally {
      await server.close()
    }
  })
})
