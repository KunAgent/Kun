import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkRuntime, evalOptions, runCase } from './eval-room-peer.mjs'

function fixture({ mode = 'peer', finalCount = 4, tasks = false, stopConflict = false } = {}) {
  const calls = [], bodies = [], room = { id: 'evaluation-room', collaborationMode: mode, repositories: [], revision: 1 }
  let stopped = false, stopAttempts = 0
  const requests = () => bodies.map((_, index) => ({ id: 'request-' + index, status: 'completed', revision: 1, discussions: [] }))
  const messages = () => Array.from({ length: bodies.length === 1 ? 2 : finalCount }, (_, index) => ({
    id: 'message-' + index, rootRequestId: 'request-0', sourceRequestId: index < 2 ? 'request-0' : 'request-1', authorKind: 'member', status: 'final', authorMemberId: ['coordinator', 'developer', 'reviewer'][index % 3],
    bodyRevision: 0, body: 'Use 30 jobs per minute, 60 peak, 70% utilization. secret-value-' + index, mentionMemberIds: []
  }))
  const api = async (path, method = 'GET', body) => {
    calls.push({ path, method, body })
    if (path === '/v1/rooms' && method === 'POST') { assert.deepEqual(body.repositories, []); return { room } }
    if (path === '/v1/rooms/evaluation-room/messages' && method === 'POST') {
      bodies.push(body); return { requestId: 'request-' + (bodies.length - 1), message: { rootRequestId: 'request-0' } }
    }
    if (path.includes('/messages?')) return { messages: messages() }
    if (path.endsWith('/requests?limit=200')) return { requests: requests() }
    if (/\/requests\/request-\d+$/.test(path)) return { request: requests()[Number(path.at(-1))] }
    if (path.endsWith('/topics?limit=50')) return { topics: [{ rootRequestId: 'request-0', generation: bodies.length,
      status: stopped ? 'stopped' : 'idle', pendingCount: 0, responseCount: messages().length, triageCount: 2,
      revision: stopAttempts + 1, publicationRevision: messages().length, members: [] }] }
    if (path.includes('/metrics?')) return { metrics: [{ id: 'triage-call', rootRequestId: 'request-0', phase: 'triage', outcome: 'respond', usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4, turns: 1 } }] }
    if (path.endsWith('/stop') && method === 'POST') {
      stopAttempts++
      if (stopConflict && stopAttempts === 1) throw Object.assign(new Error('conflict'), { status: 409 })
      stopped = true; return {}
    }
    if (path.includes('/tasks?')) return { tasks: tasks ? [{ id: 'unexpected-task' }] : [] }
    if (path === '/v1/rooms/evaluation-room') return { room }
    if (path.startsWith('/v1/threads?')) return { threads: [{ id: 'own' }, { id: 'foreign' }] }
    if (path === '/v1/threads/own') return { id: 'own', model: 'configured-model', roomContext: { roomId: room.id } }
    if (path === '/v1/threads/foreign') return { id: 'foreign', roomContext: { roomId: 'another-room' } }
    if (path === '/v1/usage?group_by=thread&thread_id=own') return { buckets: [{ thread_id: 'own', input_tokens: 8, output_tokens: 2, total_tokens: 10, turns: 2 }] }
    throw new Error('unexpected_fixture_route')
  }
  return { api, calls, bodies }
}

test('check mode is the default and Runtime URLs cannot smuggle credentials or leave localhost', () => {
  assert.equal(evalOptions([]).run, false)
  for (const url of ['https://example.com', 'http://localhost@evil.test', 'http://user:secret@localhost', 'http://localhost/?token=secret']) {
    assert.throws(() => evalOptions(['--url', url]), /runtime_url_must_be_local_origin/)
  }
  assert.throws(() => evalOptions(['--token-env', 'secret-token']), /invalid_token_environment_name/)
})

test('availability probe only reads local metadata and omits unrelated configuration', async () => {
  const paths = []
  const result = await checkRuntime(async (path, method) => {
    paths.push(path); assert.equal(method, undefined)
    if (path === '/health') return { status: 'ok', service: 'kun' }
    if (path === '/v1/runtime/info') return { model: 'native', serviceVersion: 'test', dataDir: '/private/hidden', unexpectedSecret: 'never-output' }
    return { presets: ['coordinator', 'developer', 'reviewer'].map((id) => ({ id })), defaultModel: { model: 'native', providerId: 'test' } }
  })
  assert.equal(result.ready, true)
  assert.deepEqual(paths, ['/health', '/v1/runtime/info', '/v1/rooms/presets'])
  assert(!JSON.stringify(result).includes('never-output'))
  assert(!JSON.stringify(result).includes('/private/hidden'))
})

test('peer correction preserves topic identity and stops before archiving, with scoped numeric usage', async () => {
  const { api, calls, bodies } = fixture({ stopConflict: true })
  const result = await runCase(api, { timeoutMs: 1000 }, 'unique-eval', 'peer')
  assert.equal(result.status, 'passed')
  assert.equal(bodies[1].rootRequestId, 'request-0')
  assert.equal(result.finalCount, 4)
  assert.equal(result.postCorrectionFinalCount, 2)
  assert.equal(result.stopConfirmed, true)
  assert.equal(result.archived, true)
  assert.equal(result.usage.totals.total_tokens, 10)
  assert.equal(result.peerMetrics.triageUsage.total_tokens, 4)
  assert.equal(result.peerMetrics.triageUsageMissingCalls, 0)
  assert(!calls.some((call) => call.path.includes('thread_id=foreign')))
  assert(calls.findIndex((call) => call.path.endsWith('/stop')) < calls.findIndex((call) => call.method === 'PATCH'))
  assert(!JSON.stringify(result).includes('secret-value'))
  assert(calls.filter((call) => call.method === 'POST' && call.path.endsWith('/stop')).length === 2)
})

test('an external observer overshoot fails acceptance and is reported honestly', async () => {
  const result = await runCase(fixture({ finalCount: 7 }).api, { timeoutMs: 1000 }, 'unique-eval', 'peer')
  assert.equal(result.status, 'failed')
  assert.equal(result.limitOvershoot, 1)
  assert.equal(result.stopReason, 'six_final_responses')
})

test('legacy mode uses its existing request lifecycle and never calls peer stop', async () => {
  const { api, calls } = fixture({ mode: 'autonomous' })
  const result = await runCase(api, { timeoutMs: 1000 }, 'unique-eval', 'autonomous')
  assert.equal(result.status, 'passed')
  assert(!calls.some((call) => call.path.includes('/topics')))
})

test('unexpected tasks fail the read-only case and prevent automatic archival', async () => {
  const result = await runCase(fixture({ tasks: true }).api, { timeoutMs: 1000 }, 'unique-eval', 'peer')
  assert.equal(result.status, 'failed')
  assert.equal(result.error, 'discussion_created_execution_tasks')
  assert.equal(result.taskCount, 1)
  assert.equal(result.archived, undefined)
})
