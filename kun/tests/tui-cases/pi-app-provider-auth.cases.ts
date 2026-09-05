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

describe("PiTuiApplication shared provider authentication", () => {
  it('refreshes an open model route when another client changes the shared catalog', async () => {
    const current = detail()
    const initial = modelSnapshot()
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] })),
      modelConnections: vi.fn(async () => initial)
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options, runtime)
    await controller.start()
    controller.applyModelSelection(initial, false)
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
      type(input, '/model')
      await waitFor(() => outputText.includes('Kimi Code'))
      const before = outputText.length
      const updated: ModelConnectionSnapshot = {
        ...initial,
        revision: initial.revision + 1,
        providers: [...initial.providers, {
          id: 'claude', accountId: 'account:claude', name: 'Claude', kind: 'http',
          authType: 'api-key', endpointFormat: 'messages', useProxy: false, configured: true,
          models: ['claude-opus-4-6'], selectedModel: 'claude-opus-4-6'
        }]
      }
      controller.applyModelSelection(updated, false)
      await waitFor(() => outputText.slice(before).includes('Claude'))
      expect(outputText.slice(before)).toContain('claude-opus-4-6')
      input.emit('data', '\x1b')
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })

  it('shows the complete shared GUI catalog and submits a masked Grok callback result', async () => {
    const current = detail()
    const initial = modelSnapshot()
    const catalog = providerCatalogEntries()
    const freeCount = catalog.filter((entry) => entry.category === 'free').length
    const subscriptionCount = catalog.filter((entry) => entry.category === 'subscription').length
    const apiCount = catalog.filter((entry) => entry.category === 'api').length
    const grokProfile = {
      id: 'grok-subscription',
      accountId: 'account:grok-subscription',
      name: 'Grok 订阅',
      presetSource: 'grok-subscription',
      kind: 'http' as const,
      authType: 'oauth' as const,
      baseUrl: 'https://cli-chat-proxy.grok.com/v1',
      endpointFormat: 'responses' as const,
      useProxy: false,
      configured: true,
      models: [
        'grok-4.5',
        'grok-4-1-fast-reasoning',
        'grok-4-1-fast-non-reasoning',
        'grok-code-fast-1'
      ],
      selectedModel: 'grok-4.5'
    }
    const connected: ModelConnectionSnapshot = {
      ...initial,
      revision: initial.revision + 1,
      providers: [...initial.providers, grokProfile],
      defaultProviderId: grokProfile.id,
      defaultAccountId: grokProfile.accountId,
      defaultModel: grokProfile.selectedModel
    }
    const startModelOAuth = vi.fn(async () => ({
      sessionId: 'oauth-grok-1',
      provider: 'grok' as const,
      status: 'pending' as const,
      expiresAt: '2026-07-23T12:00:00.000Z'
    }))
    const submitModelOAuth = vi.fn(async () => ({
      sessionId: 'oauth-grok-1',
      provider: 'grok' as const,
      status: 'connected' as const,
      expiresAt: '2026-07-23T12:00:00.000Z',
      snapshot: connected
    }))
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] })),
      modelConnections: vi.fn(async () => initial),
      startModelOAuth,
      submitModelOAuth,
      modelOAuthStatus: vi.fn(async () => ({
        sessionId: 'oauth-grok-1',
        provider: 'grok' as const,
        status: 'pending' as const,
        expiresAt: '2026-07-23T12:00:00.000Z'
      })),
      cancelModelOAuth: vi.fn()
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options, runtime)
    await controller.start()
    controller.applyModelSelection(initial, false)
    const input = Object.assign(new EventEmitter(), {
      isRaw: false, setRawMode: vi.fn(), setEncoding: vi.fn(), resume: vi.fn(), pause: vi.fn()
    }) as unknown as TerminalInput
    let outputText = ''
    const output = Object.assign(new EventEmitter(), {
      columns: 92, rows: 28, write: (chunk: string) => { outputText += chunk }
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(controller, input, output)
    const running = app.run()
    const callback = 'http://127.0.0.1:45678/callback?code=browser-code-secret&state=state-1'
    try {
      type(input, '/connect')
      await waitFor(() => sanitizeTerminalText(outputText).includes('KUN / Connect'))
      input.emit('data', '\r')
      await waitFor(() =>
        outputText.includes(`${freeCount} free`) &&
        outputText.includes(`${subscriptionCount} subscriptions`) &&
        outputText.includes(`${apiCount} APIs`) &&
        outputText.includes('Google Antigravity 订阅') &&
        outputText.includes('Cursor 订阅')
      )
      type(input, 'grok')
      await waitFor(() => outputText.includes('Grok 订阅'))
      input.emit('data', '\r')
      await waitFor(() => outputText.includes('Paste the authorization code or complete callback URL'))

      input.emit('data', `\x1b[200~${callback}\x1b[201~`)
      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(outputText).toContain('•')
      expect(outputText).not.toContain('browser-code-secret')
      input.emit('data', '\r')

      await waitFor(() => submitModelOAuth.mock.calls.length === 1)
      expect(startModelOAuth).toHaveBeenCalledWith({
        expectedRevision: initial.revision,
        provider: 'grok',
        model: 'grok-4.5',
        select: true
      })
      expect(submitModelOAuth).toHaveBeenCalledWith('oauth-grok-1', callback)
      await waitFor(() => controller.state.modelConnections?.defaultProviderId === 'grok-subscription')
      expect(outputText).not.toContain('browser-code-secret')
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })

  it('authenticates and selects a new Gemini CLI subscription through the official CLI handoff', async () => {
    const current = detail()
    const initial = modelSnapshot()
    const geminiProfile = {
      id: 'gemini-cli-subscription',
      accountId: 'account:gemini-cli-subscription',
      name: 'Gemini CLI 订阅（API）',
      presetSource: 'gemini-cli-subscription',
      kind: 'gemini-cli-api' as const,
      authType: 'subscription' as const,
      endpointFormat: 'custom_endpoint' as const,
      useProxy: false,
      configured: true,
      models: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview'],
      selectedModel: 'gemini-3.1-pro-preview'
    }
    const connected: ModelConnectionSnapshot = {
      ...initial,
      revision: initial.revision + 1,
      providers: [...initial.providers, geminiProfile],
      defaultProviderId: geminiProfile.id,
      defaultAccountId: geminiProfile.accountId,
      defaultModel: geminiProfile.selectedModel
    }
    const completeModelCliAuth = vi.fn(async () => connected)
    const authenticateOfficialProvider = vi.fn(async () => undefined)
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] })),
      modelConnections: vi.fn(async () => initial),
      completeModelCliAuth
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options, runtime)
    await controller.start()
    controller.applyModelSelection(initial, false)
    const input = Object.assign(new EventEmitter(), {
      isRaw: false, setRawMode: vi.fn(), setEncoding: vi.fn(), resume: vi.fn(), pause: vi.fn()
    }) as unknown as TerminalInput
    let outputText = ''
    const output = Object.assign(new EventEmitter(), {
      columns: 92, rows: 28, write: (chunk: string) => { outputText += chunk }
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(
      controller,
      input,
      output,
      undefined,
      async () => null,
      authenticateOfficialProvider
    )
    const running = app.run()
    try {
      type(input, '/connect')
      await waitFor(() => sanitizeTerminalText(outputText).includes('KUN / Connect'))
      input.emit('data', '\r')
      await waitFor(() => outputText.includes('Add provider'))
      type(input, 'gemini-cli-subscription')

      await waitFor(() => completeModelCliAuth.mock.calls.length === 1)
      expect(authenticateOfficialProvider).toHaveBeenCalledWith('gemini-cli')
      expect(completeModelCliAuth).toHaveBeenCalledWith({
        expectedRevision: initial.revision,
        provider: 'gemini-cli',
        model: 'gemini-3.7-pro-preview',
        select: true
      })
      await waitFor(() =>
        controller.state.modelConnections?.defaultProviderId === 'gemini-cli-subscription'
      )
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })

  it('keeps the existing default when Gemini CLI reconnect is cancelled', async () => {
    const current = detail()
    const initialBase = modelSnapshot()
    const initial: ModelConnectionSnapshot = {
      ...initialBase,
      providers: [...initialBase.providers, {
        id: 'gemini-cli-subscription',
        accountId: 'account:gemini-cli-subscription',
        name: 'Gemini CLI 订阅（API）',
        presetSource: 'gemini-cli-subscription',
        kind: 'gemini-cli-api',
        authType: 'subscription',
        endpointFormat: 'custom_endpoint',
        useProxy: false,
        configured: true,
        models: ['gemini-3.1-pro-preview'],
        selectedModel: 'gemini-3.1-pro-preview'
      }]
    }
    const completeModelCliAuth = vi.fn()
    const authenticateOfficialProvider = vi.fn(async () => {
      throw new Error('Google login cancelled')
    })
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] })),
      modelConnections: vi.fn(async () => initial),
      completeModelCliAuth
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options, runtime)
    await controller.start()
    controller.applyModelSelection(initial, false)
    const input = Object.assign(new EventEmitter(), {
      isRaw: false, setRawMode: vi.fn(), setEncoding: vi.fn(), resume: vi.fn(), pause: vi.fn()
    }) as unknown as TerminalInput
    let outputText = ''
    const output = Object.assign(new EventEmitter(), {
      columns: 92, rows: 28, write: (chunk: string) => { outputText += chunk }
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(
      controller,
      input,
      output,
      undefined,
      async () => null,
      authenticateOfficialProvider
    )
    const running = app.run()
    try {
      type(input, '/connect')
      await waitFor(() => sanitizeTerminalText(outputText).includes('KUN / Connect'))
      input.emit('data', '\x1b[F')
      input.emit('data', '\r')
      await waitFor(() => outputText.includes('Sign in again / reconnect'))
      input.emit('data', '\x1b[B')
      input.emit('data', '\r')

      await waitFor(() => outputText.includes('Google login cancelled'))
      expect(authenticateOfficialProvider).toHaveBeenCalledWith('gemini-cli')
      expect(completeModelCliAuth).not.toHaveBeenCalled()
      expect(controller.state.modelConnections?.defaultProviderId).toBe('deepseek')
      expect(controller.state.modelConnections?.defaultModel).toBe('deepseek-v4-pro')
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })

  it('maps every shared catalog authentication flow to an implemented TUI strategy', () => {
    const strategies = new Map(
      providerCatalogEntries().map((entry) => [
        entry.authFlow,
        authenticationStrategy(entry.authFlow)
      ])
    )

    expect(strategies).toEqual(new Map([
      ['api-key', 'secret'],
      ['chatgpt-oauth', 'runtime'],
      ['grok-oauth', 'runtime'],
      ['claude-subscription', 'runtime'],
      ['gemini-subscription', 'official-cli'],
      ['gemini-cli-subscription', 'official-cli'],
      ['cursor-api-key', 'secret']
    ]))
  })

  it('creates a custom provider from the explicit /connect entry and publishes it to /model', async () => {
    const current = detail()
    const initial = modelSnapshot()
    const connected: ModelConnectionSnapshot = {
      ...initial,
      revision: initial.revision + 1,
      providers: [...initial.providers, {
        id: 'acme-proxy',
        accountId: 'account:acme-proxy',
        name: 'Acme Proxy',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://models.acme.test/v1',
        endpointFormat: 'responses',
        useProxy: false,
        configured: true,
        models: ['acme-fast', 'acme-reasoning'],
        selectedModel: 'acme-fast'
      }],
      defaultProviderId: 'acme-proxy',
      defaultAccountId: 'account:acme-proxy',
      defaultModel: 'acme-fast'
    }
    const connectModel = vi.fn(async () => connected)
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
      await waitFor(() => outputText.includes('Add a provider'))
      input.emit('data', '\r')
      await waitFor(() => outputText.includes('Custom provider'))
      input.emit('data', '\r')
      await waitFor(() => outputText.includes('Provider ID'))

      replaceField('acme proxy')
      await waitFor(() => outputText.includes('Provider name'))
      replaceField('Acme Proxy')
      await waitFor(() => outputText.includes('Base URL'))
      replaceField('https://models.acme.test/v1')
      await waitFor(() => outputText.includes('Endpoint format'))
      input.emit('data', '\x1b[C') // responses
      input.emit('data', '\r')
      await waitFor(() => outputText.includes('API key / token plan key'))
      type(input, 'top-secret-provider-key')
      await waitFor(() => outputText.includes('Models (comma separated)'))
      type(input, 'acme-fast, acme-reasoning')

      await waitFor(() => connectModel.mock.calls.length === 1)
      expect(connectModel).toHaveBeenCalledWith({
        expectedRevision: initial.revision,
        id: 'acme-proxy',
        name: 'Acme Proxy',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://models.acme.test/v1',
        endpointFormat: 'responses',
        credential: 'top-secret-provider-key',
        models: ['acme-fast', 'acme-reasoning'],
        selectedModel: 'acme-fast',
        probe: true,
        select: true
      })
      await waitFor(() => controller.state.modelConnections?.defaultProviderId === 'acme-proxy')
      expect(outputText).not.toContain('top-secret-provider-key')

      const beforeModels = outputText.length
      type(input, '/model')
      await waitFor(() => outputText.slice(beforeModels).includes('Acme Proxy'))
      const modelFrame = outputText.slice(beforeModels)
      expect(modelFrame).toContain('acme-fast')
      expect(modelFrame).toContain('acme-reasoning')
      expect(modelFrame).toContain('current')
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })
})
