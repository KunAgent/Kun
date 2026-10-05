import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import type { TurnItem } from '../../contracts/items.js'
import {
  DelegatedSessionCoordinator,
  FileDelegatedSessionBindingStore,
  delegatedCredentialIdentity
} from '../delegated-session-binding.js'
import { AcpConnection } from './acp-connection.js'
import { AcpConnectionPool } from './acp-connection-pool.js'
import { startAcpProcess, type AcpProcess } from './acp-process.js'
import { capabilitiesFromAcp } from './acp-capabilities.js'
import {
  AcpSessionManager,
  type AcpSessionRequest
} from './acp-session-manager.js'
import type { SessionUpdate } from './acp-schema.js'

const FIXTURE_AGENT = fileURLToPath(
  new URL('./__fixtures__/fake-acp-agent.mjs', import.meta.url)
)
const SCENARIOS = fileURLToPath(
  new URL('./__fixtures__/scenarios/', import.meta.url)
)

const spawned: Array<{ stop(): Promise<void> }> = []
const tempDirs: string[] = []
afterEach(async () => {
  for (const proc of spawned.splice(0)) await proc.stop().catch(() => undefined)
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

type JournalEntry = {
  dir: string
  kind?: string
  method?: string
  params?: Record<string, unknown>
  frame?: {
    method?: string
    kind?: string
    params?: Record<string, unknown>
  }
}

type FixtureContext = {
  conn: AcpConnection
  journalPath: string
  journal(): JournalEntry[]
  requests(method: string): Array<{ params?: Record<string, unknown> }>
}

async function startFixture(scenarioFile: string): Promise<FixtureContext> {
  const dir = mkdtempSync(join(tmpdir(), 'acp-session-'))
  tempDirs.push(dir)
  const journalPath = join(dir, 'journal.jsonl')
  const proc: AcpProcess = await startAcpProcess({
    command: process.execPath,
    args: [FIXTURE_AGENT],
    env: {
      FAKE_ACP_SCENARIO: join(SCENARIOS, scenarioFile),
      FAKE_ACP_JOURNAL: journalPath
    },
    spawn: async (command, args, options) =>
      spawn(command, [...args], {
        env: options.env as NodeJS.ProcessEnv,
        stdio: options.stdio as ['pipe', 'pipe', 'pipe']
      })
  })
  spawned.push(proc)
  const conn = AcpConnection.start({ process: proc, identity: 'cred-1' })
  const readJournal = () =>
    readFileSync(journalPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  return {
    conn,
    journalPath,
    journal: readJournal,
    requests(method: string) {
      return readJournal()
        .filter(
          (entry) => entry.dir === 'in' && entry.frame?.method === method
        )
        .map((entry) => entry.frame as { params?: Record<string, unknown> })
    }
  }
}

function makeCtx(overrides: Partial<AcpSessionRequest> = {}): AcpSessionRequest {
  return {
    threadId: 'thread_1',
    turnId: 'turn_1',
    workspacePath: '/tmp/work',
    harnessId: 'gemini-cli',
    model: 'fake-model-2',
    items: [],
    ...overrides
  }
}

function userItem(turnId: string, text: string): TurnItem {
  return {
    id: `item_${turnId}`,
    threadId: 'thread_1',
    turnId,
    role: 'user',
    kind: 'user_message',
    status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z',
    text
  } as TurnItem
}

function makeManager(rootDir?: string): {
  manager: AcpSessionManager
  coordinator: DelegatedSessionCoordinator
  debug: string[]
} {
  const dir = rootDir ?? mkdtempSync(join(tmpdir(), 'acp-bindings-'))
  if (!rootDir) tempDirs.push(dir)
  const coordinator = new DelegatedSessionCoordinator(
    new FileDelegatedSessionBindingStore(dir)
  )
  const debug: string[] = []
  const manager = new AcpSessionManager({
    coordinator,
    debug: (entry) => debug.push(entry.summary)
  })
  return { manager, coordinator, debug }
}

describe('AcpConnection.initialize', () => {
  test('handshakes and caches the initialize result', async () => {
    const { conn, requests } = await startFixture('basic-chat.json')
    const init = await conn.initialize()
    expect(init.protocolVersion).toBe(1)
    expect(init.agentCapabilities?.loadSession).toBe(true)
    expect(conn.initResult?.agentInfo?.name).toBe('fake-acp-agent')
    expect(init.authMethods).toEqual([])
    const initRequests = requests('initialize')
    expect(initRequests).toHaveLength(1)
    expect(initRequests[0].params?.clientInfo).toMatchObject({ name: 'kun' })
    // P2-10: form-mode elicitation is advertised; url stays unadvertised.
    const caps = initRequests[0].params?.clientCapabilities as
      | { elicitation?: Record<string, unknown> }
      | undefined
    expect(caps?.elicitation).toMatchObject({ form: {} })
    expect(caps?.elicitation).not.toHaveProperty('url')
    await conn.close()
  })

  test('rejects an unsupported protocol version', async () => {
    const { conn } = await startFixture('unsupported-version.json')
    await expect(conn.initialize()).rejects.toMatchObject({
      code: 'harness_protocol_error'
    })
    await conn.close()
  })
})

describe('AcpSessionManager', () => {
  test('selects a legacy model on create and resume without bypassing Devin permissions', async () => {
    const { conn, requests } = await startFixture('legacy-models.json')
    await conn.initialize()
    const { manager } = makeManager()
    const ctx = makeCtx({ harnessId: 'devin', model: 'legacy-alternative', permissionModeId: 'normal' })
    const first = await manager.ensureSession(ctx, conn)
    expect(first.models?.currentModelId).toBe('legacy-alternative')
    await manager.commit(first, { committedItems: [userItem('turn_1', 'hi')], lastCommittedTurnId: 'turn_1' })
    first.detach()
    const resumed = await manager.ensureSession({ ...ctx, turnId: 'turn_2', items: [userItem('turn_1', 'hi')] }, conn)
    expect(resumed.replayedHistory).toBe(false)
    expect(resumed.models?.currentModelId).toBe('legacy-alternative')
    expect(requests('session/set_model').map((entry) => entry.params)).toEqual([
      { sessionId: first.sessionId, modelId: 'legacy-alternative' }
    ])
    expect(requests('session/set_mode').map((entry) => entry.params?.modeId)).toEqual(['normal'])
    expect(requests('session/set_config_option')).toEqual([])
    resumed.detach()
    await conn.close()
  })

  test('reuses a live session without disk-load capability, and rebases only after reconnect', async () => {
    const { conn, requests } = await startFixture('live-only.json')
    await conn.initialize()
    const { manager } = makeManager()
    const first = await manager.ensureSession(makeCtx({ model: undefined }), conn)
    const history = [userItem('turn_1', 'remember secret')]
    await manager.commit(first, { committedItems: history, lastCommittedTurnId: 'turn_1' })
    first.detach()
    const next = makeCtx({ turnId: 'turn_2', model: undefined, items: history })
    const second = await manager.ensureSession(next, conn)
    expect(second.sessionId).toBe(first.sessionId)
    expect(second.replayedHistory).toBe(false)
    expect(second.preparation.resumed).toBe(true)
    expect(requests('session/new')).toHaveLength(1)
    expect(requests('session/load')).toHaveLength(0)
    second.detach()
    const replacement = await startFixture('live-only.json')
    await replacement.conn.initialize()
    const restored = await manager.ensureSession(next, replacement.conn)
    expect(restored.preparation.rebaseReason).toBe('native_state_unavailable')
    expect(restored.replayedHistory).toBe(true)
    expect(replacement.requests('session/load')).toHaveLength(0)
    expect(replacement.requests('session/new')).toHaveLength(1)
  })

  test('rejects an unadvertised legacy model before a prompt or binding is accepted', async () => {
    const { conn, requests } = await startFixture('legacy-models.json')
    await conn.initialize()
    const { manager, coordinator } = makeManager()
    await expect(manager.ensureSession(makeCtx({ model: 'missing-model' }), conn))
      .rejects.toMatchObject({ code: 'agent_error', message: expect.stringContaining('did not advertise') })
    expect(requests('session/set_model')).toEqual([])
    expect(requests('session/prompt')).toEqual([])
    expect((await coordinator.store.load('thread_1'))?.nativeSessionId).toBeUndefined()
    expect(conn.sessionThreadIds()).toEqual([])
    await conn.close()
  })

  test('session/new applies matching config options exactly', async () => {
    const { conn, journal } = await startFixture('basic-chat.json')
    await conn.initialize()
    const { manager } = makeManager()
    const session = await manager.ensureSession(makeCtx(), conn)
    expect(session.sessionId).toBe('sess-basic')
    expect(session.replayedHistory).toBe(true)
    // fake-model-2 exists in the model option's values → set once.
    const sets = journal().filter((entry) => entry.frame?.kind === 'configSet')
    expect(sets).toHaveLength(1)
    expect(sets[0].frame?.params).toMatchObject({
      configId: 'model',
      value: 'fake-model-2'
    })
    await conn.close()
  })

  test('a model value absent from the option list is never guessed', async () => {
    const { conn, journal } = await startFixture('basic-chat.json')
    await conn.initialize()
    const { manager } = makeManager()
    await expect(manager.ensureSession(
      makeCtx({ model: 'model-not-offered' }),
      conn
    )).rejects.toMatchObject({ code: 'agent_error', message: expect.stringContaining('does not offer') })
    expect(
      journal().filter((entry) => entry.frame?.kind === 'configSet')
    ).toHaveLength(0)
    await conn.close()
  })

  test('legacy modes fallback sets the mode when no config options exist', async () => {
    const { conn, journal } = await startFixture('no-config.json')
    await conn.initialize()
    const { manager } = makeManager()
    await manager.ensureSession(
      makeCtx({ model: undefined, permissionModeId: 'auto' }),
      conn
    )
    const sets = journal().filter((entry) => entry.frame?.kind === 'configSet')
    expect(sets).toHaveLength(1)
    expect(sets[0].frame?.params).toMatchObject({
      modeId: 'auto'
    })
    await conn.close()
  })

  test('a bound native session resumes via session/load without replay reaching the sink', async () => {
    const { conn, journal } = await startFixture('load-replay.json')
    await conn.initialize()
    const { manager, coordinator } = makeManager()
    // Seed a committed binding for the exact route ensureSession will compute.
    const first = await manager.ensureSession(
      makeCtx({ turnId: 'turn_0', model: undefined }),
      conn
    )
    await manager.commit(first, {
      committedItems: [userItem('turn_0', 'earlier')],
      lastCommittedTurnId: 'turn_0'
    })
    // Replace the seeded nativeSessionId with the fixture's loadable id.
    const binding = await coordinator.store.load('thread_1')
    await coordinator.store.save({ ...binding!, nativeSessionId: 'sess-loadable' })

    // A new connection must restore the persisted session once.
    const restoredConnection = await startFixture('load-replay.json')
    await restoredConnection.conn.initialize()
    const sink: SessionUpdate[] = []
    const second = await manager.ensureSession(
      makeCtx({
        turnId: 'turn_1',
        model: undefined,
        items: [userItem('turn_0', 'earlier'), userItem('turn_1', 'now')]
      }),
      restoredConnection.conn,
      (update) => sink.push(update as SessionUpdate)
    )
    expect(second.sessionId).toBe('sess-loadable')
    expect(second.phase).toBe('ready')
    expect(second.replayedHistory).toBe(false)
    expect(requestsOf(restoredConnection.journal, 'session/load')).toHaveLength(1)
    // Replayed user/agent/tool_call updates were filtered in loading phase.
    expect(sink).toHaveLength(0)
    // config_option_update during load was absorbed.
    expect(second.configOptions?.[0]?.id).toBe('model')
    expect(second.sawAvailableCommands).toBe(true)
    await conn.close()
  })

  test('session/load failure falls back to session/new via rejectResume', async () => {
    const { conn, journal } = await startFixture('load-fails.json')
    await conn.initialize()
    const { manager, coordinator } = makeManager()
    const first = await manager.ensureSession(
      makeCtx({ turnId: 'turn_0', model: undefined }),
      conn
    )
    await manager.commit(first, {
      committedItems: [userItem('turn_0', 'earlier')],
      lastCommittedTurnId: 'turn_0'
    })
    const binding = await coordinator.store.load('thread_1')
    await coordinator.store.save({ ...binding!, nativeSessionId: 'sess-gone' })

    const second = await manager.ensureSession(
      makeCtx({
        turnId: 'turn_1',
        model: undefined,
        items: [userItem('turn_0', 'earlier'), userItem('turn_1', 'now')]
      }),
      conn
    )
    expect(requestsOf(journal, 'session/load')).toHaveLength(1)
    expect(requestsOf(journal, 'session/new')).toHaveLength(2)
    expect(second.sessionId).toBe('sess-load-fails')
    expect(second.replayedHistory).toBe(true)
    expect(second.preparation.rebaseReason).toBe('native_state_unavailable')
    await conn.close()
  })
})

function requestsOf(
  journal: () => JournalEntry[],
  method: string
): JournalEntry[] {
  return journal().filter(
    (entry) => entry.dir === 'in' && entry.frame?.method === method
  )
}

describe('AcpConnectionPool', () => {
  test('two acquires on the same key share one process', async () => {
    const { conn } = await startFixture('basic-chat.json')
    let factoryCalls = 0
    const pool = new AcpConnectionPool({ idleReleaseMs: 5_000 })
    const key = 'gemini-cli:cred-1'
    const leaseA = await pool.acquire(key, async () => {
      factoryCalls += 1
      return conn
    })
    const leaseB = await pool.acquire(key, async () => {
      factoryCalls += 1
      return conn
    })
    expect(factoryCalls).toBe(1)
    expect(leaseA.connection).toBe(leaseB.connection)
    leaseA.release()
    leaseB.release()
    await pool.dispose()
  })

  test('process exit evicts the entry and fires onExit', async () => {
    const { conn } = await startFixture('basic-chat.json')
    const pool = new AcpConnectionPool({ idleReleaseMs: 5_000 })
    const key = 'gemini-cli:cred-1'
    const lease = await pool.acquire(key, async () => conn)
    const exits: Array<{ code: number | null }> = []
    pool.onExit(key, (exit) => exits.push(exit))
    conn.process.child.kill('SIGKILL')
    await conn.process.exit
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(exits).toHaveLength(1)
    // Entry evicted: next acquire must run the factory again.
    let factoryCalls = 0
    const proc2 = await startFixture('basic-chat.json')
    await pool.acquire(key, async () => {
      factoryCalls += 1
      return proc2.conn
    })
    expect(factoryCalls).toBe(1)
    lease.release()
    await pool.dispose()
  })

  test('connection exit preserves disk-backed native sessions for restore', async () => {
    const { conn } = await startFixture('basic-chat.json')
    await conn.initialize()
    const { manager, coordinator } = makeManager()
    const session = await manager.ensureSession(
      makeCtx({ model: undefined }),
      conn
    )
    await manager.commit(session, {
      committedItems: [userItem('turn_1', 'hi')],
      lastCommittedTurnId: 'turn_1'
    })
    const before = await coordinator.store.load('thread_1')
    expect(before?.nativeSessionId).toBe('sess-basic')

    await manager.handleConnectionExit(conn, 'gemini-cli')

    const after = await coordinator.store.load('thread_1')
    expect(after?.nativeSessionId).toBe('sess-basic')
    const preparation = await coordinator.prepare({
      threadId: 'thread_1',
      route: {
        providerKind: 'acp',
        providerId: 'gemini-cli',
        credentialIdentity: conn.identity,
        workspace: '/tmp/work',
        model: 'default',
        capabilityFingerprint: after!.capabilityFingerprint,
        continuationMode: 'native'
      },
      priorItems: [userItem('turn_1', 'hi')]
    })
    expect(preparation.resumed).toBe(true)
    expect(preparation.rebaseReason).toBeUndefined()
    await conn.close()
  })
})

describe('capabilitiesFromAcp', () => {
  const init = {
    protocolVersion: 1,
    agentCapabilities: {
      loadSession: true,
      promptCapabilities: { image: true, embeddedContext: false }
    }
  }

  test('derives statuses from initialize + session facts', () => {
    const caps = capabilitiesFromAcp(
      init,
      {
        configOptions: [
          {
            id: 'model',
            name: 'Model',
            category: 'model',
            type: 'select',
            currentValue: 'a',
            options: [{ value: 'a', name: 'A' }]
          },
          {
            id: 'think',
            name: 'Think',
            category: 'thought_level',
            type: 'select',
            currentValue: 'low',
            options: [{ value: 'low', name: 'Low' }]
          }
        ] as never,
        sawAvailableCommands: true,
        sawUsageTokens: true,
        sawUsageTelemetry: true
      },
      { sandbox: 'native' }
    )
    expect(caps.statuses.nativeResume.supported).toBe(true)
    expect(caps.statuses.imageInput.supported).toBe(true)
    expect(caps.statuses.fileInput.supported).toBe(false)
    expect(caps.statuses.switchModelMidSession.supported).toBe(true)
    expect(caps.statuses.effort.supported).toBe(true)
    expect(caps.statuses.nativeCommands.supported).toBe(true)
    expect(caps.statuses.sameTurnSteer.supported).toBe(false)
    expect(caps.statuses.fork.supported).toBe(false)
    expect(caps.facts).toEqual({
      sandbox: 'native',
      usageReporting: 'exact',
      compactionOwner: 'harness'
    })
  })

  test('kunTools follows the delivered descriptor, never a bare claim', () => {
    const base = { sandbox: 'native' as const }
    expect(capabilitiesFromAcp(init, {}, base).statuses.kunTools.supported).toBe(false)
    for (const kunToolsDescriptor of ['stdio', 'http'] as const) {
      expect(
        capabilitiesFromAcp(init, { kunToolsDescriptor }, base).statuses.kunTools.supported
      ).toBe(true)
    }
    expect(
      capabilitiesFromAcp(init, { kunToolsDescriptor: 'none' }, base).statuses.kunTools.supported
    ).toBe(false)
  })

  test('userInput requires an agent-declared elicitation capability', () => {
    const base = { sandbox: 'native' as const }
    expect(capabilitiesFromAcp(init, {}, base).statuses.userInput.supported).toBe(false)
    for (const elicitation of [true, { form: {} }]) {
      const caps = capabilitiesFromAcp(
        { ...init, agentCapabilities: { ...init.agentCapabilities, elicitation } },
        {},
        base
      )
      expect(caps.statuses.userInput.supported).toBe(true)
    }
    const refused = capabilitiesFromAcp(
      { ...init, agentCapabilities: { ...init.agentCapabilities, elicitation: false } },
      {},
      base
    )
    expect(refused.statuses.userInput.supported).toBe(false)
  })

  test('modes derive from config option category or legacy modes list', () => {
    const withModes = capabilitiesFromAcp(
      init,
      {
        modes: {
          currentModeId: 'a',
          availableModes: [{ id: 'a', name: 'A' }]
        } as never
      },
      { sandbox: 'none' }
    )
    expect(withModes.statuses.modes.supported).toBe(true)
    const without = capabilitiesFromAcp(init, {}, { sandbox: 'none' })
    expect(without.statuses.modes.supported).toBe(false)
    expect(without.statuses.nativeResume.supported).toBe(true)
    expect(without.facts.usageReporting).toBe('none')
  })
})
