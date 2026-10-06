import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach } from 'vitest'
import type { TurnItem } from '../../src/contracts/items.js'
import type { HarnessDefinition } from '../../src/contracts/harness.js'
import type { RuntimeEvent } from '../../src/contracts/events.js'
import {
  DelegatedSessionCoordinator,
  FileDelegatedSessionBindingStore
} from '../../src/runtime/delegated-session-binding.js'
import {
  ACP_DEFAULT_CAPABILITIES
} from '../../src/harness/builtin-harnesses.js'
import { AcpConnectionPool } from '../../src/runtime/acp/acp-connection-pool.js'
import { AcpClientHost } from '../../src/runtime/acp/acp-client-host.js'
import { AcpSessionManager } from '../../src/runtime/acp/acp-session-manager.js'
import { AcpRuntime, type AcpRuntimeDeps } from '../../src/runtime/acp/acp-runtime.js'

const FIXTURE_AGENT = fileURLToPath(
  new URL('../../src/runtime/acp/__fixtures__/fake-acp-agent.mjs', import.meta.url)
)
const SCENARIOS = fileURLToPath(
  new URL('../../src/runtime/acp/__fixtures__/scenarios/', import.meta.url)
)

export const tempDirs: string[] = []
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

export type Harness = Awaited<ReturnType<typeof makeHarness>>

export async function makeHarness(scenarioFile: string, input: {
  turn?: Record<string, unknown>
  thread?: Record<string, unknown>
  items?: TurnItem[]
  deps?: Partial<AcpRuntimeDeps>
  definition?: Partial<HarnessDefinition>
  /** Invoked inside applyAssistantDelta — lets tests abort mid-stream. */
  onDelta?: () => void
} = {}): Promise<{
  runtime: AcpRuntime
  definition: HarnessDefinition
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
    // The fixture delegates tool approvals to the client; some scenarios
    // additionally expose an Ask mode under the native id `ask`.
    acpPermission: { requireMode: false, modeAliases: { default: ['ask'] } },
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
    builtin: true,
    ...input.definition
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
    catalog: { get: (id) => (id === 'fake-acp' || id === definition.id ? definition : undefined) },
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
    definition,
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
