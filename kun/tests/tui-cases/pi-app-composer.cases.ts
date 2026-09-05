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

describe("PiTuiApplication composer and paste handling", () => {
  it('renders a guided welcome layout and turns the focused composer into the first conversation', async () => {
    let current: ThreadDetail | undefined
    let resolveStart!: (value: { turnId: string }) => void
    const startTurn = vi.fn(() => new Promise<{ turnId: string }>((resolve) => {
      resolveStart = resolve
    }))
    const client = {
      listThreads: vi.fn(async () => current ? [current] : []),
      createThread: vi.fn(async (input: { title: string }) => {
        current = { ...detail(), title: input.title }
        return current
      }),
      getThread: vi.fn(async () => current!),
      subscribeThreadEvents: vi.fn(async (input: {
        signal: AbortSignal
        onConnection: (state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected') => void
      }) => {
        input.onConnection('connected')
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] })),
      modelConnections: vi.fn(async () => modelSnapshot()),
      startTurn
    } as unknown as KunTuiClient
    const controller = new TuiController(client, { ...options, continueLatest: false }, runtime)
    await controller.start()

    const input = Object.assign(new EventEmitter(), {
      isRaw: false,
      setRawMode: vi.fn(),
      setEncoding: vi.fn(),
      resume: vi.fn(),
      pause: vi.fn()
    }) as unknown as TerminalInput
    let outputText = ''
    const outputEvents = new EventEmitter()
    const output = Object.assign(outputEvents, {
      columns: 100,
      rows: 32,
      write: (chunk: string) => { outputText += chunk }
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(controller, input, output)
    const running = app.run()
    try {
      await waitFor(() => outputText.includes('Welcome to Kun'))
      expect(outputText).toContain('A focused terminal agent')
      expect(outputText).toContain('Workspace')
      expect(outputText).toContain('Model')
      expect(outputText).toContain('Mode')
      expect(outputText).toContain('Version')
      expect(outputText).toContain('/connect')
      expect(outputText).toContain('add or manage a provider')
      expect(outputText).not.toContain('/model')
      expect(outputText).toContain('Ctrl+P')
      expect(outputText).toContain('KUN')
      expect(outputText).not.toContain('◒ KUN')
      expect(outputText).not.toContain('●    ●')
      expect(outputText).not.toContain('Welcome ─')
      expect(outputText).not.toContain('No threads found')

      const beforeResize = outputText.length
      Object.assign(output, { columns: 42, rows: 18 })
      outputEvents.emit('resize')
      await waitFor(() => outputText.length > beforeResize)
      const narrowOutput = outputText.slice(beforeResize)
      expect(narrowOutput).toContain('Welcome to Kun')
      expect(narrowOutput).toContain('/connect')
      expect(narrowOutput).toContain('Ctrl+P')

      input.emit('data', '\x10') // Ctrl+P
      await waitFor(() => outputText.includes('Commands') && outputText.includes('Switch session'))
      input.emit('data', '\x03') // Ctrl+C closes the command palette like Escape

      for (const character of 'preserved draft') input.emit('data', character)
      await waitFor(() => outputText.includes('preserved draft'))
      const beforeDraftRoute = outputText.length
      input.emit('data', '\x18m') // A real PTY may coalesce Ctrl+X M.
      await waitFor(() => outputText.slice(beforeDraftRoute).includes('Kimi Code'))
      const modelFrame = outputText.slice(beforeDraftRoute)
      expect(modelFrame).toContain('Models')
      expect(modelFrame).toContain('DeepSeek')
      expect(modelFrame).toContain('Kimi Code')
      expect(modelFrame).not.toContain('preserved draft')
      expect(modelFrame).not.toContain('Welcome to Kun')
      expect(modelFrame).not.toContain('add provider')
      expect(modelFrame).not.toContain(' Prompt')
      expect(modelFrame).not.toContain('\x1b[3J')
      expect(modelFrame).not.toContain('\x1b[?1049h')
      const beforeModelResize = outputText.length
      Object.assign(output, { columns: 80, rows: 24 })
      outputEvents.emit('resize')
      await waitFor(() => outputText.slice(beforeModelResize).includes('Kimi Code'))
      const resizedModelFrame = outputText.slice(beforeModelResize)
      expect(resizedModelFrame).not.toContain('Welcome to Kun')
      expect(resizedModelFrame).not.toContain(' Prompt')
      const beforeReturn = outputText.length
      input.emit('data', '\x03') // Ctrl+C closes the exclusive model route
      await waitFor(() => outputText.slice(beforeReturn).includes('preserved draft'))
      input.emit('data', '\x03') // Clear the restored draft before the next route.

      const beforeConnect = outputText.length
      type(input, '/connect')
      await waitFor(() => sanitizeTerminalText(outputText.slice(beforeConnect)).includes('KUN / Connect'))
      const connectFrame = outputText.slice(beforeConnect)
      expect(connectFrame).toContain('Add a provider')
      expect(connectFrame).toContain('DeepSeek')
      expect(connectFrame).toContain('Kimi Code')
      expect(connectFrame).not.toContain('Subscription')
      expect(connectFrame).not.toContain('Welcome to Kun')
      expect(connectFrame).not.toContain('add provider')
      expect(connectFrame).not.toContain(' Prompt')
      const beforeCatalog = outputText.length
      input.emit('data', '\r')
      await waitFor(() => outputText.slice(beforeCatalog).includes('Custom provider'))
      const catalogFrame = outputText.slice(beforeCatalog)
      expect(catalogFrame).toContain('Add provider')
      expect(catalogFrame).toContain('Subscription')
      expect(catalogFrame).toContain('API')
      const beforeCatalogBack = outputText.length
      input.emit('data', '\x03') // Ctrl+C returns from the catalog to configured connections.
      await waitFor(() =>
        sanitizeTerminalText(outputText.slice(beforeCatalogBack)).includes('KUN / Connect') &&
        outputText.slice(beforeCatalogBack).includes('Connections')
      )
      input.emit('data', '\x03') // A second Ctrl+C closes /connect without exiting the TUI.
      await new Promise((resolve) => setTimeout(resolve, 20))
      for (const character of 'route restored') input.emit('data', character)
      await waitFor(() => outputText.includes('route restored'))
      input.emit('data', '\x03')

      for (const character of 'discard me') input.emit('data', character)
      input.emit('data', '\x03') // Ctrl+C clears non-empty composer
      input.emit('data', '\r')
      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(startTurn).not.toHaveBeenCalled()

      input.emit('data', '\x18') // Ctrl+X Leader
      input.emit('data', 'l')
      await waitFor(() => controller.state.view === 'threads' && outputText.includes('Sessions'))
      input.emit('data', '\x03') // Ctrl+C returns from the session picker
      await waitFor(() => controller.state.view === 'chat')

      type(input, 'Explain this repository')
      await waitFor(() => startTurn.mock.calls.length === 1)
      await waitFor(() => outputText.includes('Sending message'))
      expect(controller.state).toMatchObject({
        busy: true,
        busyLabel: 'Sending message'
      })
      expect(client.createThread).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Explain this repository', titleAuto: true, workspace: '/tmp/project'
      }))
      expect(startTurn).toHaveBeenCalledWith('thr_pi', expect.objectContaining({
        prompt: 'Explain this repository'
      }))
      resolveStart({ turnId: 'turn_welcome' })
      await waitFor(() => controller.state.projection?.runningTurnId === 'turn_welcome')
      expect(controller.state.projection?.thread.id).toBe('thr_pi')

      const beforeConversationModels = outputText.length
      input.emit('data', '\x18')
      input.emit('data', 'm')
      await waitFor(() => outputText.slice(beforeConversationModels).includes('Kimi Code'))
      const conversationModelFrame = outputText.slice(beforeConversationModels)
      expect(conversationModelFrame).not.toContain('Explain this repository')
      expect(conversationModelFrame).not.toContain(' Prompt')
      input.emit('data', '\x1b')
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })

  it('uses ArrowUp and ArrowDown to browse submitted composer input history', async () => {
    const current = detail()
    const startTurn = vi.fn(async () => ({ turnId: 'turn_history' }))
    const listThreads = vi.fn(async () => [current])
    const client = {
      listThreads,
      getThread: vi.fn(async () => current),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] })),
      modelConnections: vi.fn(async () => modelSnapshot()),
      startTurn
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
    const output = Object.assign(new EventEmitter(), {
      columns: 92,
      rows: 28,
      write: (chunk: string) => { outputText += chunk }
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(controller, input, output)
    const root = (app as unknown as {
      root: {
        editor: { getText: () => string }
        render: (width: number) => string[]
      }
    }).root
    const running = app.run()
    try {
      type(input as unknown as EventEmitter, 'previous prompt')
      await waitFor(() => startTurn.mock.calls.length === 1)

      const listCallsBeforeHistory = listThreads.mock.calls.length
      input.emit('data', '\x1b[A')
      await waitFor(() => root.editor.getText() === 'previous prompt')
      expect(sanitizeTerminalText(root.render(92).join('\n'))).toContain('previous prompt')
      expect(listThreads).toHaveBeenCalledTimes(listCallsBeforeHistory)
      expect(controller.state.notification?.message ?? '').not.toContain('No parent session')

      input.emit('data', '\x1b[B')
      await waitFor(() => root.editor.getText() === '')
      for (const character of 'next prompt') input.emit('data', character)
      await waitFor(() => root.editor.getText() === 'next prompt')
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })

  it('restores the exact composer draft when @file preparation fails', async () => {
    const current = detail()
    const startTurn = vi.fn(async () => ({ turnId: 'turn_file_mention' }))
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] })),
      modelConnections: vi.fn(async () => modelSnapshot()),
      startTurn
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options, runtime)
    await controller.start()
    const prepare = vi.spyOn(controller, 'prepareFileMentions')
      .mockImplementationOnce(async () => {
        controller.notify('Could not attach @missing.ts: file was not found.', 'error')
        return false
      })
      .mockResolvedValueOnce(true)
    const input = Object.assign(new EventEmitter(), {
      isRaw: false,
      setRawMode: vi.fn(),
      setEncoding: vi.fn(),
      resume: vi.fn(),
      pause: vi.fn()
    }) as unknown as TerminalInput
    const output = Object.assign(new EventEmitter(), {
      columns: 92,
      rows: 28,
      write: vi.fn()
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(controller, input, output)
    const root = (app as unknown as {
      root: { editor: { getText: () => string } }
    }).root
    const running = app.run()
    const original = 'Inspect @missing.ts'
    try {
      type(input as unknown as EventEmitter, original)
      await waitFor(() => prepare.mock.calls.length === 1)
      await waitFor(() => root.editor.getText() === original)
      expect(startTurn).not.toHaveBeenCalled()

      for (const character of ' after fixing') input.emit('data', character)
      input.emit('data', '\r')
      await waitFor(() => startTurn.mock.calls.length === 1)
      expect(prepare).toHaveBeenNthCalledWith(2, `${original} after fixing`)
      expect(startTurn).toHaveBeenCalledWith(current.id, expect.objectContaining({
        prompt: `${original} after fixing`
      }))
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })

  it('intercepts complete and split bracketed path pastes while preserving ordinary pasted text', async () => {
    const current = detail()
    const startTurn = vi.fn(async () => ({ turnId: 'turn_after_paste' }))
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] })),
      modelConnections: vi.fn(async () => modelSnapshot()),
      startTurn
    } as unknown as KunTuiClient
    const attachmentRuntime = {
      ...runtime,
      runtimeInfo: {
        ...runtime.runtimeInfo,
        capabilities: buildRuntimeCapabilityManifest({
          model: modelCapabilitiesForModel('model-a')
        })
      }
    } as TuiConnection
    const controller = new TuiController(client, options, attachmentRuntime)
    await controller.start()
    const attachPastedPaths = vi.spyOn(controller, 'attachPastedPaths')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    const input = Object.assign(new EventEmitter(), {
      isRaw: false,
      setRawMode: vi.fn(),
      setEncoding: vi.fn(),
      resume: vi.fn(),
      pause: vi.fn()
    }) as unknown as TerminalInput
    let outputText = ''
    const output = Object.assign(new EventEmitter(), {
      columns: 92,
      rows: 28,
      write: (chunk: string) => { outputText += chunk }
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(controller, input, output)
    const running = app.run()
    try {
      input.emit('data', "\x1b[200~'/tmp/screen")
      input.emit('data', " shot.png'\x1b[201~")
      await waitFor(() => attachPastedPaths.mock.calls.length === 1)
      expect(attachPastedPaths).toHaveBeenNthCalledWith(1, "'/tmp/screen shot.png'")

      input.emit('data', '\x1b[200~ordinary pasted text\x1b[201~')
      await waitFor(() => attachPastedPaths.mock.calls.length === 2)
      await waitFor(() => outputText.includes('ordinary pasted text'))
      expect(attachPastedPaths).toHaveBeenNthCalledWith(2, 'ordinary pasted text')

      const validate = vi.spyOn(controller, 'validatePendingAttachmentsForCurrentModel')
        .mockImplementationOnce(() => {
          controller.notify('custom/text-only does not support image input; attachment remains queued.', 'error')
          return false
        })
        .mockReturnValue(true)
      input.emit('data', '\r')
      await waitFor(() => validate.mock.calls.length === 1)
      expect(controller.state.notification?.message).toContain('does not support image input')

      for (const character of ' suffix') input.emit('data', character)
      input.emit('data', '\r')
      await waitFor(() => startTurn.mock.calls.length === 1)
      expect(startTurn).toHaveBeenCalledWith(current.id, expect.objectContaining({
        prompt: 'ordinary pasted text suffix'
      }))
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })
})
