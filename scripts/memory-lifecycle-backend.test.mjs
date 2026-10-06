import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
let temporary, createBackend
before(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'kun-native-memory-service-tests-'))
  const output = join(temporary, 'backend.cjs')
  await build({ entryPoints: [resolve('scripts/fixtures/memory-lifecycle-backend.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: output })
  createBackend = require(output).createMemorySmokeBackend
})
after(async () => { await rm(temporary, { recursive: true, force: true }) })
async function fixture(name, work) {
  const backend = await createBackend(join(temporary, name))
  try { await work(backend, await backend.bootstrap()) } finally { await backend.close() }
}
const json = (response) => JSON.parse(response.body)

test('real scoped service rejects stale edits, persists correction once, and survives reopening both stores', async () => {
  await fixture('cas', async (backend, metadata) => {
    const path = `/v1/agents/${metadata.agentId}/memories/${metadata.memoryId}`
    const initial = json(await backend.request(path))
    backend.concurrentEditOnNextSave()
    const raced = await backend.request(path, 'PATCH', JSON.stringify({ clientRequestId: 'raced-ui-correction',
      expectedFingerprint: initial.fingerprint, content: 'Rejected raced UI draft' }))
    assert.equal(raced.status, 409)
    assert.equal((await backend.snapshot()).memory.content, metadata.originalContent)
    const original = json(await backend.request(path))
    const body = JSON.stringify({ clientRequestId: 'actual-correction', expectedFingerprint: original.fingerprint, content: 'Persisted fixture correction.' })
    assert.equal((await backend.request(path, 'PATCH', body)).ok, true)
    const replay = json(await backend.request(path, 'PATCH', body))
    assert.equal(replay.memory.revision, original.memory.revision + 1)
    assert.equal((await backend.request(path, 'PATCH', JSON.stringify({ clientRequestId: 'stale-correction', expectedFingerprint: original.fingerprint, content: 'Must not overwrite.' }))).status, 409)
    await backend.reopen()
    assert.equal((await backend.snapshot()).memory.content, 'Persisted fixture correction.')
    assert.equal(json(await backend.request(path + '/history')).history.at(-1).snapshot.content, metadata.originalContent)
    assert.equal((await backend.request('/v1/agents/another-agent/memories/' + metadata.memoryId)).status, 404)
  })
})

test('real lifecycle keeps forget distinct from erase and verifies canonical/history absence plus anti-replay', async () => {
  await fixture('erase', async (backend, metadata) => {
    const path = `/v1/agents/${metadata.agentId}/memories/${metadata.memoryId}`
    let request = 0
    const patch = async (input) => {
      const current = json(await backend.request(path))
      return backend.request(path, 'PATCH', JSON.stringify({ clientRequestId: 'lifecycle-' + ++request, expectedFingerprint: current.fingerprint, ...input }))
    }
    assert.equal((await patch({ disabled: true })).ok, true)
    assert.ok((await backend.snapshot()).memory.disabledAt)
    assert.equal((await patch({ disabled: false })).ok, true)
    assert.equal((await backend.snapshot()).memory.disabledAt, undefined)
    assert.equal((await patch({ rollbackRevision: 2 })).ok, true)
    assert.equal((await backend.snapshot()).memory.content, 'Run tests and retain the build result.')
    assert.equal((await patch({ forget: true })).ok, true)
    assert.ok((await backend.snapshot()).memory.deletedAt)
    assert.equal((await patch({ erase: true })).ok, false)
    assert.ok((await backend.snapshot()).memory)
    assert.equal((await patch({ erase: true, eraseConfirmation: { memoryId: metadata.memoryId, irreversible: true } })).ok, true)
    await backend.reopen()
    assert.deepEqual(await backend.verifyErasure(), { fileExists: false, retainedHistory: false, replayRecreated: false,
      unrelatedProjectRetained: true, sourceConversationRetained: true, sourceMessageRetained: true })
  })
})

test('generic routes enforce project scope/revision and persist candidate decisions', async () => {
  await fixture('routes', async (backend, metadata) => {
    const path = '/v1/memory/' + metadata.projectId
    const wrong = await backend.request(path + '?project=' + encodeURIComponent(join(temporary, 'wrong')), 'PATCH', JSON.stringify({ content: 'Wrong scope', expectedRevision: 1 }))
    assert.equal(wrong.ok, false)
    const valid = await backend.request(path + '?project=' + encodeURIComponent(metadata.projectRoot), 'PATCH', JSON.stringify({ content: 'Correct project scope', expectedRevision: 1 }))
    assert.equal(valid.ok, true)
    const stale = await backend.request(path + '?project=' + encodeURIComponent(metadata.projectRoot), 'PATCH', JSON.stringify({ content: 'Stale overwrite', expectedRevision: 1 }))
    assert.equal(stale.status, 409)
    const pendingPath = `/v1/agents/${metadata.agentId}/memory-candidates`
    const entry = json(await backend.request(pendingPath)).candidates[0]
    const decision = await backend.request(pendingPath + '/' + entry.candidate.id + '/decision', 'POST', JSON.stringify({
      clientRequestId: 'review-skip', expectedRevision: entry.revision, expectedTargetFingerprint: entry.target.fingerprint, decision: 'skip'
    }))
    assert.equal(decision.ok, true)
    await backend.reopen()
    assert.equal(json(await backend.request(pendingPath)).candidates.length, 0)
    assert.equal((await backend.snapshot()).project.content, 'Correct project scope')
  })
})
