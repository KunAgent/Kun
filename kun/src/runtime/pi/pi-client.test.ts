import { describe, expect, it } from 'vitest'
import type { JsonlTransport } from '../../session/jsonl-transport.js'
import type { HarnessProcess } from '../../session/harness-process.js'
import { PiClient } from './pi-client.js'
import { escapePiSlashCommand } from './pi-protocol.js'

// ---- fakes ---------------------------------------------------------------------

function fakeTransport() {
  const frames: ((value: unknown, raw: string) => void)[] = []
  const closes: (() => void)[] = []
  const writes: unknown[] = []
  const transport = {
    closed: false,
    onFrame: (h: (value: unknown, raw: string) => void) => {
      frames.push(h)
      return () => undefined
    },
    onClose: (h: () => void) => {
      closes.push(h)
      return () => undefined
    },
    write: (value: unknown) => {
      writes.push(value)
      return Promise.resolve()
    }
  } as unknown as JsonlTransport
  return {
    transport,
    writes,
    emit: (value: unknown) =>
      frames.forEach((h) => h(value, JSON.stringify(value))),
    close: () => closes.forEach((h) => h())
  }
}

function fakeProcess(
  exit?: Promise<{ code: number | null; signal: string | null }>
): HarnessProcess {
  return {
    stdin: undefined,
    stdout: undefined,
    exit: exit ?? new Promise(() => undefined),
    stderrTail: () => '',
    sanitizedStderrTail: () => '',
    stop: () => Promise.resolve()
  } as unknown as HarnessProcess
}

function setup(exit?: Promise<{ code: number | null; signal: string | null }>) {
  const { transport, writes, emit, close } = fakeTransport()
  const proc = fakeProcess(exit)
  const client = new PiClient(proc, { transport })
  return { client, proc, writes, emit, close }
}

function respond(
  writes: unknown[],
  emit: (v: unknown) => void,
  data?: Record<string, unknown>
): void {
  const req = writes.at(-1) as { id: string; type: string }
  emit({ id: req.id, type: 'response', command: req.type, success: true, data })
}

describe('PiClient', () => {
  it('sends commands with string ids and correlates responses', async () => {
    const { client, writes, emit } = setup()
    const promise = client.getState()
    const req = writes.at(-1) as { id: string; type: string }
    expect(typeof req.id).toBe('string')
    expect(req.type).toBe('get_state')
    respond(writes, emit, { sessionId: 's1', isStreaming: false })
    await expect(promise).resolves.toMatchObject({ sessionId: 's1' })
  })

  it('rejects on success:false with the pi error message', async () => {
    const { client, writes, emit } = setup()
    const promise = client.prompt('hi')
    const req = writes.at(-1) as { id: string; type: string }
    emit({
      id: req.id,
      type: 'response',
      command: 'prompt',
      success: false,
      error: 'No API key configured'
    })
    await expect(promise).rejects.toMatchObject({
      name: 'HarnessTransportError',
      code: 'agent_error',
      message: 'No API key configured'
    })
  })

  it('rejects a mismatched command echo (protocol drift guard)', async () => {
    const { client, writes, emit } = setup()
    const promise = client.abort()
    const req = writes.at(-1) as { id: string }
    emit({
      id: req.id,
      type: 'response',
      command: 'compact',
      success: true
    })
    await expect(promise).rejects.toMatchObject({
      code: 'harness_protocol_error'
    })
  })

  it('fans session events out to per-type subscribers', async () => {
    const { client, emit } = setup()
    const seen: string[] = []
    client.onEvent('agent_settled', () => seen.push('settled'))
    client.onEvent('turn_start', () => seen.push('turn'))
    emit({ type: 'agent_start' })
    emit({ type: 'turn_start' })
    emit({ type: 'agent_settled' })
    expect(seen).toEqual(['turn', 'settled'])
  })

  it('does not treat extension_ui_request as a command response', async () => {
    const { client, writes, emit } = setup()
    const events: unknown[] = []
    client.onEvent('extension_ui_request', (e) => events.push(e))
    const pending = client.getState()
    emit({ type: 'extension_ui_request', id: 'ui-1', method: 'confirm', title: 'x' })
    expect(events).toHaveLength(1)
    respond(writes, emit, {})
    await expect(pending).resolves.toBeDefined()
  })

  it('sends extension_ui_response without registering a pending request', async () => {
    const { client, writes } = setup()
    await client.answerExtensionUi('ui-1', { value: 'allow' })
    expect(writes.at(-1)).toEqual({
      type: 'extension_ui_response',
      id: 'ui-1',
      value: 'allow'
    })
    // Not pending: a second write shows only this record exists.
    expect(writes).toHaveLength(1)
  })

  it('fails all pending requests when the transport closes', async () => {
    const { client, close } = setup()
    const promise = client.getState()
    close()
    await expect(promise).rejects.toMatchObject({ code: 'connection_closed' })
  })

  it('switch_session reports extension veto as cancelled=true', async () => {
    const { client, writes, emit } = setup()
    const promise = client.switchSession('/s/old.jsonl')
    respond(writes, emit, { cancelled: true })
    await expect(promise).resolves.toBe(true)
  })

  it('prompt maps disposition values', async () => {
    const { client, writes, emit } = setup()
    const p1 = client.prompt('a')
    respond(writes, emit, { disposition: 'handled' })
    await expect(p1).resolves.toBe('handled')
    const p2 = client.prompt('b')
    respond(writes, emit, { disposition: 'started' })
    await expect(p2).resolves.toBe('started')
  })
})

describe('escapePiSlashCommand', () => {
  it('escapes leading slashes, leaves normal text alone', () => {
    expect(escapePiSlashCommand('/compact now')).toBe(' /compact now')
    expect(escapePiSlashCommand('  /x')).toBe('   /x')
    expect(escapePiSlashCommand('hello')).toBe('hello')
  })
})
