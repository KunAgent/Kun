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

describe("PiTuiApplication shell and Graph rendering", () => {
  it('does not recreate a missing migration target for local share snapshots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-tui-share-migration-'))
    const dataDir = join(root, 'missing', 'data')
    const migration = await acquireRuntimeDataDirMigrationLock(dataDir)
    try {
      await expect(writeLocalShareSnapshot(dataDir, 'thr_share', '# snapshot\n'))
        .rejects.toThrow(/migration is active/)
      await expect(stat(dataDir)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await migration.release()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps browser authentication usable when a Linux desktop opener is unavailable', () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    const spawnFn = vi.fn(() => child)
    const url = 'https://auth.example.test/authorize?state=visible'

    expect(() => openBrowser(url, spawnFn as never, 'linux')).not.toThrow()
    expect(spawnFn).toHaveBeenCalledWith('xdg-open', [url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    expect(child.unref).toHaveBeenCalledOnce()
    expect(() => child.emit('error', new Error('spawn xdg-open ENOENT'))).not.toThrow()
  })

  it('decodes complete SGR mouse reports and rejects partial or invalid coordinates', () => {
    expect(parseSgrMouseEvent('\x1b[<0;12;7M')).toEqual({
      button: 0, x: 12, y: 7, pressed: true
    })
    expect(parseSgrMouseEvent('\x1b[<65;20;9M')).toEqual({
      button: 65, x: 20, y: 9, pressed: true
    })
    expect(parseSgrMouseEvent('\x1b[<0;12;7m')).toEqual({
      button: 0, x: 12, y: 7, pressed: false
    })
    expect(parseSgrMouseEvent('\x1b[<0;12;')).toBeUndefined()
    expect(parseSgrMouseEvent('\x1b[<0;0;7M')).toBeUndefined()
  })

  it('uses a text-only Kun wordmark at every width without overflowing', () => {
    const wide = renderKunWordmark(100, '1.2.3')
    const compact = renderKunWordmark(60, '1.2.3')
    const narrow = renderKunWordmark(36, '1.2.3')
    expect(wide).toHaveLength(1)
    expect(compact).toHaveLength(1)
    expect(narrow).toHaveLength(1)
    expect(wide.join('\n')).toContain('KUN')
    expect(compact.join('\n')).toContain('KUN')
    expect(narrow.join('\n')).toContain('KUN')
    expect([wide, compact, narrow].flat().join('\n')).not.toMatch(/[◒◆▄▆█◢◣]/u)
    expect(wide.every((line) => visibleWidth(line) <= 100)).toBe(true)
    expect(compact.every((line) => visibleWidth(line) <= 60)).toBe(true)
    expect(narrow.every((line) => visibleWidth(line) <= 36)).toBe(true)
  })

  it('renders the reduced welcome and sparse composer without overflowing wide, medium, or narrow terminals', () => {
    const controller = new TuiController({} as KunTuiClient, { ...options, continueLatest: false }, runtime)
    const widths = [120, 80, 42]
    for (const width of widths) {
      const welcome = renderKunWelcome(controller.state, controller, width, width === 42 ? 18 : 36)
      expect(welcome.every((line) => visibleWidth(line) <= width)).toBe(true)
      expect(welcome.join('\n')).toContain('Welcome to Kun')
      expect(welcome.join('\n')).toContain('/connect')
      expect(welcome.join('\n')).toContain('/sessions')
      expect(welcome.join('\n')).toContain('Type a task')
      expect(welcome.join('\n')).not.toContain('/model')
      expect(welcome.join('\n')).not.toContain('Ctrl+P')

      const rule = '─'.repeat(Math.max(8, width - 5))
      const composer = renderKunComposerFrame([rule, '', rule], controller.state, controller, width)
      expect(composer.every((line) => visibleWidth(line) <= width)).toBe(true)
      expect(composer[0]).toContain('┌')
      expect(composer).toContainEqual(expect.stringContaining('├'))
      expect(composer.at(-1)).toContain('└')
      expect(composer.join('\n')).toContain('model-a')
      expect(composer.join('\n')).not.toContain('Ctrl+C')
    }
    expect(renderKunWelcome(controller.state, controller, 120, 36).join('\n')).toContain('Version')
    expect(renderKunWelcome(controller.state, controller, 42, 18).join('\n')).toContain('Mode')
  })

  it('shows Graph as the next-turn mode and renders bounded durable progress above the composer', () => {
    const controller = new TuiController({} as KunTuiClient, options, runtime)
    const projection = projectThreadSnapshot(detail())
    const state = {
      ...controller.state,
      projection,
      composerOrchestration: 'graph' as const,
      graphRuns: [testTuiGraphRun({ threadId: projection.thread.id })]
    }

    const composer = sanitizeTerminalText(
      renderKunComposerFrame(['────', '', '────'], state, controller, 80).join('\n')
    )
    const progress = sanitizeTerminalText(renderGraphProgressRow(state, 80))

    expect(composer).toContain('graph')
    expect(progress).toContain('GRAPH')
    expect(progress).toContain('Test graph')
    expect(progress).toContain('agents')
    expect(progress).toContain('/graph status')
    expect(visibleWidth(progress)).toBeLessThanOrEqual(80)
    expect(renderGraphProgressRow(state, 36)).toContain('/graph status')
    expect(visibleWidth(renderGraphProgressRow(state, 36))).toBeLessThanOrEqual(36)
  })

  it('renders automatic review progress and terminal rationale without approval controls', () => {
    const projection = projectThreadSnapshot(detail())
    projection.approvalReviews = [{
      reviewId: 'review_1',
      approvalId: 'approval_1',
      turnId: 'turn_1',
      toolName: 'bash',
      summary: 'Run the test command',
      status: 'in-progress',
      startedAt: '2026-07-22T00:00:01.000Z'
    }]
    const transcript = new TranscriptComponent()
    transcript.update(projection, false, false)

    const progress = sanitizeTerminalText(transcript.render(80).join('\n'))
    expect(progress).toContain('Reviewing bash')
    expect(progress).toContain('Run the test command')
    expect(progress).not.toMatch(/\bAllow\b|\bDeny\b/u)

    projection.approvalReviews = [{
      ...projection.approvalReviews[0]!,
      status: 'denied',
      decision: 'deny',
      riskLevel: 'high',
      rationale: 'The command exceeds the requested workspace scope.',
      completedAt: '2026-07-22T00:00:02.000Z'
    }]
    transcript.update(projection, false, false)
    const terminal = sanitizeTerminalText(transcript.render(80).join('\n'))
    expect(terminal).toContain('Agent review denied')
    expect(terminal).toContain('risk high')
    expect(terminal).toContain('The command exceeds the requested workspace scope.')
    expect(terminal).not.toMatch(/\bAllow\b/u)
  })

  it('renders a responsive Graph board and drills into the selected worker', () => {
    const controller = new TuiController({} as KunTuiClient, options, runtime)
    const projection = projectThreadSnapshot(detail())
    projection.childRuns = [{
      childId: 'child_research',
      parentTurnId: 'turn_source',
      label: 'Research',
      prompt: 'Inspect the relevant code.',
      profile: 'profile_1',
      status: 'running',
      startedAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:04.000Z'
    }]
    const run = testTuiGraphRun({ threadId: projection.thread.id })
    const state = {
      ...controller.state,
      projection,
      graphRuns: [run],
      graphBoard: { runId: run.id }
    }
    const openWorker = vi.fn()
    const dialog = new GraphBoardDialog({
      tui: { requestRender: vi.fn() } as never,
      controller,
      state,
      runId: run.id,
      terminalRows: () => 36,
      close: vi.fn(),
      openWorker
    })

    const wide = sanitizeTerminalText(dialog.render(120).join('\n'))
    expect(wide).toContain('GRAPH · running')
    expect(wide).toContain('research ─control→ finish')
    expect(wide).toContain('Node research')
    expect(wide).toContain('Researcher (profile_1)')

    dialog.handleInput('\r')
    expect(openWorker).toHaveBeenCalledWith(run.id, 'research', 'child_research')

    dialog.handleInput('\x1b[B')
    const narrow = sanitizeTerminalText(dialog.render(72).join('\n'))
    expect(dialog.selectedNodeId()).toBe('finish')
    expect(narrow).toContain('Phase 1 · Implementation')
    expect(narrow).toContain('Waiting for research.')
    expect(narrow.split('\n').every((line) => visibleWidth(line) <= 72)).toBe(true)
  })

  it('keeps Graph inline until an opt-in click opens the board and mandatory input temporarily preempts it', async () => {
    const current = detail()
    const run = testTuiGraphRun({ threadId: current.id })
    const child: ThreadDetail = {
      ...detail(),
      id: 'child_research',
      title: 'Graph worker · Research',
      relation: 'side',
      parentThreadId: current.id,
      status: 'running'
    }
    let parentOnEvent: ((event: RuntimeEvent) => void) | undefined
    let childSubscriptionAborted = false
    const client = {
      graphAvailability: vi.fn(async () => ({ enabled: true })),
      listGraphRuns: vi.fn(async () => [run]),
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async (threadId: string) => threadId === child.id ? child : current),
      delegationDiagnostics: vi.fn(async (threadId: string) => ({
        enabled: true,
        active: threadId === current.id ? 1 : 0,
        aggregates: [],
        childRuns: threadId === current.id
          ? [{
              id: child.id,
              parentThreadId: current.id,
              parentTurnId: 'turn_source',
              label: 'Research',
              prompt: 'Inspect the relevant code.',
              profile: 'profile_1',
              status: 'running' as const,
              createdAt: current.createdAt,
              updatedAt: current.updatedAt
            }]
          : []
      })),
      subscribeThreadEvents: vi.fn(async (input: {
        threadId: string
        signal: AbortSignal
        onEvent: (event: RuntimeEvent) => void
        onConnection: (state: 'connecting' | 'connected') => void
      }) => {
        if (input.threadId === current.id) parentOnEvent = input.onEvent
        input.onConnection('connected')
        await new Promise<void>((resolve) =>
          input.signal.addEventListener('abort', () => {
            if (input.threadId === child.id) childSubscriptionAborted = true
            resolve()
          }, { once: true }))
      }),
      skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] }))
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options, runtime)
    await controller.start()

    const input = Object.assign(new EventEmitter(), {
      isRaw: false,
      setRawMode: vi.fn(),
      setEncoding: vi.fn(),
      resume: vi.fn(),
      pause: vi.fn()
    }) as unknown as TerminalInput
    let outputText = ''
    const terminalRows = 32
    const output = Object.assign(new EventEmitter(), {
      columns: 110,
      rows: terminalRows,
      write: (chunk: string) => { outputText += chunk }
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(controller, input, output)
    const running = app.run()
    try {
      await waitFor(() => outputText.includes('/graph status'))
      expect(controller.state.graphBoard).toBeUndefined()
      expect(sanitizeTerminalText(outputText)).not.toContain('GRAPH · running')

      type(input, '/mouse on')
      await waitFor(() => outputText.includes('Mouse clicks enabled'))
      const internals = app as unknown as {
        root: { graphProgressAtTerminalRow: (row: number) => boolean }
      }
      const graphRow = Array.from(
        { length: terminalRows },
        (_, index) => index + 1
      ).find((row) => internals.root.graphProgressAtTerminalRow(row))
      expect(graphRow).toBeDefined()
      input.emit('data', `\x1b[<0;2;${graphRow}M`)

      await waitFor(() => controller.state.graphBoard?.runId === run.id)
      await waitFor(() => sanitizeTerminalText(outputText).includes('GRAPH · running'))

      const beforeWorker = outputText.length
      input.emit('data', '\r')
      await waitFor(() =>
        sanitizeTerminalText(outputText.slice(beforeWorker)).includes('live child session'))
      expect(client.getThread).toHaveBeenCalledWith(child.id)
      const beforeWorkerClose = outputText.length
      input.emit('data', '\x1b')
      await waitFor(() =>
        childSubscriptionAborted &&
        sanitizeTerminalText(outputText.slice(beforeWorkerClose)).includes('Node research'))
      expect(controller.state.graphBoard).toEqual({ runId: run.id })

      const eventBase = {
        timestamp: '2026-07-26T00:00:05.000Z',
        threadId: current.id,
        turnId: 'turn_gate'
      }
      const beforeApproval = outputText.length
      parentOnEvent?.({
        ...eventBase,
        kind: 'approval_requested',
        seq: 1,
        approvalId: 'approval_graph',
        toolName: 'bash',
        status: 'pending',
        summary: 'Run Graph validation'
      })
      await waitFor(() => sanitizeTerminalText(outputText.slice(beforeApproval)).includes('Approval required'))
      expect(controller.state.graphBoard).toEqual({ runId: run.id })

      const beforeResolve = outputText.length
      parentOnEvent?.({
        ...eventBase,
        kind: 'approval_resolved',
        seq: 2,
        approvalId: 'approval_graph',
        toolName: 'bash',
        status: 'allowed',
        summary: 'Run Graph validation'
      })
      await waitFor(() =>
        sanitizeTerminalText(outputText.slice(beforeResolve)).includes('GRAPH · running'))

      input.emit('data', '\x1b')
      await waitFor(() => controller.state.graphBoard === undefined)
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })

  it('keeps a startup Graph requirement in the composer when Graph is unavailable', async () => {
    const client = {
      graphAvailability: vi.fn(async () => ({ enabled: false })),
      listThreads: vi.fn(async () => []),
      skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] })),
      startTurn: vi.fn()
    } as unknown as KunTuiClient
    const controller = new TuiController(
      client,
      { ...options, continueLatest: false },
      runtime
    )
    await controller.start()

    const input = Object.assign(new EventEmitter(), {
      isRaw: false,
      setRawMode: vi.fn(),
      setEncoding: vi.fn(),
      resume: vi.fn(),
      pause: vi.fn()
    }) as unknown as TerminalInput
    let outputText = ''
    const output = Object.assign(new EventEmitter(), {
      columns: 90,
      rows: 28,
      write: (chunk: string) => { outputText += chunk }
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(controller, input, output)
    const running = app.run()
    try {
      await expect(app.submitStartupGraphPrompt('保留这个 Graph 草稿')).resolves.toBe(false)
      await waitFor(() => outputText.includes('保留这个 Graph 草稿'))
      expect(controller.state.composerOrchestration).toBe('direct')
      expect(client.startTurn).not.toHaveBeenCalled()
      expect(controller.state.notification?.message).toContain('disabled')
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })
})
