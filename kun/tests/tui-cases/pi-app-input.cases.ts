import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { visibleWidth } from '@earendil-works/pi-tui'
import { providerCatalogEntries } from '@kun/provider-catalog'
import { ThreadSchema } from '../../src/contracts/threads.js'
import { buildRuntimeCapabilityManifest } from '../../src/contracts/capabilities.js'
import type { RuntimeEvent } from '../../src/contracts/events.js'
import type { TurnItem } from '../../src/contracts/items.js'
import type { ModelConnectionSnapshot } from '../../src/contracts/model-connections.js'
import { emptyUsageSnapshot } from '../../src/contracts/usage.js'
import { modelCapabilitiesForModel } from '../../src/loop/model-context-profile.js'
import { TuiClientError, type KunTuiClient, type ThreadDetail, type TuiConnection } from '../../src/tui/client.js'
import { TuiController } from '../../src/tui/controller.js'
import { testTuiGraphRun } from '../../src/tui/graph-mode.test-support.js'
import { parseTuiKeymapConfig } from '../../src/tui/keymap.js'
import { sanitizeTerminalText } from '../../src/tui/layout.js'
import type { TuiOptions } from '../../src/tui/options.js'
import {
  parseSgrMouseEvent,
  GraphBoardDialog,
  imagePasteShortcutLabel,
  openBrowser,
  authenticationStrategy,
  PermissionDialog,
  PiTuiApplication,
  renderActivityRow,
  renderGraphProgressRow,
  renderKunComposerFrame,
  renderKunThinking,
  renderKunWelcome,
  renderKunWordmark,
  TranscriptComponent,
  writeLocalShareSnapshot
} from '../../src/tui/pi-app.js'
import { acquireRuntimeDataDirMigrationLock } from '../../src/server/runtime-data-dir-migration-lock.js'
import { projectThreadSnapshot } from '../../src/tui/state.js'
import type { TerminalInput, TerminalOutput } from '../../src/tui/pi-terminal.js'

function detail(): ThreadDetail {
  return {
    ...ThreadSchema.parse({
      id: 'thr_pi', title: 'Narrow thread', workspace: '/tmp/project', model: 'model-a',
      mode: 'agent', status: 'idle', approvalPolicy: 'on-request', sandboxMode: 'workspace-write',
      createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z', turns: []
    }),
    latestSeq: 0,
    pendingUserInputIds: []
  }
}

function testToolCall(input: {
  id: string
  turnId: string
  toolName: string
  createdAt: string
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'aborted'
  toolKind?: 'tool_call' | 'command_execution' | 'file_change'
  arguments?: Record<string, unknown>
  finishedAt?: string
}): Extract<TurnItem, { kind: 'tool_call' }> {
  return {
    id: input.id,
    threadId: 'thr_pi',
    turnId: input.turnId,
    role: 'assistant',
    status: input.status ?? 'completed',
    createdAt: input.createdAt,
    ...(input.finishedAt ? { finishedAt: input.finishedAt } : {}),
    kind: 'tool_call',
    toolName: input.toolName,
    callId: input.id,
    toolKind: input.toolKind ?? 'tool_call',
    arguments: input.arguments ?? {}
  }
}

function testToolResult(input: {
  id: string
  turnId: string
  toolName: string
  createdAt: string
  output?: unknown
  isError?: boolean
  toolKind?: 'tool_call' | 'command_execution' | 'file_change'
  finishedAt?: string
}): Extract<TurnItem, { kind: 'tool_result' }> {
  return {
    id: `result_${input.id}`,
    threadId: 'thr_pi',
    turnId: input.turnId,
    role: 'tool',
    status: 'completed',
    createdAt: input.createdAt,
    ...(input.finishedAt ? { finishedAt: input.finishedAt } : {}),
    kind: 'tool_result',
    toolName: input.toolName,
    callId: input.id,
    toolKind: input.toolKind ?? 'tool_call',
    output: input.output ?? 'ok',
    isError: input.isError ?? false
  }
}

const runtime = {
  baseUrl: 'http://127.0.0.1:18899', runtimeToken: 'secret', discovered: true,
  runtimeInfo: {
    host: '127.0.0.1', port: 18899, dataDir: '/tmp/data', model: 'model-a',
    instanceId: 'runtime_pi', serviceVersion: '1', launchMode: 'shared',
    startedAt: '2026-07-22T00:00:00.000Z', pid: 123,
    capabilities: {}
  }
} as unknown as TuiConnection

const options: TuiOptions = {
  runtimeToken: 'secret', dataDir: '/tmp/data', workspace: '/tmp/project',
  continueLatest: true, noStart: false, help: false
}

function modelSnapshot(): ModelConnectionSnapshot {
  return {
    schemaVersion: 1,
    proxyRoutingVersion: 1,
    revision: 3,
    providers: [
      {
        id: 'deepseek', accountId: 'account:deepseek', name: 'DeepSeek', kind: 'http',
        authType: 'api-key', baseUrl: 'https://api.deepseek.com', endpointFormat: 'chat_completions',
        useProxy: false, configured: true, models: ['deepseek-v4-pro'], selectedModel: 'deepseek-v4-pro'
      },
      {
        id: 'kimi-code', accountId: 'account:kimi-code', name: 'Kimi Code', kind: 'http',
        authType: 'subscription', baseUrl: 'https://api.kimi.com/coding/v1', endpointFormat: 'chat_completions',
        useProxy: false, configured: true, models: ['kimi-k2.5', 'kimi-k2-thinking'], selectedModel: 'kimi-k2.5'
      }
    ],
    defaultProviderId: 'deepseek', defaultAccountId: 'account:deepseek', defaultModel: 'deepseek-v4-pro',
    proxy: { enabled: false, url: '' }, routePools: [], localModelGateway: { enabled: false }
  }
}

function renderAssistantMessage(text: string, width: number, running = false): string[] {
  const current = detail()
  const status = running ? 'running' as const : 'completed' as const
  current.status = running ? 'running' : 'idle'
  current.turns = [{
    id: 'turn_markdown',
    threadId: current.id,
    status,
    orchestration: 'direct',
    prompt: 'Show code',
    steering: [],
    createdAt: current.createdAt,
    startedAt: current.createdAt,
    ...(running ? {} : { finishedAt: current.createdAt }),
    items: [{
      id: 'answer_markdown',
      threadId: current.id,
      turnId: 'turn_markdown',
      role: 'assistant',
      status,
      createdAt: current.createdAt,
      ...(running ? {} : { finishedAt: current.createdAt }),
      kind: 'assistant_text',
      text
    }],
    attachmentIds: [],
    activeSkillIds: [],
    injectedMemoryIds: [],
    injectedMemorySummaries: [],
    injectedInstructionSources: []
  }]
  const transcript = new TranscriptComponent()
  transcript.update(projectThreadSnapshot(current), false, false)
  return transcript.render(width)
}

function type(input: EventEmitter, text: string): void {
  for (const character of text) input.emit('data', character)
  input.emit('data', '\r')
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for TUI output')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe("PiTuiApplication input, exit, steering, and timeline", () => {
  it('resolves approval and structured user-input dialogs and returns focus to the composer', async () => {
    const current = detail()
    let onEvent: ((event: RuntimeEvent) => void) | undefined
    const decideApproval = vi.fn(async () => ({ approvalId: 'approval_pi', status: 'allowed' }))
    const resolveUserInput = vi.fn(async () => ({ inputId: 'input_pi', status: 'submitted' }))
    const startTurn = vi.fn(async () => ({ turnId: 'turn_after_dialogs' }))
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
      subscribeThreadEvents: vi.fn(async (input: {
        signal: AbortSignal
        onEvent: (event: RuntimeEvent) => void
      }) => {
        onEvent = input.onEvent
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] })),
      decideApproval,
      resolveUserInput,
      startTurn
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options, runtime)
    await controller.start()

    const input = Object.assign(new EventEmitter(), {
      isRaw: false, setRawMode: vi.fn(), setEncoding: vi.fn(), resume: vi.fn(), pause: vi.fn()
    }) as unknown as TerminalInput
    let outputText = ''
    const output = Object.assign(new EventEmitter(), {
      columns: 48, rows: 18, write: (chunk: string) => { outputText += chunk }
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(controller, input, output)
    const running = app.run()
    const eventBase = {
      timestamp: '2026-07-22T00:03:00.000Z', threadId: current.id, turnId: 'turn_gate'
    }
    try {
      onEvent?.({
        ...eventBase, kind: 'approval_requested', seq: 1, approvalId: 'approval_pi',
        toolName: 'bash', status: 'pending', summary: 'Run the focused tests'
      })
      await waitFor(() => outputText.includes('Approval required') && outputText.includes('Run the focused tests'))
      input.emit('data', 'y')
      await waitFor(() => decideApproval.mock.calls.length === 1)
      expect(decideApproval).toHaveBeenCalledWith('approval_pi', 'allow')
      onEvent?.({
        ...eventBase, kind: 'approval_resolved', seq: 2, approvalId: 'approval_pi',
        toolName: 'bash', status: 'allowed', summary: 'Run the focused tests'
      })
      await waitFor(() => controller.state.projection?.pendingApproval === undefined)

      const beforeInput = outputText.length
      onEvent?.({
        ...eventBase, kind: 'user_input_requested', seq: 3, inputId: 'input_pi', status: 'pending',
        prompt: 'Choose a release channel',
        questions: [{
          id: 'channel', header: 'Release channel', question: 'Where should Kun publish?',
          options: [
            { label: 'Preview', description: 'Internal testers' },
            { label: 'Stable', description: 'All users' }
          ]
        }]
      })
      await waitFor(() => outputText.slice(beforeInput).includes('Release channel'))
      input.emit('data', '\x0e') // Ctrl+N selects the next option inside the modal.
      input.emit('data', '\r')
      await waitFor(() => resolveUserInput.mock.calls.length === 1)
      expect(resolveUserInput).toHaveBeenCalledWith('input_pi', [{
        id: 'channel', label: 'Stable', value: 'Stable'
      }])
      onEvent?.({
        ...eventBase, kind: 'user_input_resolved', seq: 4, inputId: 'input_pi', status: 'submitted',
        answers: [{ id: 'channel', label: 'Stable', value: 'Stable' }]
      })
      await waitFor(() => controller.state.projection?.pendingUserInput === undefined)

      type(input, 'composer focus restored')
      await waitFor(() => startTurn.mock.calls.length === 1)
      expect(startTurn).toHaveBeenCalledWith('thr_pi', expect.objectContaining({ prompt: 'composer focus restored' }))
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })

  it('opens the current draft with Ctrl+G, restores terminal ownership, and keeps the edited result', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-pi-editor-'))
    const script = join(directory, 'editor.mjs')
    await writeFile(script, "import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[2], 'edited draft\\n')\n")
    vi.stubEnv('EDITOR', `"${process.execPath}" "${script}"`)

    const current = detail()
    const startTurn = vi.fn(async () => ({ turnId: 'turn_edited' }))
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] })),
      startTurn
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options, runtime)
    await controller.start()

    const rawModes: boolean[] = []
    const input = Object.assign(new EventEmitter(), {
      isRaw: false,
      setRawMode: vi.fn((mode: boolean) => { rawModes.push(mode) }),
      setEncoding: vi.fn(),
      resume: vi.fn(),
      pause: vi.fn()
    }) as unknown as TerminalInput
    let outputText = ''
    const output = Object.assign(new EventEmitter(), {
      columns: 60,
      rows: 20,
      write: (chunk: string) => { outputText += chunk }
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(controller, input, output)
    const running = app.run()
    try {
      for (const character of 'seed') input.emit('data', character)
      input.emit('data', '\x07')
      await waitFor(() => outputText.includes('edited draft'), 10_000)
      expect(rawModes).toEqual(expect.arrayContaining([true, false]))
      const releasedAt = rawModes.indexOf(false)
      expect(rawModes.slice(releasedAt + 1)).toContain(true)

      input.emit('data', '\r')
      await waitFor(() => startTurn.mock.calls.length === 1)
      expect(startTurn).toHaveBeenCalledWith('thr_pi', expect.objectContaining({ prompt: 'edited draft' }))
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
      vi.unstubAllEnvs()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('requires a matching second Ctrl+C or Ctrl+D to exit and disarms on other input', async () => {
    const current = detail()
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
      subscribeThreadEvents: vi.fn(async (input: {
        signal: AbortSignal
        onConnection: (state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected') => void
      }) => {
        input.onConnection('connected')
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] }))
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options, runtime)
    await controller.start()
    const input = Object.assign(new EventEmitter(), {
      isRaw: false, setRawMode: vi.fn(), setEncoding: vi.fn(), resume: vi.fn(), pause: vi.fn()
    }) as unknown as TerminalInput
    let outputText = ''
    const output = Object.assign(new EventEmitter(), {
      columns: 72, rows: 22, write: (chunk: string) => { outputText += chunk }
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(controller, input, output)
    const running = app.run()
    try {
      input.emit('data', '\x03')
      await waitFor(() => outputText.includes('Press Ctrl+C again to exit'))
      expect(controller.state.quitRequested).toBe(false)

      input.emit('data', 'x')
      input.emit('data', '\x03') // Non-empty Ctrl+C clears the draft.
      expect(controller.state.quitRequested).toBe(false)

      input.emit('data', '\x04')
      await waitFor(() => outputText.includes('Press Ctrl+D again to exit'))
      expect(controller.state.quitRequested).toBe(false)
      input.emit('data', '\x04')
      await running
      expect(controller.state.quitRequested).toBe(true)
    } finally {
      controller.requestQuit()
      await app.stop()
      await controller.stop()
    }
  })

  it('uses consecutive idle Escape for safe undo and Ctrl+O for tool details', async () => {
    const current = detail()
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
      subscribeThreadEvents: vi.fn(async (input: {
        signal: AbortSignal
        onConnection: (state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected') => void
      }) => {
        input.onConnection('connected')
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] }))
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options, runtime)
    await controller.start()
    const undo = vi.spyOn(controller, 'undoLastTurn').mockResolvedValue()
    const input = Object.assign(new EventEmitter(), {
      isRaw: false, setRawMode: vi.fn(), setEncoding: vi.fn(), resume: vi.fn(), pause: vi.fn()
    }) as unknown as TerminalInput
    let outputText = ''
    const output = Object.assign(new EventEmitter(), {
      columns: 72, rows: 22, write: (chunk: string) => { outputText += chunk }
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(controller, input, output)
    const running = app.run()
    try {
      input.emit('data', '\x1b')
      await waitFor(() => outputText.includes('Press Esc again to undo the last turn'))
      expect(undo).not.toHaveBeenCalled()
      input.emit('data', '\x1b')
      await waitFor(() => undo.mock.calls.length === 1)

      input.emit('data', '\x0f')
      await waitFor(() => outputText.includes('Tool details expanded'))
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })

  it('uses contextual Ctrl+B to background the latest foreground subagent', async () => {
    const current = detail()
    const childRun = {
      id: 'child_foreground',
      parentThreadId: current.id,
      parentTurnId: 'turn_parent',
      label: 'Inspect runtime',
      prompt: 'Inspect the runtime',
      profile: 'researcher',
      status: 'running' as const,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      createdAt: current.createdAt,
      startedAt: current.createdAt,
      updatedAt: current.updatedAt
    }
    const detachDelegation = vi.fn(async () => ({ childId: childRun.id, detached: true }))
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
      delegationDiagnostics: vi.fn(async () => ({
        enabled: true,
        active: 1,
        childRuns: [childRun],
        aggregates: []
      })),
      detachDelegation,
      subscribeThreadEvents: vi.fn(async (input: {
        signal: AbortSignal
        onConnection: (state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected') => void
      }) => {
        input.onConnection('connected')
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] }))
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options, runtime)
    await controller.start()
    const input = Object.assign(new EventEmitter(), {
      isRaw: false, setRawMode: vi.fn(), setEncoding: vi.fn(), resume: vi.fn(), pause: vi.fn()
    }) as unknown as TerminalInput
    let outputText = ''
    const output = Object.assign(new EventEmitter(), {
      columns: 88, rows: 24, write: (chunk: string) => { outputText += chunk }
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(controller, input, output)
    const running = app.run()
    try {
      input.emit('data', '\x02')
      await waitFor(() => detachDelegation.mock.calls.length === 1)
      expect(detachDelegation).toHaveBeenCalledWith(childRun.id)
      await waitFor(() => controller.state.notification?.message.includes('continuing in the background') === true)
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })

  it('sends a non-empty Ctrl+S draft through the running-turn steering queue', async () => {
    const current = detail()
    current.status = 'running'
    current.turns = [{
      id: 'turn_running',
      threadId: current.id,
      status: 'running',
      orchestration: 'direct',
      prompt: 'initial task',
      steering: [],
      createdAt: current.createdAt,
      startedAt: current.createdAt,
      attachmentIds: [],
      activeSkillIds: [],
      injectedMemoryIds: [],
      injectedMemorySummaries: [],
      injectedInstructionSources: [],
      items: []
    }]
    const steerTurn = vi.fn(async () => undefined)
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
      steerTurn,
      subscribeThreadEvents: vi.fn(async (input: {
        signal: AbortSignal
        onConnection: (state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected') => void
      }) => {
        input.onConnection('connected')
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] }))
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options, runtime)
    await controller.start()
    const input = Object.assign(new EventEmitter(), {
      isRaw: false, setRawMode: vi.fn(), setEncoding: vi.fn(), resume: vi.fn(), pause: vi.fn()
    }) as unknown as TerminalInput
    const output = Object.assign(new EventEmitter(), {
      columns: 80, rows: 24, write: vi.fn()
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(controller, input, output)
    const running = app.run()
    try {
      for (const character of 'focus on the failing test') input.emit('data', character)
      input.emit('data', '\x13')
      await waitFor(() => steerTurn.mock.calls.length === 1)
      expect(steerTurn).toHaveBeenCalledWith('thr_pi', 'turn_running', 'focus on the failing test')
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })

  it('treats empty Ctrl+C like Escape while a turn is running', async () => {
    const current = detail()
    current.status = 'running'
    current.turns = [{
      id: 'turn_running',
      threadId: current.id,
      status: 'running',
      orchestration: 'direct',
      prompt: 'initial task',
      steering: [],
      createdAt: current.createdAt,
      startedAt: current.createdAt,
      attachmentIds: [],
      activeSkillIds: [],
      injectedMemoryIds: [],
      injectedMemorySummaries: [],
      injectedInstructionSources: [],
      items: []
    }]
    const interruptTurn = vi.fn(async () => undefined)
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
      interruptTurn,
      subscribeThreadEvents: vi.fn(async (input: {
        signal: AbortSignal
        onConnection: (state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected') => void
      }) => {
        input.onConnection('connected')
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] }))
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options, runtime)
    await controller.start()
    const input = Object.assign(new EventEmitter(), {
      isRaw: false, setRawMode: vi.fn(), setEncoding: vi.fn(), resume: vi.fn(), pause: vi.fn()
    }) as unknown as TerminalInput
    const output = Object.assign(new EventEmitter(), {
      columns: 80, rows: 24, write: vi.fn()
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(controller, input, output)
    const running = app.run()
    try {
      input.emit('data', '\x03')
      await waitFor(() => interruptTurn.mock.calls.length === 1)
      expect(interruptTurn).toHaveBeenCalledWith('thr_pi', 'turn_running')
      expect(controller.state.quitRequested).toBe(false)
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })

  it('opens a selected live timeline turn and exports the authoritative transcript', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-pi-export-'))
    const exportPath = join(directory, 'thread.md')
    const current = detail()
    current.turns = [{
      id: 'turn_live', threadId: current.id, status: 'completed', orchestration: 'direct', prompt: 'inspect live state', steering: [],
      createdAt: current.createdAt, finishedAt: current.updatedAt, attachmentIds: [], activeSkillIds: [],
      injectedMemoryIds: [], injectedMemorySummaries: [], injectedInstructionSources: [],
      items: [{
        id: 'item_user', turnId: 'turn_live', threadId: current.id, role: 'user', status: 'completed',
        createdAt: current.createdAt, kind: 'user_message', text: 'inspect live state'
      }, {
        id: 'item_assistant', turnId: 'turn_live', threadId: current.id, role: 'assistant', status: 'completed',
        createdAt: current.createdAt, kind: 'assistant_text', text: 'live answer'
      }]
    }]
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] }))
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options, runtime)
    await controller.start()

    const input = Object.assign(new EventEmitter(), {
      isRaw: false, setRawMode: vi.fn(), setEncoding: vi.fn(), resume: vi.fn(), pause: vi.fn()
    }) as unknown as TerminalInput
    let outputText = ''
    const output = Object.assign(new EventEmitter(), {
      columns: 60, rows: 20, write: (chunk: string) => { outputText += chunk }
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(controller, input, output)
    const running = app.run()
    try {
      type(input, '/jump 1')
      await waitFor(() => outputText.includes('Timeline') && outputText.includes('inspect live state'))
      input.emit('data', '\x1b')

      type(input, `/export ${exportPath}`)
      await vi.waitFor(async () => {
        expect(await readFile(exportPath, 'utf8')).toContain('live answer')
      })
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
