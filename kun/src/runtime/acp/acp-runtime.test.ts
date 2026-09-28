import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import type { TurnItem } from '../../contracts/items.js'
import type { HarnessDefinition } from '../../contracts/harness.js'
import type { RuntimeEvent } from '../../contracts/events.js'
import {
  DelegatedSessionCoordinator,
  FileDelegatedSessionBindingStore
} from '../delegated-session-binding.js'
import { ACP_DEFAULT_CAPABILITIES } from '../../harness/builtin-harnesses.js'
import { AcpConnectionPool } from './acp-connection-pool.js'
import { AcpClientHost } from './acp-client-host.js'
import { AcpSessionManager } from './acp-session-manager.js'
import { AcpRuntime, type AcpRuntimeDeps } from './acp-runtime.js'
import { KunToolsMcpProvider } from './kun-tools-mcp.js'
import { HarnessTokenService } from '../../harness/harness-token-service.js'

const FIXTURE_AGENT = fileURLToPath(
  new URL('./__fixtures__/fake-acp-agent.mjs', import.meta.url)
)
const SCENARIOS = fileURLToPath(
  new URL('./__fixtures__/scenarios/', import.meta.url)
)

const tempDirs: string[] = []
const pools: AcpConnectionPool[] = []
afterEach(async () => {
  for (const pool of pools.splice(0)) await pool.dispose().catch(() => undefined)
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

type JournalEntry = {
  dir: string
  frame?: {
    method?: string
    kind?: string
    params?: Record<string, unknown>
    response?: Record<string, unknown>
  }
}

type Harness = Awaited<ReturnType<typeof makeHarness>>

async function makeHarness(scenarioFile: string, input: {
  turn?: Record<string, unknown>
  thread?: Record<string, unknown>
  items?: TurnItem[]
  deps?: Partial<AcpRuntimeDeps>
  /** Invoked inside applyAssistantDelta — lets tests abort mid-stream. */
  onDelta?: () => void
} = {}): Promise<{
  runtime: AcpRuntime
  thread: { turns: Array<Record<string, unknown>> }
  workspace: string
  journalPath: string
  journal(): JournalEntry[]
  requests(method: string): Array<{ params?: Record<string, unknown> }>
  applied: TurnItem[]
  items: TurnItem[]
  deltas: Array<{ text: string; delta: string }>
  finished: Array<{ status: string; error?: string; code?: string }>
  recorded: RuntimeEvent[]
  coordinator: DelegatedSessionCoordinator
}> {
  const dir = mkdtempSync(join(tmpdir(), 'acp-runtime-'))
  tempDirs.push(dir)
  const workspace = join(dir, 'work')
  const journalPath = join(dir, 'journal.jsonl')
  const bindingDir = join(dir, 'bindings')
  const scenarioPath = join(SCENARIOS, scenarioFile)

  const definition = {
    id: 'fake-acp',
    displayName: 'Fake ACP',
    transport: 'acp',
    launch: {
      command: process.execPath,
      args: [FIXTURE_AGENT],
      env: {
        FAKE_ACP_SCENARIO: scenarioPath,
        FAKE_ACP_JOURNAL: journalPath
      }
    },
    credentialModes: ['native-login'],
    permissionModes: [
      { id: 'default', label: 'Default', kunPermissionMode: 'ask-for-approval' },
      { id: 'auto', label: 'Auto', kunPermissionMode: 'full-access' }
    ],
    modelSource: 'static',
    staticModels: [],
    capabilities: ACP_DEFAULT_CAPABILITIES,
    builtin: true
  } as unknown as HarnessDefinition

  const turn = {
    id: 'turn_1',
    harnessId: 'fake-acp',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'running',
    ...input.turn
  }
  const thread = {
    id: 'thread_1',
    turns: [turn],
    workspace,
    harnessId: 'fake-acp',
    ...input.thread
  }
  const applied: TurnItem[] = []
  const deltas: Array<{ text: string; delta: string }> = []
  const finished: Array<{ status: string; error?: string; code?: string }> = []
  const recorded: RuntimeEvent[] = []
  const items: TurnItem[] = [
    ...(input.items ?? [
      {
        id: 'item_turn_1_user',
        threadId: 'thread_1',
        turnId: 'turn_1',
        role: 'user',
        kind: 'user_message',
        status: 'completed',
        createdAt: '2026-01-01T00:00:00.000Z',
        text: 'hello agent'
      } as TurnItem
    ])
  ]

  const coordinator = new DelegatedSessionCoordinator(
    new FileDelegatedSessionBindingStore(bindingDir)
  )
  const pool = new AcpConnectionPool({ idleReleaseMs: 60_000 })
  pools.push(pool)
  const host = new AcpClientHost()
  const manager = new AcpSessionManager({ coordinator })

  let idSeq = 0
  const deps: AcpRuntimeDeps = {
    catalog: { get: (id) => (id === 'fake-acp' ? definition : undefined) },
    threadStore: {
      get: async () => thread
    } as unknown as AcpRuntimeDeps['threadStore'],
    sessionStore: {
      loadItems: async () => items
    } as unknown as AcpRuntimeDeps['sessionStore'],
    turns: {
      applyItem: async (_thread: string, item: TurnItem) => {
        applied.push(item)
        items.push(item)
      },
      applyAssistantDelta: async (
        _thread: string,
        running: TurnItem,
        delta: string
      ) => {
        deltas.push({
          text: 'text' in running ? String(running.text) : '',
          delta
        })
        input.onDelta?.()
      },
      updateItem: async () => ({}),
      finishTurn: async (args: { status: string; error?: string; code?: string }) => {
        finished.push(args)
      },
      updateTurnMetadata: async () => ({}),
      ensureGoalContext: async () => undefined
    } as unknown as AcpRuntimeDeps['turns'],
    events: {
      record: async (event: RuntimeEvent) => {
        recorded.push(event)
      }
    } as unknown as AcpRuntimeDeps['events'],
    ids: { next: (prefix) => `${prefix}_${++idSeq}` },
    sessionCoordinator: coordinator,
    connectionPool: pool,
    clientHost: host,
    sessionManager: manager,
    spawn: async (command, args, options) =>
      spawn(command, [...args], {
        env: options.env as NodeJS.ProcessEnv,
        stdio: options.stdio as ['pipe', 'pipe', 'pipe']
      }),
    ...input.deps
  }

  const readJournal = () =>
    readFileSync(journalPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as JournalEntry)

  return {
    runtime: new AcpRuntime(deps),
    thread: thread as { turns: Array<Record<string, unknown>> },
    workspace,
    journalPath,
    journal: readJournal,
    requests(method: string) {
      return readJournal()
        .filter(
          (entry) => entry.dir === 'in' && entry.frame?.method === method
        )
        .map((entry) => entry.frame as { params?: Record<string, unknown> })
    },
    applied,
    items,
    deltas,
    finished,
    recorded,
    coordinator
  }
}

describe('AcpRuntime.runTurn', () => {
  test('runs a full turn: prompt, streamed text, completion, committed binding', async () => {
    const h = await makeHarness('basic-chat.json')
    const outcome = await h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal
    )
    expect(outcome).toBe('completed')
    expect(h.finished).toHaveLength(1)
    expect(h.finished[0]).toMatchObject({ status: 'completed' })
    // Streamed chunks reached the durable delta path in order.
    expect(h.deltas.map((d) => d.delta).join('')).toBe('Hello world')

    const delegated = h.recorded.filter((e) => e.kind === 'delegated_runtime')
    expect(delegated).toHaveLength(1)
    expect(delegated[0]).toMatchObject({
      providerKind: 'acp',
      harnessId: 'fake-acp',
      phase: 'rebased',
      reason: 'new'
    })

    // session/prompt carried the user text.
    const prompts = h.requests('session/prompt')
    expect(prompts).toHaveLength(1)
    const promptBlocks = prompts[0].params?.prompt as Array<{ text?: string }>
    expect(promptBlocks.some((b) => b.text?.includes('hello agent'))).toBe(true)

    // Binding committed for native resume next turn.
    const binding = await h.coordinator.store.load('thread_1')
    expect(binding?.nativeSessionId).toBe('sess-basic')
  })

  test('rejects a non-ACP harness route', async () => {
    const h = await makeHarness('basic-chat.json', {
      thread: { harnessId: 'not-acp' },
      turn: { harnessId: 'not-acp' }
    })
    const outcome = await h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal
    )
    expect(outcome).toBe('failed')
    expect(h.finished[0]?.code).toBe('route_unsupported')
  })

  test('agent permission request resolves through the approval pipeline', async () => {
    const h = await makeHarness('permission.json', {
      // auto + danger-full-access → shared pipeline auto-allows.
      turn: { approvalPolicy: 'auto', sandboxMode: 'danger-full-access' }
    })
    const outcome = await h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal
    )
    expect(outcome).toBe('completed')
    // allow preferentially maps to the once-only option (§8.4).
    const settled = h
      .journal()
      .find(
        (entry) =>
          entry.dir === 'event' &&
          entry.frame?.kind === 'clientRequestSettled' &&
          entry.frame?.method === 'session/request_permission'
      )
    expect(settled?.frame?.response).toMatchObject({
      result: { outcome: { outcome: 'selected', optionId: 'allow-once' } }
    })
    // The completed tool call reached the timeline.
    expect(
      h.applied.some((item) => item.kind === 'tool_call' && 'callId' in item)
    ).toBe(true)
  })

  test('permission denial picks a reject option', async () => {
    const h = await makeHarness('permission.json', {
      turn: { approvalPolicy: 'never' }
    })
    const outcome = await h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal
    )
    expect(outcome).toBe('completed')
    const settled = h
      .journal()
      .find(
        (entry) =>
          entry.dir === 'event' &&
          entry.frame?.kind === 'clientRequestSettled' &&
          entry.frame?.method === 'session/request_permission'
      )
    expect(settled?.frame?.response).toMatchObject({
      result: { outcome: { outcome: 'selected', optionId: 'reject-once' } }
    })
  })

  test('abort sends session/cancel and ends the turn aborted', async () => {
    const controller = new AbortController()
    const h = await makeHarness('cancel.json', {
      // Abort once the first delta lands — the fixture then sleeps 30s unless
      // session/cancel settles the prompt early.
      onDelta: () => controller.abort(),
      items: [
        {
          id: 'item_turn_1_user',
          threadId: 'thread_1',
          turnId: 'turn_1',
          role: 'user',
          kind: 'user_message',
          status: 'completed',
          createdAt: '2026-01-01T00:00:00.000Z',
          text: 'work slow please'
        } as TurnItem
      ]
    })
    const outcome = await h.runtime.runTurn('thread_1', 'turn_1', controller.signal)
    expect(outcome).toBe('aborted')
    expect(h.finished[0]?.status).toBe('aborted')
    const cancels = h
      .journal()
      .filter(
        (entry) =>
          entry.dir === 'in' && entry.frame?.method === 'session/cancel'
      )
    expect(cancels).toHaveLength(1)
  })

  test('mid-turn process death fails the turn with a sanitized crash error', async () => {
    const h = await makeHarness('crash.json')
    const outcome = await h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal
    )
    expect(outcome).toBe('failed')
    expect(h.finished[0]?.code).toBe('harness_crashed')
    // stderr tail is redacted before it can reach a user-facing error.
    expect(h.finished[0]?.error ?? '').not.toContain('sk-testsecret')
  })

  test('a second turn resumes the bound session via session/load', async () => {
    const h = await makeHarness('resume.json')
    expect(
      await h.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)
    ).toBe('completed')

    // Second turn on the same coordinator: binding resolves to session/load.
    // The new user item lands only after turn_1's commit so the stored
    // history digest stays a strict prefix of turn_2's prior items.
    h.thread.turns.push({ id: 'turn_2', harnessId: 'fake-acp' })
    h.items.push({
      id: 'item_turn_2_user',
      threadId: 'thread_1',
      turnId: 'turn_2',
      role: 'user',
      kind: 'user_message',
      status: 'completed',
      createdAt: '2026-01-01T00:01:00.000Z',
      text: 'second'
    } as TurnItem)
    const outcome = await h.runtime.runTurn(
      'thread_1',
      'turn_2',
      new AbortController().signal
    )
    expect(outcome).toBe('completed')
    expect(h.requests('session/load')).toHaveLength(1)
    // Replayed history during load never reached the timeline.
    expect(h.deltas.map((d) => d.delta).join('')).not.toContain('replayed turn')
    const delegated = h.recorded.filter((e) => e.kind === 'delegated_runtime')
    expect(delegated.at(-1)).toMatchObject({ phase: 'resumed' })
  })

  test('sends an http kun-tools descriptor and revokes the grant at turn end', async () => {
    const tokens = new HarnessTokenService({ secret: Buffer.alloc(32, 9) })
    const provider = new KunToolsMcpProvider({
      tokens,
      endpoint: () => 'http://127.0.0.1:18899',
      command: () => ({ command: '/abs/kun', args: [] })
    })
    let verifiedMidTurn: unknown = 'unset'
    let h: Harness
    h = await makeHarness('basic-chat.json', {
      deps: { kunToolsMcp: provider },
      onDelta: () => {
        // The session/new frame is journaled before prompt streaming starts.
        const servers = h.requests('session/new')[0]?.params?.mcpServers as
          | Array<{ headers?: Array<{ name: string; value: string }> }>
          | undefined
        const bearer = servers?.[0]?.headers
          ?.find((header) => header.name === 'Authorization')
          ?.value.slice('Bearer '.length)
        verifiedMidTurn = bearer
          ? tokens.verifyScope(bearer, 'kun-tools')?.threadId
          : 'missing'
      }
    })
    const outcome = await h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal
    )
    expect(outcome).toBe('completed')
    const servers = h.requests('session/new')[0]?.params?.mcpServers as Array<{
      type: string
      url: string
      headers: Array<{ name: string; value: string }>
    }>
    expect(servers).toHaveLength(1)
    expect(servers[0]).toMatchObject({
      type: 'http',
      url: 'http://127.0.0.1:18899/mcp/kun'
    })
    const token = servers[0].headers
      .find((header) => header.name === 'Authorization')!
      .value.slice('Bearer '.length)
    expect(token.startsWith('kgw_')).toBe(true)
    // Live while the turn streamed, revoked once the turn finished.
    expect(verifiedMidTurn).toBe('thread_1')
    expect(tokens.verify(token)).toBeNull()
  })

  test('falls back to a stdio kun-tools descriptor without http support', async () => {
    const tokens = new HarnessTokenService({ secret: Buffer.alloc(32, 9) })
    const provider = new KunToolsMcpProvider({
      tokens,
      endpoint: () => 'http://127.0.0.1:18899',
      command: () => ({ command: '/abs/kun', args: ['/abs/serve-entry.js'] })
    })
    const h = await makeHarness('no-config.json', {
      deps: { kunToolsMcp: provider }
    })
    const outcome = await h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal
    )
    expect(outcome).toBe('completed')
    const servers = h.requests('session/new')[0]?.params?.mcpServers as Array<{
      type: string
      command: string
      args: string[]
      env: Array<{ name: string; value: string }>
    }>
    expect(servers).toHaveLength(1)
    const server = servers[0]
    expect(server.type).toBe('stdio')
    expect(server.command).toBe('/abs/kun')
    expect(server.args).toEqual([
      '/abs/serve-entry.js',
      'mcp-bridge',
      '--token-env',
      'KUN_TOOLS_TOKEN'
    ])
    const token = server.env.find((e) => e.name === 'KUN_TOOLS_TOKEN')!.value
    expect(token.startsWith('kgw_')).toBe(true)
    expect(tokens.verify(token)).toBeNull()
  })
})
