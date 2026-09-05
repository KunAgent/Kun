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

describe("PiTuiApplication permissions and dialogs", () => {
  it('maps the three GUI-aligned permission modes and removes raw Advanced editing', async () => {
    const presetSave = vi.fn(async () => true)
    const closePreset = vi.fn()
    const presetDialog = new PermissionDialog(
      { setPermissions: presetSave } as unknown as TuiController,
      'on-request',
      'workspace-write',
      'user',
      closePreset
    )
    const presetFrame = sanitizeTerminalText(presetDialog.render(100).join('\n'))
    for (const label of [
      'Ask for approval',
      'Approve for me',
      'Full access'
    ]) {
      expect(presetFrame).toContain(label)
    }
    expect(presetFrame).not.toContain('Approval policy')
    expect(presetFrame).not.toContain('Advanced')

    presetDialog.handleInput('\x1b[B')
    presetDialog.handleInput('\r')
    await waitFor(() => presetSave.mock.calls.length === 1)
    expect(presetSave).toHaveBeenCalledWith('on-request', 'workspace-write', 'agent')
    expect(closePreset).toHaveBeenCalledOnce()

    // Rendering a custom legacy pair projects it conservatively without
    // writing. An explicit save canonicalizes all three authority fields.
    const customSave = vi.fn(async () => true)
    const customDialog = new PermissionDialog(
      { setPermissions: customSave } as unknown as TuiController,
      'never',
      'read-only',
      'user',
      vi.fn()
    )
    const projectedAskRow = customDialog.render(100)
      .map((line) => sanitizeTerminalText(line))
      .find((line) => line.includes('Ask for approval'))
    expect(projectedAskRow).toContain('│ Ask for approval')
    expect(customSave).not.toHaveBeenCalled()
    customDialog.handleInput('a')
    expect(sanitizeTerminalText(customDialog.render(100).join('\n'))).not.toContain('Advanced')
    customDialog.handleInput('\r')
    await waitFor(() => customSave.mock.calls.length === 1)
    expect(customSave).toHaveBeenCalledWith('on-request', 'workspace-write', 'user')

    const cancelSave = vi.fn(async () => true)
    const cancelClose = vi.fn()
    const cancelDialog = new PermissionDialog(
      { setPermissions: cancelSave } as unknown as TuiController,
      'suggest',
      'external-sandbox',
      'user',
      cancelClose
    )
    cancelDialog.handleInput('\x1b')
    expect(cancelClose).toHaveBeenCalledOnce()
    expect(cancelSave).not.toHaveBeenCalled()
  })

  it('requires a second explicit confirmation only when elevating to Full access', async () => {
    const restrictedSave = vi.fn(async () => true)
    const restrictedClose = vi.fn()
    const restrictedDialog = new PermissionDialog(
      { setPermissions: restrictedSave } as unknown as TuiController,
      'on-request',
      'workspace-write',
      'user',
      restrictedClose
    )
    restrictedDialog.handleInput('\x1b[B')
    restrictedDialog.handleInput('\x1b[B')
    restrictedDialog.handleInput('\r')

    expect(restrictedSave).not.toHaveBeenCalled()
    const confirmation = sanitizeTerminalText(restrictedDialog.render(100).join('\n'))
    expect(confirmation).toContain('Enable Full access?')
    expect(confirmation).toContain('access any file on this computer')
    expect(confirmation).toContain('execute host commands')
    expect(confirmation).toContain('network-capable tools')

    restrictedDialog.handleInput('\x1b')
    expect(restrictedSave).not.toHaveBeenCalled()
    expect(restrictedClose).not.toHaveBeenCalled()
    expect(sanitizeTerminalText(restrictedDialog.render(100).join('\n')))
      .toContain('Tool permission mode')

    restrictedDialog.handleInput('\r')
    expect(restrictedSave).not.toHaveBeenCalled()
    restrictedDialog.handleInput('\r')
    await waitFor(() => restrictedSave.mock.calls.length === 1)
    expect(restrictedSave).toHaveBeenCalledWith('auto', 'danger-full-access', 'user')
    expect(restrictedClose).toHaveBeenCalledOnce()

    const alreadyFullSave = vi.fn(async () => true)
    const alreadyFullDialog = new PermissionDialog(
      { setPermissions: alreadyFullSave } as unknown as TuiController,
      'auto',
      'danger-full-access',
      'user',
      vi.fn()
    )
    alreadyFullDialog.handleInput('\r')
    await waitFor(() => alreadyFullSave.mock.calls.length === 1)
    expect(alreadyFullSave).toHaveBeenCalledWith('auto', 'danger-full-access', 'user')

    const lowerAuthoritySave = vi.fn(async () => true)
    const lowerAuthorityDialog = new PermissionDialog(
      { setPermissions: lowerAuthoritySave } as unknown as TuiController,
      'auto',
      'danger-full-access',
      'user',
      vi.fn()
    )
    lowerAuthorityDialog.handleInput('\x1b[A')
    lowerAuthorityDialog.handleInput('\r')
    await waitFor(() => lowerAuthoritySave.mock.calls.length === 1)
    expect(lowerAuthoritySave).toHaveBeenCalledWith(
      'on-request',
      'workspace-write',
      'agent'
    )
  })

  it('renders GUI-aligned permission presets in a narrow inline terminal and restores focus', async () => {
    let current = detail()
    const updateThread = vi.fn(async (_id: string, patch: Partial<ThreadDetail>) => {
      current = { ...current, ...patch }
      return current
    })
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
      skills: vi.fn(async () => ({ enabled: true, roots: [], skills: [], validationErrors: [] })),
      updateThread
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
      columns: 38,
      rows: 16,
      write: (chunk: string) => { outputText += chunk }
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(controller, input, output)
    const running = app.run()
    try {
      type(input, '/status')
      await waitFor(() => outputText.includes('Status'))
      expect(outputText).not.toContain('Mode: agent')
      const beforeStatusScroll = outputText.length
      input.emit('data', '\x1b[B')
      await waitFor(() => /Mode\s+agent/u.test(sanitizeTerminalText(outputText.slice(beforeStatusScroll))))
      input.emit('data', '\x1b')
      const beforePermission = outputText.length
      type(input, '/permission')
      await waitFor(() => outputText.slice(beforePermission).includes('Full access'))
      const narrowPresetFrame = sanitizeTerminalText(outputText.slice(beforePermission))
      expect(narrowPresetFrame).toContain('Tool permission mode')
      expect(narrowPresetFrame).toContain('Ask for approval')
      expect(narrowPresetFrame).toContain('Approve for me')
      expect(narrowPresetFrame).toContain('Full access')
      expect(narrowPresetFrame).not.toContain('adva')
      expect(narrowPresetFrame).not.toContain('Approval policy')
      input.emit('data', '\r')
      await waitFor(() => updateThread.mock.calls.length > 0)

      expect(outputText).not.toContain('\x1b[?1049h')
      expect(updateThread).toHaveBeenCalledWith('thr_pi', {
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        approvalReviewer: 'user'
      })
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
    expect(input.setRawMode).toHaveBeenLastCalledWith(false)
    expect(outputText).not.toContain('\x1b[?1049l')
  })

  it('keeps every major keyboard dialog operable and restores the composer on a narrow terminal', async () => {
    const current = detail()
    current.providerId = 'deepseek'
    current.accountId = 'account:deepseek'
    current.model = 'deepseek-v4-pro'
    const startTurn = vi.fn(async () => ({ turnId: 'turn_focus' }))
    const catalog: ModelConnectionSnapshot = {
      ...modelSnapshot(),
      providers: modelSnapshot().providers.map((provider) => provider.id === 'deepseek'
        ? {
            ...provider,
            modelCapabilities: {
              'deepseek-v4-pro': {
                id: 'deepseek-v4-pro', inputModalities: ['text'], outputModalities: ['text'],
                supportsToolCalling: true, messageParts: ['text'],
                reasoning: {
                  supportedEfforts: ['low', 'high'], defaultEffort: 'low',
                  requestProtocol: 'deepseek-chat-completions'
                }
              }
            }
          }
        : provider)
    }
    const client = {
      listThreads: vi.fn(async () => [current]),
      getThread: vi.fn(async () => current),
      subscribeThreadEvents: vi.fn(async (input: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
      }),
      skills: vi.fn(async () => ({
        enabled: true, roots: ['/tmp/project/.agents/skills'], validationErrors: [],
        skills: [{ id: 'review', name: 'Review', description: 'Review changes', version: '1',
          root: '/tmp/project/.agents/skills/review', source: 'project', legacy: false, allowedTools: [] }]
      })),
      modelConnections: vi.fn(async () => catalog),
      startTurn
    } as unknown as KunTuiClient
    const controller = new TuiController(client, options, runtime)
    await controller.start()
    controller.applyModelSelection(catalog, false)

    const input = Object.assign(new EventEmitter(), {
      isRaw: false, setRawMode: vi.fn(), setEncoding: vi.fn(), resume: vi.fn(), pause: vi.fn()
    }) as unknown as TerminalInput
    let outputText = ''
    const output = Object.assign(new EventEmitter(), {
      columns: 44, rows: 18, write: (chunk: string) => { outputText += chunk }
    }) as unknown as TerminalOutput
    const app = new PiTuiApplication(controller, input, output)
    const running = app.run()
    const openSlashAndCancel = async (command: string, expected: string) => {
      const before = outputText.length
      type(input, command)
      await waitFor(() => sanitizeTerminalText(outputText.slice(before)).includes(expected))
      input.emit('data', '\x03')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    try {
      await openSlashAndCancel('/help', 'KUN / Help')
      await openSlashAndCancel('/timeline', 'Timeline')
      await openSlashAndCancel('/skills', 'KUN / Skills')
      await openSlashAndCancel('/connect', 'KUN / Connect')
      await openSlashAndCancel('/variants', 'Reasoning effort')

      let before = outputText.length
      input.emit('data', '\x18')
      input.emit('data', 'a')
      await waitFor(() => sanitizeTerminalText(outputText.slice(before)).includes('KUN / Mode'))
      expect(sanitizeTerminalText(outputText.slice(before))).toContain('Goal')
      expect(sanitizeTerminalText(outputText.slice(before))).toContain('Keep pursuing')
      input.emit('data', '\x03')

      before = outputText.length
      input.emit('data', '\x10')
      await waitFor(() => outputText.slice(before).includes('Commands'))
      input.emit('data', '\x03')

      type(input, 'focus restored')
      await waitFor(() => startTurn.mock.calls.length === 1)
      expect(startTurn).toHaveBeenCalledWith('thr_pi', expect.objectContaining({ prompt: 'focus restored' }))
      expect(outputText).not.toContain('\x1b[?1049h')
    } finally {
      controller.requestQuit()
      await running
      await app.stop()
      await controller.stop()
    }
  })
})
