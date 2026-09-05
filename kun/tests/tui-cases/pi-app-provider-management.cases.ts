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

describe("PiTuiApplication provider management", () => {
  it('keeps a failed custom probe in the wizard and requires explicit confirmation to save supplied models', async () => {
    const current = detail()
    const initial = modelSnapshot()
    const connected: ModelConnectionSnapshot = {
      ...initial,
      revision: initial.revision + 1,
      providers: [...initial.providers, {
        id: 'offline-proxy',
        accountId: 'account:offline-proxy',
        name: 'Offline Proxy',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://offline.example.test/v1',
        endpointFormat: 'chat_completions',
        useProxy: false,
        configured: true,
        models: ['offline-model'],
        selectedModel: 'offline-model'
      }],
      defaultProviderId: 'offline-proxy',
      defaultAccountId: 'account:offline-proxy',
      defaultModel: 'offline-model'
    }
    const connectModel = vi.fn()
      .mockRejectedValueOnce(new Error('provider probe failed with HTTP 404'))
      .mockResolvedValueOnce(connected)
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] })),
      modelConnections: vi.fn(async () => initial),
      connectModel
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options, runtime)
    await controller.start()
    controller.applyModelSelection(initial, false)
    const input = Object.assign(new EventEmitter(), {
      isRaw: false, setRawMode: vi.fn(), setEncoding: vi.fn(), resume: vi.fn(), pause: vi.fn()
    }) as unknown as TerminalInput
    let outputText = ''
    const output = Object.assign(new EventEmitter(), {
      columns: 84, rows: 24, write: (chunk: string) => { outputText += chunk }
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(controller, input, output)
    const running = app.run()
    const replaceField = (value: string): void => {
      input.emit('data', '\x15')
      type(input, value)
    }
    try {
      type(input, '/connect')
      await waitFor(() => sanitizeTerminalText(outputText).includes('KUN / Connect'))
      input.emit('data', '\r')
      await waitFor(() => outputText.includes('Custom provider'))
      input.emit('data', '\r')
      await waitFor(() => outputText.includes('Provider ID'))
      replaceField('offline-proxy')
      replaceField('Offline Proxy')
      replaceField('https://offline.example.test/v1')
      input.emit('data', '\r') // keep chat_completions
      type(input, 'offline-secret')
      type(input, 'offline-model')

      await waitFor(() => outputText.includes('Probe failed'))
      expect(connectModel).toHaveBeenCalledTimes(1)
      expect(connectModel.mock.calls[0]?.[0]).toMatchObject({ probe: true })
      expect(controller.state.modelConnections?.providers.some((profile) => profile.id === 'offline-proxy')).toBe(false)
      expect(outputText).not.toContain('offline-secret')

      input.emit('data', '\x13') // Ctrl+S explicitly accepts the supplied catalog.
      await waitFor(() => connectModel.mock.calls.length === 2)
      expect(connectModel.mock.calls[1]?.[0]).toMatchObject({
        id: 'offline-proxy',
        credential: 'offline-secret',
        models: ['offline-model'],
        probe: false
      })
      await waitFor(() => controller.state.modelConnections?.defaultProviderId === 'offline-proxy')
      expect(outputText).not.toContain('offline-secret')
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })

  it('refreshes the custom-provider wizard on a concurrent connection revision conflict', async () => {
    const current = detail()
    const initial = modelSnapshot()
    const latest: ModelConnectionSnapshot = {
      ...initial,
      revision: initial.revision + 1,
      providers: [...initial.providers, {
        id: 'external-provider',
        accountId: 'account:external-provider',
        name: 'External Provider',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://external.example.test/v1',
        endpointFormat: 'chat_completions',
        useProxy: false,
        configured: true,
        models: ['external-model'],
        selectedModel: 'external-model'
      }]
    }
    const modelConnections = vi.fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(latest)
    const connectModel = vi.fn(async () => {
      throw new TuiClientError(
        'model connection registry revision changed',
        409,
        'revision_conflict',
        '/v1/model-connections'
      )
    })
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] })),
      modelConnections,
      connectModel
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options, runtime)
    await controller.start()
    controller.applyModelSelection(initial, false)
    const input = Object.assign(new EventEmitter(), {
      isRaw: false, setRawMode: vi.fn(), setEncoding: vi.fn(), resume: vi.fn(), pause: vi.fn()
    }) as unknown as TerminalInput
    let outputText = ''
    const output = Object.assign(new EventEmitter(), {
      columns: 88, rows: 26, write: (chunk: string) => { outputText += chunk }
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(controller, input, output)
    const running = app.run()
    const replaceField = (value: string): void => {
      input.emit('data', '\x15')
      type(input, value)
    }
    try {
      type(input, '/connect')
      await waitFor(() => sanitizeTerminalText(outputText).includes('KUN / Connect'))
      input.emit('data', '\r')
      input.emit('data', '\r')
      await waitFor(() => outputText.includes('Provider ID'))
      replaceField('conflicting-provider')
      replaceField('Conflicting Provider')
      replaceField('https://conflict.example.test/v1')
      input.emit('data', '\r')
      type(input, 'conflict-secret')
      type(input, 'conflict-model')

      await waitFor(() => outputText.includes('Connections changed in another client'))
      expect(modelConnections).toHaveBeenCalledTimes(2)
      expect(controller.state.modelConnections?.revision).toBe(latest.revision)
      expect(controller.state.modelConnections?.providers.some((profile) => profile.id === 'external-provider')).toBe(true)
      expect(outputText).not.toContain('External Provider')
      expect(outputText).not.toContain('conflict-secret')
      expect(connectModel).toHaveBeenCalledTimes(1)
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })

  it('shows unconfigured GUI catalogs in /model but requires /connect before selection', async () => {
    const current = detail()
    const catalog: ModelConnectionSnapshot = {
      ...modelSnapshot(),
      providers: [...modelSnapshot().providers, {
        id: 'zenmux', accountId: 'account:zenmux', name: 'ZenMux', kind: 'http',
        authType: 'api-key', baseUrl: 'https://zenmux.ai/api/v1',
        endpointFormat: 'chat_completions', useProxy: false, configured: false,
        models: ['future-model'], selectedModel: 'future-model'
      }]
    }
    const selectModel = vi.fn()
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] })),
      modelConnections: vi.fn(async () => catalog),
      selectModel
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options, runtime)
    await controller.start()
    controller.applyModelSelection(catalog, false)
    const input = Object.assign(new EventEmitter(), {
      isRaw: false, setRawMode: vi.fn(), setEncoding: vi.fn(), resume: vi.fn(), pause: vi.fn()
    }) as unknown as TerminalInput
    let outputText = ''
    const output = Object.assign(new EventEmitter(), {
      columns: 80, rows: 24, write: (chunk: string) => { outputText += chunk }
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(controller, input, output)
    const running = app.run()
    try {
      type(input, '/model')
      await waitFor(() => outputText.includes('ZenMux') && outputText.includes('future-model'))
      const before = outputText.length
      for (const character of 'zenmux') input.emit('data', character)
      input.emit('data', '\r')
      await waitFor(() => outputText.slice(before).includes('Run /connect'))
      expect(selectModel).not.toHaveBeenCalled()
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })

  it('shows a configured provider with a missing credential as disconnected and opens reconnect', async () => {
    const current = detail()
    const base = modelSnapshot()
    const catalog: ModelConnectionSnapshot = {
      ...base,
      providers: [...base.providers, {
        id: 'broken-legacy',
        accountId: 'account:broken-legacy',
        name: 'Broken Legacy',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://legacy.example.test/v1',
        endpointFormat: 'chat_completions',
        useProxy: false,
        configured: true,
        credentialStatus: 'missing',
        credentialErrorCode: 'credential_missing',
        models: ['legacy-model'],
        selectedModel: 'legacy-model'
      }]
    }
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] })),
      modelConnections: vi.fn(async () => catalog)
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options, runtime)
    await controller.start()
    controller.applyModelSelection(catalog, false)
    const input = Object.assign(new EventEmitter(), {
      isRaw: false, setRawMode: vi.fn(), setEncoding: vi.fn(), resume: vi.fn(), pause: vi.fn()
    }) as unknown as TerminalInput
    let outputText = ''
    const output = Object.assign(new EventEmitter(), {
      columns: 88, rows: 26, write: (chunk: string) => { outputText += chunk }
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(controller, input, output)
    const running = app.run()
    try {
      type(input, '/connect')
      await waitFor(() => {
        const visible = sanitizeTerminalText(outputText)
        return visible.includes('2/3 connected') && visible.includes('Credential missing')
      })

      input.emit('data', '\x1b[F')
      input.emit('data', '\r')
      await waitFor(() => outputText.includes('API key / token plan key'))
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })

  it('keeps an unreadable configured provider in /model but refuses selection', async () => {
    const current = detail()
    const base = modelSnapshot()
    const catalog: ModelConnectionSnapshot = {
      ...base,
      providers: [...base.providers, {
        id: 'unreadable-legacy',
        accountId: 'account:unreadable-legacy',
        name: 'Unreadable Legacy',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://unreadable.example.test/v1',
        endpointFormat: 'chat_completions',
        useProxy: false,
        configured: true,
        credentialStatus: 'unreadable',
        credentialErrorCode: 'credential_unreadable',
        models: ['unreadable-model'],
        selectedModel: 'unreadable-model'
      }]
    }
    const selectModel = vi.fn()
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] })),
      modelConnections: vi.fn(async () => catalog),
      selectModel
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options, runtime)
    await controller.start()
    controller.applyModelSelection(catalog, false)
    const input = Object.assign(new EventEmitter(), {
      isRaw: false, setRawMode: vi.fn(), setEncoding: vi.fn(), resume: vi.fn(), pause: vi.fn()
    }) as unknown as TerminalInput
    let outputText = ''
    const output = Object.assign(new EventEmitter(), {
      columns: 88, rows: 26, write: (chunk: string) => { outputText += chunk }
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(controller, input, output)
    const running = app.run()
    try {
      type(input, '/model')
      await waitFor(() => outputText.includes('Unreadable Legacy') && outputText.includes('unreadable-model'))
      const before = outputText.length
      type(input, 'unreadable')
      input.emit('data', '\r')
      await waitFor(() => outputText.slice(before).includes('Run /connect'))
      expect(selectModel).not.toHaveBeenCalled()
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })

  it('applies configured semantic keys inside session and model selectors', async () => {
    let current = detail()
    const updateThread = vi.fn(async (_id: string, patch: Partial<ThreadDetail>) => {
      current = { ...current, ...patch }
      return current
    })
    const catalog = modelSnapshot()
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
      updateThread,
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] })),
      modelConnections: vi.fn(async () => catalog)
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options, runtime)
    await controller.start()
    controller.applyModelSelection(catalog, false)
    const input = Object.assign(new EventEmitter(), {
      isRaw: false, setRawMode: vi.fn(), setEncoding: vi.fn(), resume: vi.fn(), pause: vi.fn()
    }) as unknown as TerminalInput
    let outputText = ''
    const output = Object.assign(new EventEmitter(), {
      columns: 72, rows: 22, write: (chunk: string) => { outputText += chunk }
    }) as unknown as TerminalOutput
    const keymap = parseTuiKeymapConfig({ keybinds: {
      session_pin: 'f3', session_delete: 'none',
      model_provider_list: 'f4', model_favorite_toggle: 'none'
    } }).keymap
    const app = new PiTuiApplication(controller, input, output, keymap)
    const running = app.run()
    try {
      input.emit('data', '\x18')
      input.emit('data', 'l')
      await waitFor(() => outputText.includes('Sessions'))
      input.emit('data', '\x1bOR') // F3
      await waitFor(() => updateThread.mock.calls.length === 1)
      expect(updateThread).toHaveBeenCalledWith('thr_pi', { pinned: true })
      input.emit('data', '\x1b')

      type(input, '/model')
      await waitFor(() => outputText.includes('Kimi Code'))
      const before = outputText.length
      input.emit('data', '\x1bOS') // F4
      await waitFor(() => outputText.slice(before).includes('Providers & accounts'))
      expect(sanitizeTerminalText(outputText.slice(before))).toContain('F4 all models')
      input.emit('data', '\x1b')
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })
})
