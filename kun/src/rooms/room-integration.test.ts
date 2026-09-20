import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { productGitFixture } from '../../tests/room-product-git-test-fixture.js'
import { roomGit } from './room-git.js'
import { RoomIntegrationService, assertNoActiveRoomIntegration } from './room-integration.js'
import type { RoomIntegration } from '../contracts/rooms-product.js'
import { freezeIntegrationCandidate } from './room-integration-git.js'
import type { RoomTaskExecution } from './room-runtime-types.js'
import type { ModelClient, ModelStreamChunk } from '../ports/model-client.js'
import { RoomMemberSchema } from '../contracts/rooms.js'
import type { RoomStoreCommit } from './room-store.js'

const fixtures: Awaited<ReturnType<typeof productGitFixture>>[] = []
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close() })
async function fixture(model?: ModelClient) { const f = await productGitFixture(model); fixtures.push(f); return f }
async function advance(f: Awaited<ReturnType<typeof fixture>>, conflict = false) {
  await writeFile(join(f.source, conflict ? 'source.txt' : 'target.txt'), 'target advanced\n')
  await roomGit(f.source, ['add', '.'])
  await roomGit(f.source, ['commit', '-m', 'target advance'])
  return roomGit(f.source, ['rev-parse', 'HEAD'])
}

describe('room integration Git and durable application', () => {
  it('integrates diverged target without changing source until application, then replays exactly once', async () => {
    const f = await fixture()
    const target = await advance(f)
    const candidate = await f.prepare()
    expect(candidate.status, candidate.error).toBe('ready')
    expect(candidate.targetSha).toBe(target)
    expect(await roomGit(f.source, ['rev-parse', 'HEAD'])).toBe(target)
    expect(await readFile(join(candidate.path, 'source.txt'), 'utf8')).toBe('delivered\n')
    expect(await readFile(join(candidate.path, 'target.txt'), 'utf8')).toBe('target advanced\n')
    expect(await f.prepare()).toEqual(candidate)
    const body = { clientRequestId: 'apply_one', expectedRevision: candidate.revision, confirmUnverified: true }
    const result = await f.service.action(f.roomId, f.taskId, candidate.id, 'apply', body)
    expect(result).toMatchObject({ status: 'applied' })
    expect(await f.service.action(f.roomId, f.taskId, candidate.id, 'apply', body)).toEqual(result)
    expect(await roomGit(f.source, ['rev-parse', 'HEAD'])).toBe(candidate.candidateSha)
    expect(await roomGit(f.source, ['rev-parse', f.delivery.pinRef])).toBe(f.delivery.versionHash)
    expect(await roomGit(f.source, ['rev-parse', 'refs/kun/rooms/' + f.taskId + '/' + candidate.candidatePinId])).toBe(candidate.candidateSha)
  })

  it('preserves staged, unstaged and untracked source files and rejects dirty or stale application', async () => {
    const f = await fixture()
    await writeFile(join(f.source, 'source.txt'), 'staged\n')
    await roomGit(f.source, ['add', 'source.txt'])
    await writeFile(join(f.source, 'source.txt'), 'unstaged\n')
    await writeFile(join(f.source, 'private.txt'), 'private\n')
    const status = await roomGit(f.source, ['status', '--porcelain=v1'])
    const candidate = await f.prepare()
    expect(candidate.status).toBe('ready')
    await expect(f.service.action(f.roomId, f.taskId, candidate.id, 'apply', {
      clientRequestId: 'apply_dirty', expectedRevision: candidate.revision, confirmUnverified: true })).rejects.toThrow('uncommitted')
    expect(await roomGit(f.source, ['status', '--porcelain=v1'])).toBe(status)
    expect(await roomGit(f.source, ['show', ':source.txt'])).toBe('staged')
    expect(await readFile(join(f.source, 'source.txt'), 'utf8')).toBe('unstaged\n')
    // Commit the user's own files in the fixture; the application must reject the changed target.
    await roomGit(f.source, ['add', '.'])
    await roomGit(f.source, ['commit', '-m', 'user changes'])
    await expect(f.service.action(f.roomId, f.taskId, candidate.id, 'apply', {
      clientRequestId: 'apply_stale', expectedRevision: candidate.revision, confirmUnverified: true })).rejects.toThrow('target changed')
    expect((await f.store.get<RoomIntegration>('integration', candidate.id))?.value.applyIntent).toBeUndefined()
  })

  it('retains conflicts and freezes only after a real merge resolution; historical candidate pins survive changes', async () => {
    const f = await fixture()
    const target = await advance(f, true)
    const candidate = await f.prepare()
    expect(candidate.status).toBe('conflict')
    expect(candidate.conflicts).toEqual(['source.txt'])
    await expect(freezeIntegrationCandidate(f.deps, candidate, f.workspace)).rejects.toThrow('unresolved')
    expect(await roomGit(f.source, ['rev-parse', 'HEAD'])).toBe(target)
    await writeFile(join(candidate.path, 'source.txt'), 'merged both intentions\n')
    await roomGit(candidate.path, ['add', 'source.txt'])
    await freezeIntegrationCandidate(f.deps, candidate, f.workspace)
    const first = candidate.candidateSha!
    const pin = candidate.candidatePinId!
    await writeFile(join(candidate.path, 'source.txt'), 'review correction\n')
    await freezeIntegrationCandidate(f.deps, candidate, f.workspace)
    expect(candidate.candidates).toHaveLength(2)
    expect(candidate.candidateSha).not.toBe(first)
    expect(await roomGit(f.source, ['rev-parse', 'refs/kun/rooms/' + f.taskId + '/' + pin])).toBe(first)
    expect(await roomGit(f.source, ['rev-parse', f.delivery.pinRef])).toBe(f.delivery.versionHash)
  })

  it('refuses to freeze target-only state after an unsuccessful merge', async () => {
    const f = await fixture()
    await advance(f, true)
    const candidate = await f.prepare()
    await roomGit(candidate.path, ['merge', '--abort'])
    await expect(freezeIntegrationCandidate(f.deps, candidate, f.workspace)).rejects.toThrow('not a fast-forward descendant')
    expect(candidate.candidateSha).toBeUndefined()
  })

  it('recovers an application whose Git succeeded but database receipt failed', async () => {
    const f = await fixture()
    const candidate = await f.prepare()
    const commit = f.store.commit.bind(f.store)
    let failReceipt = true
    vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
      if (failReceipt && input.puts?.some((put) => put.kind === 'integration' && (put.value as RoomIntegration).status === 'applied')) {
        failReceipt = false
        throw new Error('receipt unavailable')
      }
      return commit(input)
    })
    const body = { clientRequestId: 'apply_receipt', expectedRevision: candidate.revision, confirmUnverified: true }
    await expect(f.service.action(f.roomId, f.taskId, candidate.id, 'apply', body)).rejects.toThrow('receipt unavailable')
    expect(await roomGit(f.source, ['rev-parse', 'HEAD'])).toBe(candidate.candidateSha)
    expect((await f.store.get<RoomIntegration>('integration', candidate.id))?.value.applyIntent?.candidateSha).toBe(candidate.candidateSha)
    expect((await f.store.get<RoomTaskExecution>('task', f.taskId))?.value.task.applicationStatus).toBe('applying')
    const restarted = new RoomIntegrationService(f.deps)
    expect(await restarted.action(f.roomId, f.taskId, candidate.id, 'apply', body)).toMatchObject({ status: 'applied' })
    await expect(restarted.action(f.roomId, f.taskId, candidate.id, 'resolve', body)).rejects.toThrow('identity conflict')
  })

  it('keeps missing integration turn identities occupied and blocks ordinary task actions', async () => {
    const f = await fixture()
    const candidate = await f.prepare()
    const row = (await f.store.get<RoomIntegration>('integration', candidate.id))!
    await f.store.commit({ requestId: 'inject-lost-execution', checks: [{ kind: 'integration', id: row.id, expectedRevision: row.revision }],
      puts: [{ kind: 'integration', id: row.id, roomId: f.roomId, taskId: f.taskId,
        value: { ...row.value, status: 'recovery_required', threadId: 'missing_thread', turnId: 'missing_turn' } }] })
    expect(await f.service.active()).toHaveLength(1)
    await expect(assertNoActiveRoomIntegration(f.deps, f.roomId, f.taskId)).rejects.toThrow('must stop')
  })

  it('reconciles the exact candidate after a lost receipt even when source subsequently advances', async () => {
    const f = await fixture()
    const candidate = await f.prepare()
    const commit = f.store.commit.bind(f.store)
    let fail = true
    vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
      if (fail && input.puts?.some((put) => put.kind === 'integration' && (put.value as RoomIntegration).status === 'applied')) {
        fail = false; throw new Error('lost receipt')
      }
      return commit(input)
    })
    await expect(f.service.action(f.roomId, f.taskId, candidate.id, 'apply', {
      clientRequestId: 'lost', expectedRevision: candidate.revision, confirmUnverified: true })).rejects.toThrow('lost receipt')
    const advanced = await advance(f)
    await writeFile(join(f.source, 'user-draft.txt'), 'untracked personal work\n')
    const row = await f.service.get(f.roomId, f.taskId, candidate.id)
    expect(await f.service.action(f.roomId, f.taskId, candidate.id, 'apply', {
      clientRequestId: 'fresh-click', expectedRevision: row.revision, confirmUnverified: true })).toMatchObject({ status: 'applied' })
    expect(await roomGit(f.source, ['rev-parse', 'HEAD'])).toBe(advanced)
    expect(await readFile(join(f.source, 'user-draft.txt'), 'utf8')).toBe('untracked personal work\n')
  })

  it('cancels a queued integration only after executor confirmation, including lost admission receipt', async () => {
    const f = await fixture()
    const candidate = await f.service.prepare(f.roomId, f.taskId, {
      clientRequestId: 'with-check', expectedRevision: 0, validationCommands: ['node -e "process.exit(0)"'] })
    for (let i = 0; i < 2; i++) await f.service.tick(await f.service.get(f.roomId, f.taskId, candidate.id), true)
    let row = await f.service.get(f.roomId, f.taskId, candidate.id)
    const turnId = row.value.turnId
    await f.store.commit({ requestId: 'lose-admission', checks: [{ kind: 'integration', id: row.id, expectedRevision: row.revision }],
      puts: [{ kind: 'integration', id: row.id, roomId: f.roomId, taskId: f.taskId, value: { ...row.value, turnId: undefined } }] })
    row = await f.service.get(f.roomId, f.taskId, candidate.id)
    await f.service.action(f.roomId, f.taskId, candidate.id, 'cancel', { clientRequestId: 'cancel', expectedRevision: row.revision })
    row = await f.service.get(f.roomId, f.taskId, candidate.id)
    expect(row.value.cancelRequested).toBe(true)
    expect((await f.h.threads.getMetadata(row.value.threadId!))?.turns.find((turn) => turn.id === turnId)?.status).toBe('aborted')
    await f.service.tick(row, false)
    row = await f.service.get(f.roomId, f.taskId, candidate.id)
    expect(row.value.status).toBe('failed')
    expect(row.value.error).toContain('cancelled')
    expect(await f.service.activity(row.value)).toBe('idle')
  })

  it('does not finalize a terminal turn while its background shell can still write', async () => {
    const f = await fixture()
    const candidate = await f.service.prepare(f.roomId, f.taskId, {
      clientRequestId: 'background-check', expectedRevision: 0, validationCommands: ['node -e "process.exit(0)"'] })
    for (let i = 0; i < 2; i++) await f.service.tick(await f.service.get(f.roomId, f.taskId, candidate.id), true)
    let row = await f.service.get(f.roomId, f.taskId, candidate.id)
    await f.h.turns.startNextQueuedTurn(row.value.threadId!)
    await f.h.loop.runTurn(row.value.threadId!, row.value.turnId!)
    let running = true
    f.deps.backgroundExecutionActive = (threadId) => threadId === row.value.threadId && running
    f.deps.stopBackgroundExecution = async () => { running = false }
    await f.service.tick(row, true)
    row = await f.service.get(f.roomId, f.taskId, candidate.id)
    expect(row.value.status).toBe('validating')
    expect(await f.service.activity(row.value)).toBe('active')
    await f.service.action(f.roomId, f.taskId, candidate.id, 'cancel', { clientRequestId: 'cancel-background', expectedRevision: row.revision })
    expect(running).toBe(false)
    await f.service.tick(await f.service.get(f.roomId, f.taskId, candidate.id), false)
    expect((await f.service.get(f.roomId, f.taskId, candidate.id)).value).toMatchObject({ status: 'failed', cancelRequested: true })
  })

  it('rejects an altered immutable candidate pin and application without verification acknowledgement', async () => {
    const f = await fixture()
    const candidate = await f.prepare()
    await expect(f.service.action(f.roomId, f.taskId, candidate.id, 'apply', {
      clientRequestId: 'unverified', expectedRevision: candidate.revision })).rejects.toThrow('confirm this unverified')
    await roomGit(f.source, ['update-ref', 'refs/kun/rooms/' + f.taskId + '/' + candidate.candidatePinId, f.repository.head])
    await expect(f.service.action(f.roomId, f.taskId, candidate.id, 'apply', {
      clientRequestId: 'tampered', expectedRevision: candidate.revision, confirmUnverified: true })).rejects.toThrow('pin changed')
  })

  it('runs an actual read-only review through AgentLoop and consumes its structured result', async () => {
    let call = 0
    const model: ModelClient = { provider: 'fake', model: 'fake', async *stream(request): AsyncIterable<ModelStreamChunk> {
      expect(request.tools.some((tool) => tool.name === 'submit_room_review')).toBe(true)
      expect(request.tools.some((tool) => tool.name === 'write' || tool.name === 'bash')).toBe(false)
      if (++call === 1) {
        yield { kind: 'tool_call_complete', callId: 'review-result', toolName: 'submit_room_review', arguments: {
          verdict: 'passed', findings: [], limitations: ['No test command declared'] } }
        yield { kind: 'completed', stopReason: 'tool_calls' }
      } else { yield { kind: 'assistant_text_delta', text: 'Review completed.' }; yield { kind: 'completed', stopReason: 'stop' } }
    } }
    const f = await fixture(model)
    const task = (await f.store.get<RoomTaskExecution>('task', f.taskId))!
    await f.store.commit({ requestId: 'reviewer', checks: [{ kind: 'task', id: f.taskId, expectedRevision: task.revision }],
      puts: [{ kind: 'task', id: f.taskId, roomId: f.roomId, taskId: f.taskId,
      value: { ...task.value, reviewer: RoomMemberSchema.parse({ id: 'reviewer', displayName: 'Reviewer', presetId: 'general', role: 'reviewer', revision: 0 }) } }] })
    const candidate = await f.service.prepare(f.roomId, f.taskId, { clientRequestId: 'prepare_review', expectedRevision: 1 })
    expect(candidate.status, candidate.error).toBe('validating')
    for (let i = 0; i < 2; i++) await f.service.tick((await f.service.get(f.roomId, f.taskId, candidate.id)), true)
    let row = await f.service.get(f.roomId, f.taskId, candidate.id)
    expect(row.value.turnId).toBeTruthy()
    await f.h.turns.startNextQueuedTurn(row.value.threadId!)
    await f.h.loop.runTurn(row.value.threadId!, row.value.turnId!)
    await f.service.tick(row, true)
    row = await f.service.get(f.roomId, f.taskId, candidate.id)
    expect(row.value.status, row.value.error).toBe('ready')
    expect(row.value.review).toMatchObject({ verdict: 'passed', versionHash: candidate.candidateSha })
    expect(await readFile(join(row.value.path, 'source.txt'), 'utf8')).toBe('delivered\n')
    const reviewPath = join(f.deps.dataDir, 'rooms', 'reviews', candidate.candidatePinId!)
    expect(await roomGit(reviewPath, ['rev-parse', 'HEAD'])).toBe(candidate.candidateSha)
  }, 20000)

  it('runs controlled conflict resolution and declared verification through the real executor', async () => {
    const command = 'node -e "if(require(\'fs\').readFileSync(\'source.txt\',\'utf8\')!==\'resolved\\n\')process.exit(1)"'
    const actions = [
      { name: 'read', args: { path: 'source.txt' } },
      { name: 'write', args: { path: 'source.txt', content: 'resolved\n' } },
      { name: 'bash', args: { command: 'git add -- source.txt' } },
      { name: 'declare_room_checks', args: { checks: [{ id: 'resolved-content', command }] } },
      { name: 'bash', args: { command } }
    ]
    let step = 0
    const model: ModelClient = { provider: 'fake', model: 'fake', async *stream(request): AsyncIterable<ModelStreamChunk> {
      const action = actions[step++]
      if (action) {
        expect(request.tools.some((tool) => tool.name === action.name), action.name).toBe(true)
        yield { kind: 'tool_call_complete', callId: 'step-' + step, toolName: action.name, arguments: action.args }
        yield { kind: 'completed', stopReason: 'tool_calls' }
      } else {
        yield { kind: 'assistant_text_delta', text: 'Resolved and verified.' }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    } }
    const f = await fixture(model)
    await advance(f, true)
    const candidate = await f.service.prepare(f.roomId, f.taskId, {
      clientRequestId: 'prepare_resolve', expectedRevision: 0, validationCommands: [command] })
    expect(candidate.status).toBe('conflict')
    await f.service.action(f.roomId, f.taskId, candidate.id, 'resolve', {
      clientRequestId: 'resolve', expectedRevision: candidate.revision })
    for (let i = 0; i < 2; i++) await f.service.tick(await f.service.get(f.roomId, f.taskId, candidate.id), true)
    let row = await f.service.get(f.roomId, f.taskId, candidate.id)
    await f.h.turns.startNextQueuedTurn(row.value.threadId!)
    const approvals = setInterval(() => {
      for (const pending of f.h.approvalGate.pending(row.value.threadId)) f.h.approvalGate.decide(pending.id, 'allow')
    }, 10)
    try { await f.h.loop.runTurn(row.value.threadId!, row.value.turnId!) } finally { clearInterval(approvals) }
    await f.service.tick(row, true)
    row = await f.service.get(f.roomId, f.taskId, candidate.id)
    expect(row.value.status, row.value.error).toBe('ready')
    expect(row.value.validation).toEqual([{ command, exitCode: 0, output: expect.any(String) }])
    expect(row.value.validationVersionHash).toBe(row.value.candidateSha)
    expect(await readFile(join(f.source, 'source.txt'), 'utf8')).toBe('target advanced\n')
  }, 20000)

  it('opens a manual conflict worktree without dispatching a turn and validates the resulting candidate', async () => {
    const f = await fixture()
    await advance(f, true)
    const candidate = await f.prepare()
    await f.service.action(f.roomId, f.taskId, candidate.id, 'open', { clientRequestId: 'open', expectedRevision: candidate.revision })
    let row = await f.service.get(f.roomId, f.taskId, candidate.id)
    expect((await f.h.threads.getMetadata(row.value.threadId!))?.turns).toHaveLength(0)
    await writeFile(join(row.value.path, 'source.txt'), 'resolved manually\n')
    await roomGit(row.value.path, ['add', 'source.txt'])
    await f.service.action(f.roomId, f.taskId, candidate.id, 'validate', {
      clientRequestId: 'validate', expectedRevision: row.revision })
    row = await f.service.get(f.roomId, f.taskId, candidate.id)
    expect(row.value.status).toBe('ready')
    expect(row.value.candidateSha).toBeTruthy()
    expect(row.value.validation).toEqual([])
    expect(await readFile(join(f.source, 'source.txt'), 'utf8')).toBe('target advanced\n')
  })

  it('pages active integrations without loading historical diff payloads into the scheduler', async () => {
    const f = await fixture()
    for (let start = 0; start < 1020; start += 500) {
      const puts: NonNullable<RoomStoreCommit['puts']> = []
      for (let i = start; i < Math.min(start + 500, 1020); i++) {
        const id = 'integration_' + i
        puts.push({ kind: 'integration', id, roomId: f.roomId, taskId: f.taskId,
          value: { id, status: i < 1005 ? 'validating' : 'applied', diff: i < 1005 ? '' : 'large historic diff'.repeat(1000) } })
      }
      await f.store.commit({ requestId: 'seed-integrations-' + start, puts,
        checks: puts.map((put) => ({ kind: put.kind, id: put.id, expectedRevision: null })) })
    }
    const list = vi.spyOn(f.store, 'list')
    expect(await f.service.active()).toHaveLength(1005)
    expect(list).toHaveBeenCalledTimes(2)
    for (const [kind, options] of list.mock.calls) {
      expect(kind).toBe('integration')
      expect(options?.status).toEqual(['preparing', 'validating', 'recovery_required'])
    }
  })

  it('publishes durable room events only when actual integration approval or input gates change', async () => {
    const f = await fixture()
    const candidate = await f.service.prepare(f.roomId, f.taskId, {
      clientRequestId: 'gated-check', expectedRevision: 0, validationCommands: ['node -e "process.exit(0)"'] })
    for (let i = 0; i < 2; i++) await f.service.tick(await f.service.get(f.roomId, f.taskId, candidate.id), true)
    let row = await f.service.get(f.roomId, f.taskId, candidate.id)
    const { threadId, turnId } = row.value
    const baseline = await f.store.latestEventSeq()
    const approval = f.h.approvalGate.request({ id: 'approval_one', threadId: threadId!, turnId: turnId!,
      toolName: 'bash', summary: 'Run candidate verification', status: 'pending', createdAt: new Date().toISOString() })
    await f.service.tick(row, true)
    row = await f.service.get(f.roomId, f.taskId, candidate.id)
    expect(row.value.attention).toMatchObject({ approvalIds: ['approval_one'], userInputIds: [] })
    expect(await f.store.events(f.roomId, baseline)).toMatchObject([{ kind: 'integration.updated', payload: { id: candidate.id, taskId: f.taskId } }])
    await f.service.tick(row, true)
    expect(await f.store.events(f.roomId, baseline)).toHaveLength(1)
    const input = f.h.userInputGate.request({ id: 'input_one', threadId: threadId!, turnId: turnId!, itemId: 'input_item',
      prompt: 'Select validation scope', questions: [] })
    await f.service.tick(row, true)
    row = await f.service.get(f.roomId, f.taskId, candidate.id)
    expect(row.value.attention).toMatchObject({ approvalIds: ['approval_one'], userInputIds: ['input_one'] })
    f.h.approvalGate.decide('approval_one', 'allow')
    await approval
    await f.service.tick(row, true)
    row = await f.service.get(f.roomId, f.taskId, candidate.id)
    expect(row.value.attention).toMatchObject({ approvalIds: [], userInputIds: ['input_one'] })
    f.h.userInputGate.resolve('input_one', { status: 'cancelled' })
    await input
    await f.service.tick(row, true)
    row = await f.service.get(f.roomId, f.taskId, candidate.id)
    expect(row.value.attention).toBeUndefined()
    expect(await f.store.events(f.roomId, baseline)).toHaveLength(4)
    await f.service.tick(row, true)
    expect(await f.store.events(f.roomId, baseline)).toHaveLength(4)
  })
})
