import { createRequire } from 'node:module'
import { Writable } from 'node:stream'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
// Resolve from Solid itself so a second, unrelated Seroval installation cannot
// make this regression pass while Solid still uses the vulnerable dependency.
const requireSolid = createRequire(require.resolve('solid-js/package.json'))
const { toJSON, fromJSON } = requireSolid('seroval') as typeof import('seroval')
const { renderToStringAsync, renderToStream } = requireSolid('solid-js/web') as typeof import('solid-js/web/types/server.js')
const { sharedConfig } = requireSolid('solid-js') as {
  sharedConfig: { context?: { serialize(id: string, value: unknown): void } }
}

function fixture() {
  return {
    date: new Date('2026-01-01T00:00:00Z'),
    map: new Map([['key', 42]]),
    bytes: new Uint8Array([1, 2, 3]),
    url: new URL('https://example.com/path?q=1'),
    headers: new Headers([['x-test', 'ok']]),
    params: new URLSearchParams('x=1&x=2'),
    response: new Response('body', { status: 201 }),
    stream: new ReadableStream<string>({
      start(controller) {
        controller.enqueue('chunk')
        controller.close()
      }
    })
  }
}

function renderFixture() {
  // Delay resolution until after the shell to exercise streamed Promise data.
  sharedConfig.context!.serialize('fixture', new Promise((resolve) => {
    setTimeout(() => resolve(fixture()), 0)
  }))
  return 'serialization fixture'
}

function renderPipedFixture(): Promise<string> {
  return new Promise((resolve, reject) => {
    let html = ''
    const output = new Writable({
      write(chunk, _encoding, done) {
        html += chunk.toString()
        done()
      },
      final(done) {
        resolve(html)
        done()
      }
    })
    output.on('error', reject)
    renderToStream(renderFixture, { onError: reject }).pipe(output)
  })
}

async function restoreFixture(html: string): Promise<ReturnType<typeof fixture>> {
  const context = createContext({
    _$HY: { r: {} },
    URL, Headers, URLSearchParams, Response, Request, ReadableStream,
    AbortController, DOMException, Event, FormData, Blob, atob,
    Uint8Array, ArrayBuffer
  })
  context.self = context
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gu)]
  expect(scripts.length).toBeGreaterThan(0)
  // Only evaluate scripts generated from this test's trusted local fixture.
  for (const [, script] of scripts) runInContext(script!, context, { timeout: 1_000 })
  return context._$HY.r.fixture
}

describe('Solid serializer security override', () => {
  it.each([
    ['renderToStringAsync', () => renderToStringAsync(renderFixture)],
    ['renderToStream', renderPipedFixture]
  ] as const)('preserves complex data and existing web plugins with %s', async (_name, render) => {
    const previousContext = sharedConfig.context
    try {
      const restored = await restoreFixture(await render())
      expect(restored.date.toISOString()).toBe('2026-01-01T00:00:00.000Z')
      expect(restored.map.get('key')).toBe(42)
      expect([...restored.bytes]).toEqual([1, 2, 3])
      expect(restored.url.href).toBe('https://example.com/path?q=1')
      expect(restored.headers.get('x-test')).toBe('ok')
      expect(restored.params.getAll('x')).toEqual(['1', '2'])
      expect(restored.response.status).toBe(201)
      expect(await restored.response.text()).toBe('body')
      const reader = restored.stream.getReader()
      expect(await reader.read()).toEqual({ value: 'chunk', done: false })
      expect(await reader.read()).toEqual({ value: undefined, done: true })
    } finally {
      sharedConfig.context = previousContext
    }
  })

  it('rejects array-like objects as TypedArray backing buffers', () => {
    const payload = toJSON(new Uint8Array([1, 2, 3]))
    expect(fromJSON(payload)).toEqual(new Uint8Array([1, 2, 3]))
    const invalidBuffer = toJSON({ length: 8 }).t
    // Keep the root and backing-source node IDs distinct. Eight elements are
    // enough to reproduce the invalid constructor path without exhausting RAM.
    invalidBuffer.i = 1
    payload.t.f = invalidBuffer
    payload.t.l = 8
    expect(() => fromJSON(payload)).toThrow()
  })
})
