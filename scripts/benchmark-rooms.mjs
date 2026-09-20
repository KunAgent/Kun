import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { SqliteRoomStore } from '../kun/dist/rooms/room-store-sqlite.js'
import { roomActivitySummary } from '../kun/dist/rooms/room-activity-summary.js'

const arg = (key, fallback) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1] : fallback
const durationMs = Number(arg('--duration-ms', 30 * 60 * 1000))
if (!Number.isFinite(durationMs) || durationMs < 1000) throw new Error('duration must be at least 1000 milliseconds')
const evidence = resolve(arg('--evidence', 'dist/rooms-hardening-benchmark'))
const root = await mkdtemp(join(tmpdir(), 'kun-rooms-benchmark-'))
const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
const timings = [], rss = [], sizes = []
let reads = 0, writes = 0, consumed = 0, emitted = 0, maxBacklog = 0, cursor = 0, iteration = 0
const setupStarted = performance.now()
async function commit(puts, events = []) {
  await store.commit({ requestId: 'batch-' + writes++, checks: puts.map((put) => ({
    kind: put.kind, id: put.id, expectedRevision: null })), puts, events })
}
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? 0
try {
  await mkdir(evidence, { recursive: true })
  await commit(Array.from({ length: 100 }, (_, i) => ({ kind: 'room', id: 'room_' + i, roomId: 'room_' + i,
    value: { id: 'room_' + i, name: 'Benchmark room ' + i, schemaVersion: 1, members: [], repositories: [], revision: 0 } })))
  for (let start = 0; start < 100000; start += 500) await commit(Array.from({ length: 500 }, (_, j) => ({
    kind: 'message', id: 'message_' + (start + j), roomId: 'room_' + ((start + j) % 100),
    value: { id: 'message_' + (start + j), body: '历史消息 compatibility and search ' + (start + j), authorLabelSnapshot: 'Bench' }
  })))
  for (let start = 0; start < 3205; start += 500) await commit(Array.from({ length: Math.min(500, 3205 - start) }, (_, j) => {
    const i = start + j, id = 'task_' + i, roomId = 'room_' + (i % 100)
    return { kind: 'task', id, taskId: id, roomId, value: { task: { id, roomId,
      requestId: 'request_' + (i % 100), title: 'Benchmark task ' + i, repositoryId: 'repo',
      status: i < 2000 ? 'completed' : 'needs_input' }, prompt: 'Historical task context'.repeat(100) } }
  }))
  await commit([{ kind: 'integration', id: 'large-integration', taskId: 'task_0', roomId: 'room_0',
    value: { taskId: 'task_0', status: 'ready', diff: 'diff --git a/file b/file\n+example content\n'.repeat(260000) } }])
  const full = await store.list('integration', { roomId: 'room_0', limit: 50 })
  const projected = await store.list('integration', { roomId: 'room_0', limit: 50, activityOnly: true })
  const projectionRatio = JSON.stringify(projected).length / JSON.stringify(full).length
  if (projectionRatio > 0.01) throw new Error('activity projection loaded historical diff content')
  const setupMs = performance.now() - setupStarted
  const started = performance.now()
  console.log(JSON.stringify({ phase: 'soak', durationMs, setupMs, projectionRatio }))
  while (performance.now() - started < durationMs) {
    const tick = performance.now()
    const roomId = 'room_' + (iteration % 100)
    await commit([{ kind: 'message', id: 'live_' + iteration, roomId,
      value: { body: 'Live event ' + iteration, authorLabelSnapshot: 'Bench' } }],
    [{ roomId, kind: 'message.created', payload: { id: 'live_' + iteration } }])
    emitted++
    const [messages, tasks, activity, outcomes, events] = await Promise.all([
      store.list('message', { roomId, limit: 50 }), store.list('task', { roomId, limit: 50 }),
      roomActivitySummary(store, roomId), store.requestOutcomes({ roomId, limit: 50 }),
      store.events('*', cursor, 200)
    ])
    reads += 5
    if (messages.length > 50 || tasks.length > 50 || outcomes.outcomes.length > 50) throw new Error('unbounded page')
    consumed += events.length
    cursor = events.at(-1)?.seq ?? cursor
    maxBacklog = Math.max(maxBacklog, emitted - consumed)
    if (activity.attentionCount < 1) throw new Error('pending request activity disappeared')
    sizes.push(Buffer.byteLength(JSON.stringify({ messages, tasks, activity, outcomes })))
    timings.push(performance.now() - tick)
    if (iteration % 100 === 0) {
      rss.push({ elapsedMs: performance.now() - started, rssBytes: process.memoryUsage().rss })
      await writeFile(join(evidence, 'progress.json'), JSON.stringify({ iteration, reads, writes, emitted, consumed, rss: rss.at(-1), p95Ms: percentile(timings, .95) }, null, 2))
    }
    iteration++
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  const remaining = await store.events('*', cursor, 200)
  consumed += remaining.length
  const report = { ok: emitted === consumed, platform: process.platform, arch: process.arch, node: process.version,
    fixtures: { rooms: 100, messages: 100000, historicalTasks: 2000, pendingTasks: 1205, largeDiffBytes: 10660000 },
    durationMs: performance.now() - started, setupMs, iterations: iteration, reads, writes,
    emitted, consumed, maxBacklog, projectionRatio, p50Ms: percentile(timings, .5), p95Ms: percentile(timings, .95),
    maximumTickMs: Math.max(...timings), p95ResponseBytes: percentile(sizes, .95), rssSamples: rss }
  await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ok: report.ok, p95Ms: report.p95Ms, emitted, consumed, evidence }))
  if (!report.ok) process.exitCode = 1
} finally {
  await store.close()
  await rm(root, { recursive: true, force: true })
}
