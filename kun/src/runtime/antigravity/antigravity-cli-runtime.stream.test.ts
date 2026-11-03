import { readFileSync } from 'node:fs'
import type { ChildProcess, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemorySessionStore } from '../../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../../adapters/in-memory-thread-store.js'
import { TurnSchema } from '../../contracts/turns.js'
import { makeUserItem } from '../../domain/item.js'
import { createThreadRecord } from '../../domain/thread.js'
import type { RuntimeEventDraft, RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import type { TurnService } from '../../services/turn-service.js'
import { setHarnessTimingClock } from '../harness-turn-timing.js'
import { AntigravityCliRuntime } from './antigravity-cli-runtime.js'

afterEach(() => setHarnessTimingClock(undefined))

type Capture = Array<[number, string]>
const capture = (name: string): Capture =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), 'utf8')) as Capture

/** A child that prints `agy` events at their recorded times, on a clock the test controls. */
function replaySpawn(lines: Capture, clock: { value: number }, args?: (value: readonly string[]) => void): typeof spawn {
  return ((_command: string, spawnArgs: readonly string[]) => {
    args?.(spawnArgs)
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: () => boolean }
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => true
    void (async () => {
      for (const [at, line] of lines) {
        clock.value = at
        child.stdout.write(`${line}\n`)
        // Let the runner see this line before the next one is "printed".
        await new Promise((resolve) => setImmediate(resolve))
      }
      child.stdout.end()
      child.stderr.end()
      child.emit('exit', 0, null)
    })()
    return child as unknown as ChildProcess
  }) as typeof spawn
}

async function run(spawnFn: typeof spawn, id: string, controller = new AbortController()) {
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const turn = TurnSchema.parse({ id: `turn-${id}`, threadId: `thread-${id}`, status: 'running', prompt: 'hi', model: 'gemini-3.6-flash', createdAt: '2026-10-09T00:00:00.000Z' })
  await threadStore.upsert({
    ...createThreadRecord({ id: turn.threadId, title: 'Antigravity stream', workspace: '/tmp', model: turn.model!, providerId: 'gemini-subscription', status: 'running' }),
    turns: [turn]
  })
  await sessionStore.appendItem(turn.threadId, makeUserItem({ id: `user-${id}`, threadId: turn.threadId, turnId: turn.id, text: 'hi' }))
  const order: string[] = []
  const deltas: Array<{ text: string; delta: string; offset: number }> = []
  const items: Array<{ status: string; text: string }> = []
  const recorded: RuntimeEventDraft[] = []
  let n = 0
  const runtime = new AntigravityCliRuntime({
    providerConfigs: {},
    providerIds: new Set(['gemini-subscription']),
    defaultIsAntigravity: false,
    threadStore,
    sessionStore,
    turns: {
      applyAssistantDelta: vi.fn(async (_thread: string, item: { text: string }, delta: string, offset: number) => {
        // A slow write: the turn must still wait for it before it is finished.
        await new Promise((resolve) => setTimeout(resolve, 5))
        deltas.push({ text: item.text, delta, offset })
        order.push('delta')
      }),
      applyItem: vi.fn(async (_thread: string, item: { kind: string; status: string; text: string }) => {
        if (item.kind === 'assistant_text') items.push({ status: item.status, text: item.text })
      }),
      updateTurnMetadata: vi.fn(async () => undefined),
      finishTurn: vi.fn(async (args: { status: string }) => { order.push(`finish:${args.status}`) })
    } as unknown as TurnService,
    events: {
      record: vi.fn(async (draft: RuntimeEventDraft) => { recorded.push(draft); if (draft.kind === 'usage') order.push('usage') })
    } as unknown as RuntimeEventRecorder,
    ids: { next: (prefix: string) => `${prefix}_${++n}` },
    spawnFn
  })
  const outcome = await runtime.runTurn(turn.threadId, turn.id, controller.signal, 'gemini-subscription')
  const usage = recorded.find((draft) => draft.kind === 'usage')
  return { outcome, deltas, items, order, usage: usage && usage.kind === 'usage' ? usage : undefined }
}

describe('AntigravityCliRuntime stream-json turn', () => {
  it('asks the CLI for stream-json', async () => {
    const clock = { value: 0 }
    let seen: readonly string[] = []
    await run(replaySpawn(capture('agy-stream-tool'), clock, (value) => { seen = value }), 'args')
    expect(seen.slice(0, 4)).toEqual(['--print', expect.any(String), '--output-format', 'stream-json'])
  })

  it('shows the reply as it streams and records its usage with TTFT and tok/s (real capture)', async () => {
    const clock = { value: 0 }
    setHarnessTimingClock(() => clock.value)
    const { outcome, deltas, items, order, usage } = await run(replaySpawn(capture('agy-stream-bicycle'), clock), 'bicycle')

    expect(outcome).toBe('completed')
    // Each streamed piece is persisted in order, at the offset of everything before it.
    expect(deltas.length).toBeGreaterThan(40)
    expect(deltas[0]).toMatchObject({ delta: '自行车的', offset: 0, text: '自行车的' })
    let written = ''
    for (const piece of deltas) {
      expect(piece.offset).toBe(written.length)
      written += piece.delta
      expect(piece.text).toBe(written)
    }
    // The authoritative reply (the CLI's trimmed result) closes the same item.
    expect(items.at(-1)).toEqual({ status: 'completed', text: written.trim() })
    // Usage comes from the CLI result and lands before the turn is finished.
    expect(usage!.usage).toMatchObject({
      promptTokens: 12_010, completionTokens: 2_305, reasoningTokens: 2_070, totalTokens: 14_315
    })
    expect(order.filter((step) => step !== 'delta')).toEqual(['usage', 'finish:completed'])
    expect(order.lastIndexOf('delta')).toBeLessThan(order.indexOf('usage'))
    // TTFT: prompt accepted at 7.38 s, first visible text at 29.0 s (21 s of hidden thinking in between).
    expect(usage!.usage.requestTtftMs).toBeGreaterThan(21_400)
    expect(usage!.usage.requestTtftMs).toBeLessThan(21_800)
    // Speed: the answer is 235 visible tokens (2305 output - 2070 thinking) streamed in ~2.3 s.
    expect(usage!.usage.requestGenerationMs).toBeGreaterThan(2_100)
    expect(usage!.usage.requestGenerationMs).toBeLessThan(2_500)
    expect(usage!.usage.requestGenerationTokens).toBeLessThanOrEqual(235)
    const tokensPerSecond = (usage!.usage.requestGenerationTokens! / usage!.usage.requestGenerationMs!) * 1_000
    expect(tokensPerSecond).toBeGreaterThan(85)
    expect(tokensPerSecond).toBeLessThan(115)
  })

  it('sums a tool-using turn, restarts TTFT after the tool and gives no speed for a one-piece answer', async () => {
    const clock = { value: 0 }
    setHarnessTimingClock(() => clock.value)
    const { outcome, deltas, items, usage } = await run(replaySpawn(capture('agy-stream-tool'), clock), 'tool')

    expect(outcome).toBe('completed')
    expect(deltas).toHaveLength(1)
    expect(items.at(-1)).toEqual({ status: 'completed', text: '该命令的输出为 `kun-probe`。' })
    expect(usage!.usage).toMatchObject({ promptTokens: 24_370, completionTokens: 352, reasoningTokens: 216, totalTokens: 24_722 })
    // The first model step only called the tool; the answer's wait counts from the tool finishing (16.13 s -> 29.98 s).
    expect(usage!.usage.requestTtftMs).toBeGreaterThan(13_700)
    expect(usage!.usage.requestTtftMs).toBeLessThan(14_000)
    expect(usage!.usage.requestGenerationMs).toBeUndefined()
  })

  it('keeps working with a CLI that prints one JSON object: one fragment, usage, no timing', async () => {
    const clock = { value: 0 }
    setHarnessTimingClock(() => clock.value)
    const result = JSON.stringify({
      conversation_id: 'native-json', status: 'SUCCESS', response: 'Hello there',
      usage: { input_tokens: 800, output_tokens: 20, thinking_tokens: 5, cache_read_tokens: 200, total_tokens: 820 }
    })
    const { outcome, deltas, items, usage } = await run(replaySpawn([[0, result]], clock), 'json')

    expect(outcome).toBe('completed')
    expect(deltas).toEqual([{ text: 'Hello there', delta: 'Hello there', offset: 0 }])
    expect(items.at(-1)).toEqual({ status: 'completed', text: 'Hello there' })
    expect(usage!.usage).toMatchObject({ promptTokens: 800, completionTokens: 20, cachedTokens: 200, cacheHitRate: 0.25 })
    expect(usage!.usage.requestTtftMs).toBeUndefined()
  })

  it('waits for the pieces already streamed before it ends an aborted turn', async () => {
    const clock = { value: 0 }
    const controller = new AbortController()
    const lines = capture('agy-stream-bicycle').slice(0, 8)
    const spawnFn = ((_command: string) => {
      const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: () => boolean }
      child.stdout = new PassThrough()
      child.stderr = new PassThrough()
      child.kill = () => { queueMicrotask(() => child.emit('exit', null, 'SIGTERM')); return true }
      void (async () => {
        for (const [at, line] of lines) {
          clock.value = at
          child.stdout.write(`${line}\n`)
          await new Promise((resolve) => setImmediate(resolve))
        }
        controller.abort()
      })()
      return child as unknown as ChildProcess
    }) as typeof spawn
    const { outcome, deltas, order, usage } = await run(spawnFn, 'abort', controller)

    expect(outcome).toBe('aborted')
    expect(usage).toBeUndefined()
    // 6 of the 8 lines are text; every one is persisted before the turn is finished.
    expect(deltas).toHaveLength(6)
    expect(order).toEqual([...Array(6).fill('delta'), 'finish:aborted'])
  })
})
