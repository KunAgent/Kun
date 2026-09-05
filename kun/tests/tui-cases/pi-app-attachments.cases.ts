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

describe("PiTuiApplication clipboard, attachments, and streaming", () => {
  it('reads a system clipboard image on forwarded paste keys, empty bracketed paste, Leader V, and /paste', async () => {
    const current = detail()
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] })),
      modelConnections: vi.fn(async () => modelSnapshot())
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options, runtime)
    await controller.start()
    const image = {
      bytes: Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0, 0, 0, 0, 0x49, 0x48, 0x44, 0x52
      ]),
      mimeType: 'image/png' as const,
      source: 'macos' as const
    }
    const clipboardImageReader = vi.fn(async () => image)
    const attachClipboardImage = vi.spyOn(controller, 'attachClipboardImage').mockResolvedValue(true)
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
    const app = new PiTuiApplication(
      controller,
      input,
      output,
      parseTuiKeymapConfig({}).keymap,
      clipboardImageReader
    )
    const running = app.run()
    try {
      input.emit('data', '\x16')
      await waitFor(() => attachClipboardImage.mock.calls.length === 1)
      expect(clipboardImageReader).toHaveBeenCalledTimes(1)
      expect(attachClipboardImage).toHaveBeenNthCalledWith(1, image)

      input.emit('data', '\x1bv')
      await waitFor(() => attachClipboardImage.mock.calls.length === 2)
      expect(clipboardImageReader).toHaveBeenCalledTimes(2)
      expect(attachClipboardImage).toHaveBeenNthCalledWith(2, image)

      input.emit('data', '\x1b[118;9u')
      await waitFor(() => attachClipboardImage.mock.calls.length === 3)
      expect(clipboardImageReader).toHaveBeenCalledTimes(3)
      expect(attachClipboardImage).toHaveBeenNthCalledWith(3, image)

      input.emit('data', '\x1b[200~\x1b[201~')
      await waitFor(() => attachClipboardImage.mock.calls.length === 4)
      expect(clipboardImageReader).toHaveBeenCalledTimes(4)
      expect(attachClipboardImage).toHaveBeenNthCalledWith(4, image)

      input.emit('data', '\x18')
      input.emit('data', 'v')
      await waitFor(() => attachClipboardImage.mock.calls.length === 5)
      expect(clipboardImageReader).toHaveBeenCalledTimes(5)
      expect(attachClipboardImage).toHaveBeenNthCalledWith(5, image)

      type(input as unknown as EventEmitter, '/paste')
      await waitFor(() => attachClipboardImage.mock.calls.length === 6)
      expect(clipboardImageReader).toHaveBeenCalledTimes(6)
      expect(attachClipboardImage).toHaveBeenNthCalledWith(6, image)
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })

  it('advertises the platform-native screenshot paste key with a reliable fallback', () => {
    expect(imagePasteShortcutLabel('darwin')).toBe('⌘V / Ctrl+X V')
    expect(imagePasteShortcutLabel('win32')).toBe('Ctrl+V / Alt+V')
    expect(imagePasteShortcutLabel('linux')).toBe('Ctrl+V / Ctrl+X V')
  })

  it('renders pending attachment chips and removes them only from an empty text editor', async () => {
    const current = detail()
    let attachmentNumber = 0
    const uploadAttachment = vi.fn(async (input: { name: string; mimeType?: string }) => {
      attachmentNumber += 1
      return {
        attachment: {
          id: `attachment_${attachmentNumber}`,
          name: input.name,
          kind: 'image' as const,
          mimeType: input.mimeType ?? 'image/png',
          byteSize: 2048 * attachmentNumber,
          hash: `hash-${attachmentNumber}`,
          threadIds: [current.id],
          workspaces: [current.workspace],
          createdAt: current.createdAt,
          updatedAt: current.updatedAt
        }
      }
    })
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] })),
      modelConnections: vi.fn(async () => modelSnapshot()),
      setLocalCapabilityEnabled: vi.fn(async () => ({ id: 'attachments' as const, enabled: true })),
      uploadAttachment
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
    const image = {
      bytes: Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0, 0, 0, 0, 0x49, 0x48, 0x44, 0x52
      ]),
      mimeType: 'image/png' as const,
      source: 'macos' as const
    }
    expect(await controller.attachClipboardImage(image)).toBe(true)
    expect(await controller.attachClipboardImage(image)).toBe(true)
    expect(controller.state.pendingAttachments).toHaveLength(2)
    const input = Object.assign(new EventEmitter(), {
      isRaw: false,
      setRawMode: vi.fn(),
      setEncoding: vi.fn(),
      resume: vi.fn(),
      pause: vi.fn()
    }) as unknown as TerminalInput
    let outputText = ''
    const output = Object.assign(new EventEmitter(), {
      columns: 100,
      rows: 30,
      write: (chunk: string) => { outputText += chunk }
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(controller, input, output)
    const running = app.run()
    try {
      const rule = '─'.repeat(95)
      const composer = sanitizeTerminalText(
        renderKunComposerFrame([rule, '', rule], controller.state, controller, 100).join('\n')
      )
      expect(composer).toContain('Attachment 1/2 [Image]')
      expect(composer).toContain('Attachment 2/2 [Image]')
      expect(composer).toContain('Backspace/Del remove')

      input.emit('data', 'x')
      input.emit('data', '\x7f')
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(controller.state.pendingAttachments.map((attachment) => attachment.id)).toEqual([
        'attachment_1',
        'attachment_2'
      ])

      input.emit('data', '\x7f')
      await waitFor(() => controller.state.pendingAttachments.length === 1)
      expect(controller.state.pendingAttachments[0]?.id).toBe('attachment_1')
      expect(controller.state.notification?.message).toContain('Removed clipboard-')

      input.emit('data', '\x1b[3~')
      await waitFor(() => controller.state.pendingAttachments.length === 0)
      expect(controller.state.quitRequested).toBe(false)

      await controller.attachClipboardImage(image)
      const previousWindowsTerminalSession = process.env.WT_SESSION
      process.env.WT_SESSION = 'kun-tui-test'
      try {
        input.emit('data', '\x08')
        await waitFor(() => controller.state.pendingAttachments.length === 0)
      } finally {
        if (previousWindowsTerminalSession === undefined) delete process.env.WT_SESSION
        else process.env.WT_SESSION = previousWindowsTerminalSession
      }
      expect(controller.state.quitRequested).toBe(false)

      await controller.attachClipboardImage(image)
      input.emit('data', '\x03')
      await waitFor(() => controller.state.pendingAttachments.length === 0)
      expect(controller.state.notification?.message).toBe('Pending attachments cleared.')
      expect(controller.state.quitRequested).toBe(false)
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })

  it('renders assistant fragments before the turn completes and keeps the final text intact', async () => {
    const current = detail()
    current.status = 'running'
    current.turns = [{
      id: 'turn_stream', threadId: current.id, status: 'running', orchestration: 'direct', prompt: 'Say hello', steering: [],
      createdAt: current.createdAt, startedAt: current.createdAt, items: [], attachmentIds: [], activeSkillIds: [],
      injectedMemoryIds: [], injectedMemorySummaries: [], injectedInstructionSources: []
    }]
    let onEvent: ((event: RuntimeEvent) => void) | undefined
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
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
      columns: 80, rows: 24, write: (chunk: string) => { outputText += chunk }
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(controller, input, output)
    const running = app.run()
    const base = {
      timestamp: '2026-07-22T00:00:01.000Z', threadId: current.id, turnId: 'turn_stream', itemId: 'item_stream'
    }
    try {
      await waitFor(() => sanitizeTerminalText(outputText).includes('History'))
      expect(outputText).not.toContain('\x1b[?1000h\x1b[?1006h')
      onEvent?.({
        ...base, kind: 'assistant_text_delta', seq: 1,
        item: {
          id: 'item_stream', threadId: current.id, turnId: 'turn_stream', role: 'assistant',
          status: 'running', createdAt: base.timestamp, kind: 'assistant_text', text: 'Hel'
        }
      })
      await waitFor(() => outputText.includes('Hel'))
      expect(outputText).toContain('▍')
      expect(outputText).toContain('Responding')
      expect(controller.state.projection?.items.find((item) => item.id === 'item_stream')).toMatchObject({ text: 'Hel' })

      onEvent?.({
        ...base, kind: 'assistant_text_delta', seq: 2,
        item: {
          id: 'item_stream', threadId: current.id, turnId: 'turn_stream', role: 'assistant',
          status: 'running', createdAt: base.timestamp, kind: 'assistant_text', text: 'lo'
        }
      })
      await waitFor(() => outputText.includes('Hello'))
      expect(controller.state.projection?.runningTurnId).toBe('turn_stream')

      onEvent?.({
        ...base, kind: 'assistant_reasoning_delta', seq: 3, itemId: 'reason_stream',
        item: {
          id: 'reason_stream', threadId: current.id, turnId: 'turn_stream', role: 'assistant',
          status: 'running', createdAt: base.timestamp, kind: 'assistant_reasoning', text: 'private thought'
        }
      })
      await waitFor(() => controller.state.projection?.items.some((item) => item.id === 'reason_stream') ?? false)
      await waitFor(() => outputText.includes('Thinking'))
      await waitFor(() => outputText.includes('/thinking expand'))
      expect(outputText).not.toContain('private thought')

      const beforePointerMode = outputText.length
      input.emit('data', '\x18p')
      expect((app as unknown as { pointerModeEnabled: boolean }).pointerModeEnabled).toBe(true)
      await waitFor(() => outputText.slice(beforePointerMode).includes('\x1b[?1000h\x1b[?1006h'))
      expect(outputText.slice(beforePointerMode)).toContain('\x1b[?1000h\x1b[?1006h')

      const beforeMouseExpand = outputText.length
      for (let row = 1; row <= output.rows!; row += 1) {
        input.emit('data', `\x1b[<0;8;${row}M`)
      }
      await waitFor(() => outputText.slice(beforeMouseExpand).includes('private thought'))

      const beforeMouseCollapse = outputText.length
      for (let row = 1; row <= output.rows!; row += 1) {
        input.emit('data', `\x1b[<0;8;${row}M`)
      }
      await waitFor(() => outputText.slice(beforeMouseCollapse).includes('collapsed'))
      expect(outputText.slice(beforeMouseCollapse)).not.toContain('private thought')

      const beforeTextSelection = outputText.length
      input.emit('data', '\x18p')
      expect((app as unknown as { pointerModeEnabled: boolean }).pointerModeEnabled).toBe(false)
      await waitFor(() => outputText.slice(beforeTextSelection).includes('\x1b[?1000l\x1b[?1006l'))
      expect(outputText.slice(beforeTextSelection)).toContain('\x1b[?1000l\x1b[?1006l')
      expect(controller.state.projection?.runningTurnId).toBe('turn_stream')

      const beforeClicksRestored = outputText.length
      input.emit('data', '\x18p')
      expect((app as unknown as { pointerModeEnabled: boolean }).pointerModeEnabled).toBe(true)
      await waitFor(() => outputText.slice(beforeClicksRestored).includes('\x1b[?1000h\x1b[?1006h'))
      expect(outputText.slice(beforeClicksRestored)).toContain('\x1b[?1000h\x1b[?1006h')

      const beforeExpand = outputText.length
      type(input, '/thinking')
      await waitFor(() => outputText.slice(beforeExpand).includes('private thought'))

      const beforeCollapse = outputText.length
      type(input, '/thinking')
      onEvent?.({
        ...base, kind: 'assistant_reasoning_delta', seq: 4, itemId: 'reason_stream',
        item: {
          id: 'reason_stream', threadId: current.id, turnId: 'turn_stream', role: 'assistant',
          status: 'running', createdAt: base.timestamp, kind: 'assistant_reasoning',
          text: ' and this stays folded'
        }
      })
      await waitFor(() => controller.state.projection?.items.some((item) =>
        item.id === 'reason_stream' && item.kind === 'assistant_reasoning' &&
        item.text.includes('this stays folded')
      ) ?? false)
      expect(outputText.slice(beforeCollapse)).not.toContain('this stays folded')

      const beforeShow = outputText.length
      type(input, '/thinking')
      await waitFor(() => outputText.slice(beforeShow).includes('this stays folded'))

      onEvent?.({
        ...base, kind: 'item_completed', seq: 5,
        item: {
          id: 'item_stream', threadId: current.id, turnId: 'turn_stream', role: 'assistant',
          status: 'completed', createdAt: base.timestamp, kind: 'assistant_text', text: 'Hello'
        }
      })
      onEvent?.({
        kind: 'turn_completed', seq: 6, timestamp: base.timestamp, threadId: current.id,
        turnId: 'turn_stream', status: 'completed'
      })
      await waitFor(() => controller.state.projection?.runningTurnId === undefined)
      expect(controller.state.projection?.items.find((item) => item.id === 'item_stream')).toMatchObject({ text: 'Hello' })
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })

  it('renders persistent actionable model failures instead of an empty Ready conversation', async () => {
    const current = detail()
    current.status = 'running'
    current.turns = [{
      id: 'turn_auth', threadId: current.id, status: 'running', orchestration: 'direct', prompt: 'Hello', steering: [],
      createdAt: current.createdAt, startedAt: current.createdAt,
      items: [{
        id: 'user_auth', threadId: current.id, turnId: 'turn_auth', role: 'user', status: 'completed',
        createdAt: current.createdAt, kind: 'user_message', text: 'Hello'
      }], attachmentIds: [], activeSkillIds: [], injectedMemoryIds: [], injectedMemorySummaries: [],
      injectedInstructionSources: []
    }]
    let onEvent: ((event: RuntimeEvent) => void) | undefined
    const client = {
      listThreads: vi.fn(async () => [current]), getThread: vi.fn(async () => current),
      delegationDiagnostics: vi.fn(async () => ({ enabled: true, active: 0, childRuns: [], aggregates: [] })),
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
      columns: 92, rows: 26, write: (chunk: string) => { outputText += chunk }
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(controller, input, output)
    const running = app.run()
    try {
      const base = { timestamp: '2026-07-23T01:27:22.000Z', threadId: current.id, turnId: 'turn_auth' }
      onEvent?.({
        ...base, kind: 'error', seq: 1, code: 'http_401', severity: 'error',
        message: 'model request failed with status 401: invalid or expired credentials; no auth context'
      })
      onEvent?.({
        ...base, kind: 'turn_failed', seq: 2, status: 'failed', code: 'http_401',
        message: 'model request failed with status 401: invalid or expired credentials; no auth context'
      })
      await waitFor(() => outputText.includes('Model connection failed'))
      expect(outputText).toContain('Run /connect')
      expect(outputText).toContain('/model')
      expect(outputText).toContain('HTTP 401')
      expect(outputText).not.toContain('no auth context')
      expect(controller.state.projection?.runningTurnId).toBeUndefined()
      expect(controller.state.projection?.items).toContainEqual(expect.objectContaining({ kind: 'error', code: 'http_401' }))
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })
})
