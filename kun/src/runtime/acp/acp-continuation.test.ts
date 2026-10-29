import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileSessionStore } from '../../adapters/file/file-session-store.js'
import { InMemoryEventBus } from '../../adapters/in-memory-event-bus.js'
import { RuntimeEvent } from '../../contracts/events.js'
import { makeUserItem } from '../../domain/item.js'
import { resolveTurnHandoff } from '../../handoff/turn-handoff.js'
import { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import { DelegatedSessionCoordinator, FileDelegatedSessionBindingStore, delegatedCapabilityFingerprint } from '../delegated-session-binding.js'
import { AcpConnection } from './acp-connection.js'
import { AcpSessionManager, type AcpSessionRequest } from './acp-session-manager.js'
import { startAcpProcess, type AcpProcess } from './acp-process.js'
import { acpContinuationFailure, recordAcpHandoff, type AcpContinuationEvent } from './acp-continuation.js'
import { AcpError } from './acp-schema.js'

const fixtureAgent = fileURLToPath(new URL('./__fixtures__/fake-acp-agent.mjs', import.meta.url))
const roots: string[] = []
const processes: AcpProcess[] = []
const threadId = 'thread_continuation'
const turnId = 'turn_current'
const priorItems = Array.from({ length: 6 }, (_, index) => makeUserItem({
  id: `user_${index}`, threadId, turnId: `turn_${index}`, text: `Prior task ${index}`
}))

beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined))
afterEach(async () => {
  for (const proc of processes.splice(0)) await proc.stop().catch(() => undefined)
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

async function setup(scenario: Record<string, unknown> = {}, loadSession = true) {
  const root = mkdtempSync(join(tmpdir(), 'acp-continuation-'))
  roots.push(root)
  const scenarioPath = join(root, 'scenario.json')
  writeFileSync(scenarioPath, JSON.stringify({
    initialize: { protocolVersion: 1, agentCapabilities: { loadSession }, authMethods: [] },
    sessionId: 'replacement-native',
    newSession: { modes: { currentModeId: 'normal', availableModes: [{ id: 'normal', name: 'Normal' }] } },
    ...scenario
  }))
  const proc = await startAcpProcess({
    command: process.execPath, args: [fixtureAgent], env: { FAKE_ACP_SCENARIO: scenarioPath },
    spawn: async (command, args, options) => spawn(command, [...args], {
      env: options.env as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe']
    })
  })
  processes.push(proc)
  const conn = AcpConnection.start({ process: proc, identity: 'private-credential-identity' })
  await conn.initialize()
  const coordinator = new DelegatedSessionCoordinator(new FileDelegatedSessionBindingStore(join(root, 'bindings')))
  const preparation = await coordinator.prepare({
    threadId,
    route: { providerKind: 'acp', providerId: 'devin', credentialIdentity: conn.identity,
      workspace: root, model: 'default', modelScope: 'session', continuationMode: 'native',
      capabilityFingerprint: delegatedCapabilityFingerprint(conn.initResult?.agentCapabilities ?? {}) },
    priorItems: []
  })
  await coordinator.commit({ preparation, nativeSessionId: 'original-native',
    committedItems: priorItems, lastCommittedTurnId: 'turn_5' })
  mkdirSync(join(root, 'threads', threadId), { recursive: true })
  const store = new FileSessionStore({ dataDir: root })
  const bus = new InMemoryEventBus()
  const recorder = new RuntimeEventRecorder({ eventBus: bus, sessionStore: store,
    allocateSeq: () => bus.allocateSeq(threadId), nowIso: () => new Date().toISOString() })
  const recorded: AcpContinuationEvent[] = []
  const ctx: AcpSessionRequest = {
    threadId, turnId, harnessId: 'devin', workspacePath: root,
    items: [...priorItems, makeUserItem({ id: 'current', threadId, turnId, text: 'Continue' })],
    recordContinuationEvent: async (event) => {
      recorded.push(event)
      return recorder.record(event)
    }
  }
  const manager = new AcpSessionManager({ coordinator, sessionRequestTimeoutMs: 150 })
  return { conn, coordinator, manager, ctx, recorded, recorder, root }
}

async function replay(root: string) {
  return new FileSessionStore({ dataDir: root }).loadEventsSince(threadId, 0)
}

describe('ACP native continuation diagnostics', () => {
  it('persists the first failure before clearing state and records safe recovery provenance', async () => {
    const h = await setup({ loadSession: { error: { code: -32002,
      message: '\u001b[31mSession gone Authorization: Bearer kun_private_token\u001b[0m {"api_key":"plain-secret-value","refresh_token":"refresh-secret"}' } } })
    const clear = vi.spyOn(h.coordinator, 'rejectResume')
    const record = h.ctx.recordContinuationEvent!
    h.ctx.recordContinuationEvent = async (event) => {
      expect(clear).not.toHaveBeenCalled()
      expect((await h.coordinator.store.load(threadId))?.nativeSessionId).toBe('original-native')
      return record(event)
    }
    const session = await h.manager.ensureSession(h.ctx, h.conn)
    expect(h.recorded[0]).toMatchObject({ kind: 'harness_continuation_failed', threadId, turnId,
      harnessId: 'devin', reason: 'native_state_unavailable', previousSession: { generation: 1, nativeSessionId: 'original-native' },
      failure: { stage: 'session/load', code: 'agent_error', rpcCode: -32002, detailsAvailable: true } })
    expect(session.preparation.generation).toBe(2)
    const handoff = resolveTurnHandoff({ enabled: true, preparation: session.preparation,
      items: h.ctx.items, currentTurnId: turnId, ownerThreadId: threadId, workspacePath: h.root, harnessName: 'Devin' })
    await recordAcpHandoff(h.recorder, { threadId, turnId, harnessId: 'devin' }, handoff, session)
    const events = await replay(h.root)
    const recovered = events.find((event) => event.kind === 'harness_session_recreated')
    expect(recovered).toMatchObject({ replacementSession: { generation: 2, nativeSessionId: 'replacement-native' },
      recovery: { mode: 'full', recentTurns: handoff!.event.stats.recentTurns, briefDigest: handoff!.event.briefDigest } })
    expect(events.find((event) => event.kind === 'handoff_injected')).toMatchObject({
      continuationFailure: { code: 'agent_error', rpcCode: -32002 } })
    for (const event of events) expect(RuntimeEvent.safeParse(event).success).toBe(true)
    const logs = JSON.stringify(vi.mocked(console.warn).mock.calls)
    const persisted = JSON.stringify(events)
    for (const text of [persisted, logs]) {
      expect(text).not.toContain('kun_private_token')
      expect(text).not.toContain('plain-secret-value')
      expect(text).not.toContain('refresh-secret')
      expect(text).not.toContain('private-credential-identity')
      expect(text).not.toContain('mcpServers')
      expect(text).not.toContain('\\u001b')
      expect(text).toContain('[redacted]')
    }
    expect(events[0].timestamp).toBe(h.recorded[0].timestamp)
    await h.manager.commit(session, { committedItems: priorItems, lastCommittedTurnId: turnId })
    const cached = await h.manager.ensureSession({ ...h.ctx, turnId: 'turn_later', items: priorItems }, h.conn)
    expect(cached.continuation).toBeUndefined()
  })

  it('does not rebase a native AbortError from launch validation', async () => {
    const h = await setup()
    h.ctx.validateLaunch = async () => { throw new DOMException('User cancelled', 'AbortError') }
    const reject = vi.spyOn(h.coordinator, 'rejectResume')
    await expect(h.manager.ensureSession(h.ctx, h.conn)).rejects.toMatchObject({ name: 'AbortError' })
    expect(reject).not.toHaveBeenCalled()
    expect(h.recorded).toEqual([])
    expect((await h.coordinator.store.load(threadId))?.nativeSessionId).toBe('original-native')
  })

  it('records history mismatch before clearing provider state even when clearing fails', async () => {
    const h = await setup()
    h.ctx.items = [makeUserItem({ id: 'current', threadId, turnId, text: 'Changed history' })]
    const clear = vi.spyOn(h.coordinator.store, 'clearProviderState').mockRejectedValue(new Error('disk failure'))
    const record = h.ctx.recordContinuationEvent!
    h.ctx.recordContinuationEvent = async (event) => {
      expect(clear).not.toHaveBeenCalled()
      return record(event)
    }
    await expect(h.manager.ensureSession(h.ctx, h.conn)).rejects.toThrow('disk failure')
    expect((await replay(h.root))[0]).toMatchObject({ kind: 'harness_continuation_failed',
      failure: { stage: 'binding_validation', code: 'history_changed' }, previousSession: { nativeSessionId: 'original-native' } })
  })

  it('keeps the load failure when session/new also fails', async () => {
    const h = await setup({ loadSession: { error: { code: -32002, message: 'old session expired' } },
      newSession: { error: { code: -32603, message: 'replacement unavailable' } } })
    await expect(h.manager.ensureSession(h.ctx, h.conn)).rejects.toMatchObject({ message: 'replacement unavailable' })
    const events = await replay(h.root)
    expect(events.map((event) => event.kind)).toEqual(['harness_continuation_failed', 'harness_session_recreation_failed'])
    expect(events[1]).toMatchObject({ failure: { message: 'old session expired', rpcCode: -32002 },
      recreationError: { stage: 'session/new', message: 'replacement unavailable', rpcCode: -32603 } })
  })

  it.each([
    [{ loadSession: { error: { code: -32002, message: '' } } }, 'session/load', 'agent_error', false],
    [{ loadSession: { result: 'malformed response' } }, 'session/load_result', 'harness_protocol_error', true],
    [{ loadSession: { neverRespond: true } }, 'session/load', 'request_timeout', true]
  ] as const)('classifies missing details, invalid results and timeouts (%j)', async (scenario, stage, code, detailsAvailable) => {
    const h = await setup(scenario)
    const session = await h.manager.ensureSession(h.ctx, h.conn)
    expect(session.continuation?.failure).toMatchObject({ stage, code, detailsAvailable })
    if (!detailsAvailable) expect(session.continuation?.failure.message).toBe('No error details available from the agent')
    expect((await replay(h.root))[0]).toMatchObject({ failure: { stage, code, detailsAvailable } })
  })

  it('records lack of load support without inventing an Agent error', async () => {
    const h = await setup({}, false)
    const session = await h.manager.ensureSession(h.ctx, h.conn)
    expect(session.continuation).toMatchObject({ previousSession: { nativeSessionId: 'original-native' },
      failure: { stage: 'binding_validation', code: 'load_session_unsupported', detailsAvailable: false } })
  })

  it('records a local history mismatch separately from an Agent load failure', async () => {
    const h = await setup()
    h.ctx.items = [makeUserItem({ id: 'different', threadId, turnId: 'old', text: 'Changed history' })]
    const session = await h.manager.ensureSession(h.ctx, h.conn)
    expect(session.continuation).toMatchObject({ reason: 'history_changed',
      previousSession: { generation: 1, nativeSessionId: 'original-native' },
      failure: { stage: 'binding_validation', code: 'history_changed', detailsAvailable: false } })
    expect(session.preparation.generation).toBe(2)
  })

  it('retains structured exit details and sanitized stderr on process death during session/load', async () => {
    const h = await setup({ loadSession: { crash: { code: 7, stderr: 'crash sk-testsecret123456789' } } })
    await expect(h.manager.ensureSession(h.ctx, h.conn)).rejects.toMatchObject({ code: 'harness_crashed' })
    const events = await replay(h.root)
    expect(events[0]).toMatchObject({ failure: { stage: 'session/load', code: 'harness_crashed',
      connectionClosed: true, process: { exitCode: 7, signal: null, stderrTail: 'crash [redacted]' } } })
    expect(JSON.stringify(events)).not.toContain('sk-testsecret123456789')
  })

  it('bounds diagnostics and excludes arbitrary error data', async () => {
    const h = await setup()
    const error = new AcpError('agent_error', `Authorization: Bearer kun_secret ${'x'.repeat(2_000)}`, {
      rpcCode: -32603, data: { secret: 'never-persist-this-data' }
    })
    const failure = acpContinuationFailure(h.conn, 'session/load', error)
    expect(failure.message).toHaveLength(1_024)
    expect(failure.message).not.toContain('kun_secret')
    expect(JSON.stringify(failure)).not.toContain('never-persist-this-data')
    expect(failure).not.toHaveProperty('data')
  })

  it('still recovers and logs clearly if event persistence fails', async () => {
    const h = await setup({ loadSession: { error: { code: -32002, message: 'gone' } } })
    h.ctx.recordContinuationEvent = async () => { throw new Error('store unavailable') }
    const session = await h.manager.ensureSession(h.ctx, h.conn)
    expect(session.sessionId).toBe('replacement-native')
    expect(console.warn).toHaveBeenCalledWith('[acp-continuation] diagnostic_persistence_failed', threadId, turnId,
      'harness_continuation_failed')
  })
})
