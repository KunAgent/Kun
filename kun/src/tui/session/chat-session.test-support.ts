import { vi } from 'vitest'
import { ThreadSchema } from '../../contracts/threads.js'
import type { TurnItem } from '../../contracts/items.js'
import type { ModelConnectionSnapshot } from '../../contracts/model-connections.js'
import type { KunTuiClient, ThreadDetail, TuiConnection } from '../client.js'
import { TuiController } from '../controller.js'
import { parseTuiKeymapConfig } from '../keymap.js'
import type { TuiOptions } from '../options.js'
import type { ScrollbackCommit } from '../scrollback-plan.js'
import { ChatSession } from './chat-session.js'
import type { ComposerPort, TerminalPort } from './session-types.js'

const CREATED_AT = '2026-10-18T00:00:00.000Z'

export function sessionThread(items: TurnItem[] = []): ThreadDetail {
  return {
    ...ThreadSchema.parse({
      id: 'thr_session', title: 'Session thread', workspace: '/tmp/project', model: 'model-a',
      mode: 'agent', status: 'idle', approvalPolicy: 'on-request', sandboxMode: 'workspace-write',
      createdAt: CREATED_AT, updatedAt: CREATED_AT, turns: []
    }),
    latestSeq: 0,
    pendingUserInputIds: [],
    turns: items.length ? [{
      id: 'turn_1', threadId: 'thr_session', status: 'completed', orchestration: 'direct', prompt: 'hi',
      steering: [], createdAt: CREATED_AT, startedAt: CREATED_AT, finishedAt: CREATED_AT, items,
      attachmentIds: [], activeSkillIds: [], injectedMemoryIds: [], injectedMemorySummaries: [],
      injectedDirectiveIds: [], injectedDirectiveSummaries: [], injectedInstructionSources: []
    }] : []
  } as unknown as ThreadDetail
}

function modelSnapshot(): ModelConnectionSnapshot {
  return {
    schemaVersion: 1, proxyRoutingVersion: 1, revision: 1,
    providers: [{
      id: 'deepseek', accountId: 'account:deepseek', name: 'DeepSeek', kind: 'http', authType: 'api-key',
      baseUrl: 'https://api.deepseek.com', endpointFormat: 'chat_completions', useProxy: false,
      configured: true, models: ['model-a'], selectedModel: 'model-a'
    }],
    defaultProviderId: 'deepseek', defaultAccountId: 'account:deepseek', defaultModel: 'model-a',
    proxy: { enabled: false, url: '' }, routePools: [], localModelGateway: { enabled: false, exposeProviderModels: false },
    failover: []
  } as unknown as ModelConnectionSnapshot
}

/** Text-only stand-in for the opentui textarea. */
export class FakeComposer implements ComposerPort {
  text = ''
  offset = 0
  getText(): string { return this.text }
  setText(text: string, cursor?: number): void { this.text = text; this.offset = cursor ?? text.length }
  insertText(text: string): void {
    this.text = this.text.slice(0, this.offset) + text + this.text.slice(this.offset)
    this.offset += text.length
  }
  insertNewline(): void { this.insertText('\n') }
  cursor(): { line: number; col: number } {
    const before = this.text.slice(0, this.offset).split('\n')
    return { line: before.length - 1, col: before.at(-1)!.length }
  }
}

export async function startSessionHarness(options: { thread?: ThreadDetail; continueLatest?: boolean } = {}) {
  let current = options.thread
  const client = {
    listThreads: vi.fn(async () => current ? [current] : []),
    createThread: vi.fn(async (input: { title: string }) => {
      current = { ...sessionThread(), title: input.title }
      return current
    }),
    getThread: vi.fn(async () => current!),
    subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal; onConnection: (state: string) => void }) => {
      input.onConnection('connected')
      await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
    }),
    skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] })),
    modelConnections: vi.fn(async () => modelSnapshot()),
    startTurn: vi.fn(async () => ({ turnId: 'turn_new' }))
  } as unknown as KunTuiClient
  const connection = {
    baseUrl: 'http://127.0.0.1:18899', runtimeToken: 'secret', discovered: true,
    runtimeInfo: {
      host: '127.0.0.1', port: 18899, dataDir: '/tmp/data', model: 'model-a', instanceId: 'runtime_session',
      serviceVersion: '1', launchMode: 'shared', startedAt: CREATED_AT, pid: 123, capabilities: {}
    }
  } as unknown as TuiConnection
  const tuiOptions: TuiOptions = {
    runtimeToken: 'secret', dataDir: '/tmp/data', workspace: '/tmp/project',
    continueLatest: options.continueLatest ?? Boolean(options.thread), noStart: false, help: false
  }
  const controller = new TuiController(client, tuiOptions, connection)
  await controller.start()
  const composer = new FakeComposer()
  const terminal: TerminalPort = {
    setTitle: vi.fn(),
    copyToClipboard: vi.fn(() => true),
    setMouseEnabled: vi.fn(),
    suspend: vi.fn(async (work) => work()),
    clearScreen: vi.fn(),
    repaint: vi.fn(),
    size: () => ({ width: 100, height: 30 }),
    suspendProcess: vi.fn()
  }
  const commits: ScrollbackCommit[] = []
  const session = new ChatSession(controller, parseTuiKeymapConfig({}).keymap)
  session.attachComposer(composer)
  session.attachTerminal(terminal)
  session.attachScrollback((next) => commits.push(...next))
  session.setScrollbackReady(true)
  const running = session.run()
  return { client, controller, session, composer, terminal, commits, running }
}
