// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Transport = {
  on: (channel: string) => (handler: (payload: unknown) => void) => () => void
}

class FakeEventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  static instances: FakeEventSource[] = []
  readonly url: string
  readyState = FakeEventSource.CONNECTING
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  private readonly listeners = new Map<string, Array<(event: { data: string }) => void>>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: { data: string }) => void): void {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED
  }

  open(): void {
    this.readyState = FakeEventSource.OPEN
    this.onopen?.()
  }

  fail(readyState: number): void {
    this.readyState = readyState
    this.onerror?.()
  }

  frame(channel: string, payload: unknown = {}): void {
    for (const listener of this.listeners.get('kun-ipc') ?? []) {
      listener({ data: JSON.stringify({ channel, payload }) })
    }
  }
}

const source = readFileSync(
  resolve(__dirname, '../../public/remote-bridge-transport.js'),
  'utf8'
)

function createTransport(): Transport {
  new Function(source)()
  const factory = (window as unknown as { __kunRemoteCreateTransport: () => Transport })
    .__kunRemoteCreateTransport
  return factory()
}

function latest(): FakeEventSource {
  const instance = FakeEventSource.instances.at(-1)
  if (!instance) throw new Error('no EventSource created')
  return instance
}

describe('remote bridge transport', () => {
  let authed: boolean

  beforeEach(() => {
    vi.useFakeTimers()
    FakeEventSource.instances = []
    authed = true
    vi.stubGlobal('EventSource', FakeEventSource)
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ authed }) })))
    window.sessionStorage.clear()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('leaves a CONNECTING stream to the browser retry', () => {
    const transport = createTransport()
    transport.on('runtime:sse-event')(() => undefined)
    latest().fail(FakeEventSource.CONNECTING)
    vi.advanceTimersByTime(60_000)
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('rebuilds a CLOSED stream with backoff and flags it as a resume', () => {
    const transport = createTransport()
    const reconnected = vi.fn()
    transport.on('remote:stream-reconnected')(reconnected)
    const first = latest()
    expect(first.url).not.toContain('resume=1')
    first.open()
    first.fail(FakeEventSource.CLOSED)
    expect(FakeEventSource.instances).toHaveLength(1)
    vi.advanceTimersByTime(1_000)
    expect(FakeEventSource.instances).toHaveLength(2)
    const second = latest()
    expect(second.url).toContain('resume=1')
    second.open()
    expect(reconnected).toHaveBeenCalledTimes(1)
  })

  it('stops rebuilding once the session is gone', async () => {
    const transport = createTransport()
    transport.on('runtime:sse-event')(() => undefined)
    authed = false
    latest().fail(FakeEventSource.CLOSED)
    await vi.advanceTimersByTimeAsync(0)
    vi.advanceTimersByTime(60_000)
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('repairs a dead stream immediately when the page becomes visible', () => {
    const transport = createTransport()
    transport.on('runtime:sse-event')(() => undefined)
    latest().fail(FakeEventSource.CLOSED)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(FakeEventSource.instances).toHaveLength(2)
  })

  it('dispatches the server sender-reset frame to subscribers', () => {
    const transport = createTransport()
    const reset = vi.fn()
    transport.on('remote:sender-reset')(reset)
    latest().open()
    latest().frame('remote:sender-reset')
    expect(reset).toHaveBeenCalledTimes(1)
  })
})
