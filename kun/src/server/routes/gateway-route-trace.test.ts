import { describe, expect, it } from 'vitest'
import type { ModelStreamChunk } from '../../ports/model-client.js'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GatewayRouteTraceStore, traceGatewayStream } from './gateway-route-trace.js'
import { GatewayRouteTraceFile } from './gateway-route-trace-file.js'

async function run(store: GatewayRouteTraceStore, session: string | undefined, chunks: ModelStreamChunk[], requestId = 'r1') {
  const writer = store.begin(session, { requestId, asked: 'coding', agent: 'codex', client: 'Agent · Codex' })
  async function* source() { yield* chunks }
  for await (const _ of traceGatewayStream(source(), writer)) { /* drain */ }
}

const route = (providerId: string, decision: 'rule' | 'failover', extra = {}) =>
  ({ routePoolId: 'p', targetId: providerId, providerId, modelId: 'm', requestedModelId: 'coding', decision, ...extra })

describe('gateway route traces', () => {
  it('records why the member was chosen, fallbacks and duration', async () => {
    let now = 1_000
    const store = new GatewayRouteTraceStore(() => now)
    await run(store, 'sess', [
      { kind: 'route_switching', from: { providerId: 'a', modelId: 'm' }, to: { providerId: 'b', modelId: 'm' }, reason: 'rate_limit' } as ModelStreamChunk,
      { kind: 'assistant_text_delta', text: 'hi', route: route('b', 'failover') },
      { kind: 'completed', stopReason: 'stop' }
    ])
    now = 1_500
    const trace = store.latest('sess')!
    expect(trace).toMatchObject({ agent: 'codex', client: 'Agent · Codex', served: 'b/m', status: 'completed', decision: 'failover' })
    expect(trace.tries).toEqual([{ providerId: 'a', modelId: 'm', fail: 'rate_limit' }, { providerId: 'b', modelId: 'm', decision: 'failover' }])
    expect(trace.durationMs).toBe(0)
  })
  it('keeps requests without a session in the recent list only, capped at 100', async () => {
    const store = new GatewayRouteTraceStore()
    await run(store, undefined, [{ kind: 'assistant_text_delta', text: 'x', route: route('a', 'rule', { ruleId: 'tests', intent: 'tests' }) },
      { kind: 'completed', stopReason: 'stop' }])
    const { traces, seq } = store.recent()
    expect(traces).toHaveLength(1)
    expect(traces[0]).toMatchObject({ decision: 'rule', rule: 'tests', intent: 'tests', done: true })
    expect(store.recent(seq).traces).toEqual([])
    for (let index = 0; index < 120; index += 1) store.begin(undefined, { requestId: `r${index}`, asked: 'coding' })
    expect(store.recent().traces).toHaveLength(100)
    expect(store.recent().traces[0]!.requestId).toBe('r20')
  })
  it('wakes recent-list long polls on any change', async () => {
    const store = new GatewayRouteTraceStore()
    const { seq } = store.recent()
    const waiting = store.waitRecent(seq, 5_000)
    store.begin(undefined, { requestId: 'late', asked: 'coding' })
    expect((await waiting).traces.map((trace) => trace.requestId)).toEqual(['late'])
    const aborted = new AbortController()
    const parked = store.waitRecent(store.recent().seq, 5_000, aborted.signal)
    aborted.abort()
    expect((await parked).traces).toEqual([])
  })
  it('keeps finished requests across a restart, with cursors that keep increasing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kun-route-traces-'))
    try {
      const path = join(dir, 'traces.json')
      const first = new GatewayRouteTraceStore(Date.now, new GatewayRouteTraceFile(path, 100))
      await run(first, undefined, [{ kind: 'assistant_text_delta', text: 'a', route: route('a', 'rule') }, { kind: 'completed', stopReason: 'stop' }], 'done-1')
      first.begin(undefined, { requestId: 'still-running', asked: 'coding' })
      // Saves are debounced; force the pending one through the store's own file.
      await (first as unknown as { file: GatewayRouteTraceFile }).file.flush()
      const file = new GatewayRouteTraceFile(path, 100)
      expect(JSON.parse(readFileSync(path, 'utf8')).traces.map((trace: { requestId: string }) => trace.requestId)).toEqual(['done-1'])
      if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
      const restarted = new GatewayRouteTraceStore(Date.now, file)
      const before = restarted.recent(0)
      expect(before.traces.map((trace) => trace.requestId)).toEqual(['done-1'])
      await run(restarted, undefined, [{ kind: 'completed', stopReason: 'stop' }], 'after-restart')
      const after = restarted.recent(before.seq)
      expect(after.traces.map((trace) => trace.requestId)).toEqual(['after-restart'])
      expect(after.seq).toBeGreaterThan(before.seq)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('ignores a damaged trace file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kun-route-traces-'))
    try {
      const path = join(dir, 'traces.json')
      writeFileSync(path, '{not json')
      expect(new GatewayRouteTraceStore(Date.now, new GatewayRouteTraceFile(path, 100)).recent(0)).toEqual({ seq: 0, traces: [] })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
