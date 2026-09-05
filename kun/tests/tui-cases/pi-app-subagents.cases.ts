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

describe("PiTuiApplication subagent rendering and controls", () => {
  it('renders paired tools and nested subagents while keeping the parent turn live', async () => {
    const current = detail()
    current.status = 'running'
    current.turns = [{
      id: 'turn_parent', threadId: current.id, status: 'running', orchestration: 'direct', prompt: 'Investigate', steering: [],
      createdAt: current.createdAt, startedAt: current.createdAt,
      items: [{
        id: 'call_delegate', threadId: current.id, turnId: 'turn_parent', role: 'assistant', status: 'running',
        createdAt: current.createdAt, kind: 'tool_call', toolName: 'delegate_task', callId: 'call_1',
        toolKind: 'tool_call', arguments: { label: 'Inspect streaming', prompt: 'Find the TUI event bug' },
        summary: 'Inspect streaming'
      }], attachmentIds: [], activeSkillIds: [], injectedMemoryIds: [], injectedMemorySummaries: [],
      injectedInstructionSources: []
    }]
    let onEvent: ((event: RuntimeEvent) => void) | undefined
    const client = {
      listThreads: vi.fn(async () => [current]), getThread: vi.fn(async () => current),
      delegationDiagnostics: vi.fn(async () => ({
        enabled: true, active: 1, aggregates: [], childRuns: [{
          id: 'child_1', parentThreadId: current.id, parentTurnId: 'turn_parent',
          label: 'Inspect streaming', prompt: 'Find the TUI event bug', profile: 'researcher',
          status: 'running', createdAt: current.createdAt, updatedAt: current.createdAt
        }]
      })),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal; onEvent: (event: RuntimeEvent) => void }) => {
        onEvent = input.onEvent
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
      columns: 100, rows: 28, write: (chunk: string) => { outputText += chunk }
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(controller, input, output)
    const running = app.run()
    try {
      await waitFor(() => outputText.includes('Subagent · Inspect streaming'))
      expect(outputText).toContain('Delegate')
      expect(outputText).toContain('Working independently')
      const before = outputText.length
      onEvent?.({
        kind: 'turn_completed', seq: 1, timestamp: '2026-07-22T00:00:01.250Z',
        threadId: current.id, turnId: 'turn_parent', status: 'completed', text: 'Found the projection bug',
        child: {
          parentThreadId: current.id, parentTurnId: 'turn_parent', childId: 'child_1',
          childLabel: 'Inspect streaming', childStatus: 'completed', childSeq: 2,
          childProfile: 'researcher', toolInvocations: 3, durationMs: 1250
        }
      })
      await waitFor(() => outputText.slice(before).includes('3 tools'))
      expect(outputText.slice(before)).toContain('Found the projection bug')
      expect(controller.state.projection?.runningTurnId).toBe('turn_parent')
      const beforeResult = outputText.length
      onEvent?.({
        kind: 'item_created', seq: 2, timestamp: '2026-07-22T00:00:01.300Z',
        threadId: current.id, turnId: 'turn_parent', itemId: 'result_delegate',
        item: {
          id: 'result_delegate', threadId: current.id, turnId: 'turn_parent', role: 'tool', status: 'completed',
          createdAt: '2026-07-22T00:00:01.300Z', finishedAt: '2026-07-22T00:00:01.300Z',
          kind: 'tool_result', toolName: 'delegate_task', callId: 'call_1', toolKind: 'tool_call',
          output: { childId: 'child_1', summary: 'Subagent result received' }, isError: false
        }
      })
      await waitFor(() => outputText.slice(beforeResult).includes('Subagent result received'))
      expect(controller.state.projection?.items.filter((item) => item.kind === 'tool_result')).toHaveLength(1)
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })

  it('groups parallel subagents with Kimi-style status and expands them with Ctrl+O state', () => {
    const projection = projectThreadSnapshot(detail())
    projection.childRuns = [
      {
        childId: 'child_research',
        parentTurnId: 'turn_parallel',
        childSeq: 1,
        label: 'Inspect runtime',
        prompt: 'Inspect the runtime event flow in detail',
        profile: 'researcher',
        profileName: 'Researcher',
        status: 'running',
        toolInvocations: 2,
        totalTokens: 2048,
        activity: {
          phase: 'tool',
          label: 'Searching the workspace',
          toolName: 'search',
          startedAt: '2026-07-22T00:00:01.000Z',
          updatedAt: '2026-07-22T00:00:01.000Z'
        },
        startedAt: '2026-07-22T00:00:00.000Z',
        updatedAt: '2026-07-22T00:00:01.000Z'
      },
      {
        childId: 'child_tests',
        parentTurnId: 'turn_parallel',
        childSeq: 2,
        label: 'Run tests',
        prompt: 'Run the focused regression tests',
        profile: 'tester',
        profileName: 'Test Engineer',
        status: 'queued',
        startedAt: '2026-07-22T00:00:00.000Z',
        updatedAt: '2026-07-22T00:00:00.000Z'
      }
    ]
    const transcript = new TranscriptComponent()
    transcript.update(projection, false, false)
    const compact = transcript.render(100, 1)
    const compactText = sanitizeTerminalText(compact.join('\n'))
    expect(compactText).toContain('Running 2 agents')
    expect(compactText).toContain('1 running')
    expect(compactText).toContain('1 waiting')
    expect(compactText).toContain('2 tools')
    expect(compactText).toContain('2.0k tok')
    expect(compactText).toContain('Searching the workspace')
    expect(compactText).toContain('Ctrl+O expand')
    expect(compactText).not.toContain('Inspect the runtime event flow in detail')
    const researcherRow = compact.findIndex((line) => sanitizeTerminalText(line).includes('Researcher'))
    expect(transcript.childAtRenderedRow(researcherRow)?.childId).toBe('child_research')

    transcript.update(projection, false, true)
    const expandedText = sanitizeTerminalText(transcript.render(100, 2).join('\n'))
    expect(expandedText).toContain('Inspect the runtime event flow in detail')
    expect(expandedText).toContain('Ctrl+O collapse')
  })

  it('opens a delegated child as a live controllable transcript and returns to the parent', async () => {
    const parent = detail()
    parent.title = 'Parent investigation'
    parent.turns = [{
      id: 'turn_parent', threadId: parent.id, status: 'running', orchestration: 'direct', prompt: 'Delegate this', steering: [],
      createdAt: parent.createdAt, startedAt: parent.createdAt,
      items: [{
        id: 'user_parent', threadId: parent.id, turnId: 'turn_parent', role: 'user', status: 'completed',
        createdAt: parent.createdAt, kind: 'user_message', text: 'Delegate this'
      }], attachmentIds: [], activeSkillIds: [], injectedMemoryIds: [], injectedMemorySummaries: [],
      injectedInstructionSources: []
    }]
    const child: ThreadDetail = {
      ...detail(),
      id: 'child_1',
      title: 'Subagent · Inspect streaming',
      relation: 'side',
      parentThreadId: parent.id,
      status: 'running',
      turns: [{
        id: 'turn_child', threadId: 'child_1', status: 'running', orchestration: 'direct', prompt: 'Find the event bug', steering: [],
        createdAt: parent.createdAt, startedAt: parent.createdAt,
        items: [{
          id: 'reason_child', threadId: 'child_1', turnId: 'turn_child', role: 'assistant', status: 'running',
          createdAt: parent.createdAt, kind: 'assistant_reasoning', text: 'private child reasoning'
        }], attachmentIds: [], activeSkillIds: [], injectedMemoryIds: [], injectedMemorySummaries: [],
        injectedInstructionSources: []
      }]
    }
    const childRun = {
      id: child.id, parentThreadId: parent.id, parentTurnId: 'turn_parent',
      label: 'Inspect streaming', prompt: 'Find the event bug', profile: 'researcher', model: 'model-a',
      status: 'running' as const, createdAt: parent.createdAt, updatedAt: parent.updatedAt
    }
    let childOnEvent: ((event: RuntimeEvent) => void) | undefined
    let childSubscriptionAborted = false
    const client = {
      listThreads: vi.fn(async () => [parent]),
      getThread: vi.fn(async (id: string) => id === child.id ? child : parent),
      delegationDiagnostics: vi.fn(async (threadId: string) => ({
        enabled: true,
        active: threadId === parent.id ? 1 : 0,
        childRuns: threadId === parent.id ? [childRun] : [],
        aggregates: []
      })),
      subscribeThreadEvents: vi.fn(async (request: {
        threadId: string
        signal: AbortSignal
        onConnection?: (state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected') => void
        onEvent: (event: RuntimeEvent) => void
      }) => {
        request.onConnection?.('connected')
        if (request.threadId === child.id) childOnEvent = request.onEvent
        await new Promise<void>((resolve) => request.signal.addEventListener('abort', () => {
          if (request.threadId === child.id) childSubscriptionAborted = true
          resolve()
        }, { once: true }))
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
      columns: 96, rows: 30, write: (chunk: string) => { outputText += chunk }
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(controller, input, output)
    const running = app.run()
    try {
      expect(outputText).not.toContain('\x1b[?1000h\x1b[?1006h')
      input.emit('data', '\x18')
      input.emit('data', 'p')
      await waitFor(() => outputText.includes('Mouse clicks enabled'))
      type(input, '/subagents')
      await waitFor(() => outputText.includes('Subagents') && outputText.includes('Inspect streaming'))
      expect(sanitizeTerminalText(outputText)).toContain('Enter open transcript')
      expect(outputText).toContain('\x1b[?1000h\x1b[?1006h')

      const beforeRouteClose = outputText.length
      input.emit('data', '\x03')
      await waitFor(() => outputText.slice(beforeRouteClose).includes('Parent investigation'))
      const beforeOpen = outputText.length
      for (let row = 1; row <= output.rows!; row += 1) {
        input.emit('data', `\x1b[<0;8;${row}M`)
      }
      await waitFor(() => outputText.slice(beforeOpen).includes('child session') && Boolean(childOnEvent))
      const childFrame = outputText.slice(beforeOpen)
      expect(childFrame).toContain('Find the event bug')
      expect(childFrame).toContain('Thinking')
      expect(childFrame).toContain('collapsed')
      expect(childFrame).not.toContain('private child reasoning')
      expect(childFrame.indexOf('Kun')).toBeLessThan(childFrame.indexOf('Thinking'))
      expect(client.getThread).toHaveBeenCalledWith('child_1')

      const beforeChildMouseExpand = outputText.length
      for (let row = 1; row <= output.rows!; row += 1) {
        input.emit('data', `\x1b[<0;8;${row}M`)
      }
      await waitFor(() => outputText.slice(beforeChildMouseExpand).includes('private child reasoning'))

      const beforeChildMouseCollapse = outputText.length
      for (let row = 1; row <= output.rows!; row += 1) {
        input.emit('data', `\x1b[<0;8;${row}M`)
      }
      await waitFor(() => outputText.slice(beforeChildMouseCollapse).includes('collapsed'))
      expect(outputText.slice(beforeChildMouseCollapse)).not.toContain('private child reasoning')

      childOnEvent?.({
        kind: 'assistant_text_delta',
        seq: 1,
        timestamp: '2026-07-22T00:00:01.000Z',
        threadId: child.id,
        turnId: 'turn_child',
        itemId: 'answer_child',
        item: {
          id: 'answer_child', threadId: child.id, turnId: 'turn_child', role: 'assistant',
          status: 'running', createdAt: parent.createdAt, kind: 'assistant_text', text: 'Hel'
        }
      })
      await waitFor(() => outputText.includes('Hel'))

      const beforeExpand = outputText.length
      input.emit('data', 't')
      await waitFor(() => outputText.slice(beforeExpand).includes('private child reasoning'))

      const beforeParent = outputText.length
      input.emit('data', '\x03')
      await waitFor(() =>
        childSubscriptionAborted &&
        controller.state.projection?.thread.id === parent.id
      )
      expect(controller.state.projection?.thread.id).toBe(parent.id)
      expect(outputText).toContain('Parent investigation')
      expect(outputText).toContain('Delegate this')
      expect(outputText.length).toBeGreaterThan(beforeParent)

      childSubscriptionAborted = false
      childOnEvent = undefined
      const beforePopup = outputText.length
      for (let row = 1; row <= output.rows!; row += 1) {
        input.emit('data', `\x1b[<0;8;${row}M`)
      }
      await waitFor(() =>
        sanitizeTerminalText(outputText.slice(beforePopup)).includes('Esc close') &&
        Boolean(childOnEvent)
      )
      const popupFrame = outputText.slice(beforePopup)
      expect(popupFrame).toContain('Subagent · Inspect streaming')
      expect(popupFrame).toContain('live child session')
      expect(popupFrame).toContain('Thinking')
      expect(popupFrame).toContain('collapsed')
      expect(popupFrame.indexOf('Kun')).toBeLessThan(popupFrame.indexOf('Thinking'))
      expect(outputText).toContain('\x1b[?1000h\x1b[?1006h')

      const beforePopupThinking = outputText.length
      for (let row = 1; row <= output.rows!; row += 1) {
        input.emit('data', `\x1b[<0;8;${row}M`)
      }
      await waitFor(() => outputText.slice(beforePopupThinking).includes('private child reasoning'))

      const popupOnEvent = childOnEvent as ((event: RuntimeEvent) => void) | undefined
      expect(popupOnEvent).toBeTypeOf('function')
      popupOnEvent!({
        kind: 'assistant_text_delta',
        seq: 2,
        timestamp: '2026-07-22T00:00:02.000Z',
        threadId: child.id,
        turnId: 'turn_child',
        itemId: 'answer_child',
        item: {
          id: 'answer_child', threadId: child.id, turnId: 'turn_child', role: 'assistant',
          status: 'running', createdAt: parent.createdAt, kind: 'assistant_text', text: 'Popup live'
        }
      })
      await waitFor(() => outputText.slice(beforePopup).includes('Popup live'))

      // Wheel input belongs to the popup and must never leak into the parent
      // composer. Ctrl+C closes only the popup and restores the parent.
      input.emit('data', '\x1b[<65;20;12M')
      input.emit('data', '\x03')
      await waitFor(() => childSubscriptionAborted)
      expect(controller.state.projection?.thread.id).toBe(parent.id)
      expect(outputText).toContain('\x1b[?1000h\x1b[?1006h')
      const beforeRestoredComposer = outputText.length
      type(input, '/status')
      await waitFor(() => outputText.slice(beforeRestoredComposer).includes('Permissions'))
      input.emit('data', '\x03')
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
    expect(outputText).toContain('\x1b[?1000l\x1b[?1006l')
    expect(outputText).not.toContain('\x1b[?1049h')
    expect(outputText).not.toContain('\x1b[?1049l')
  })
})
