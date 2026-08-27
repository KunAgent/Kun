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
    revision: 3,
    providers: [
      {
        id: 'deepseek', accountId: 'account:deepseek', name: 'DeepSeek', kind: 'http',
        authType: 'api-key', baseUrl: 'https://api.deepseek.com', endpointFormat: 'chat_completions',
        configured: true, models: ['deepseek-v4-pro'], selectedModel: 'deepseek-v4-pro'
      },
      {
        id: 'kimi-code', accountId: 'account:kimi-code', name: 'Kimi Code', kind: 'http',
        authType: 'subscription', baseUrl: 'https://api.kimi.com/coding/v1', endpointFormat: 'chat_completions',
        configured: true, models: ['kimi-k2.5', 'kimi-k2-thinking'], selectedModel: 'kimi-k2.5'
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

describe("PiTuiApplication activity and tool rendering", () => {
  it('keeps immediate progress and reconnect feedback visible above stale notifications', () => {
    const controller = new TuiController({} as KunTuiClient, { ...options, continueLatest: false }, runtime)
    const submitting = renderActivityRow({
      ...controller.state,
      connection: 'connected',
      busy: true,
      busyLabel: 'Sending message',
      busyStartedAt: new Date().toISOString(),
      notification: { kind: 'info', message: 'Old model notice' }
    }, controller, 100, 0)
    expect(submitting).toContain('Sending message')
    expect(submitting).toContain('Old model notice')

    const connecting = renderActivityRow({
      ...controller.state,
      connection: 'connecting'
    }, controller, 100, 0)
    expect(connecting).toContain('Connecting')
    expect(connecting).not.toContain('Reconnecting')

    const current = detail()
    current.status = 'running'
    current.turns = [{
      id: 'turn_reconnect', threadId: current.id, status: 'running', orchestration: 'direct', prompt: 'Wait', steering: [],
      createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), items: [],
      attachmentIds: [], activeSkillIds: [], injectedMemoryIds: [], injectedMemorySummaries: [],
      injectedInstructionSources: []
    }]
    const reconnecting = renderActivityRow({
      ...controller.state,
      connection: 'reconnecting',
      projection: {
        thread: current,
        items: [],
        lastSeq: 1,
        runningTurnId: 'turn_reconnect',
        activity: {
          turnId: 'turn_reconnect',
          phase: 'responding',
          label: 'Responding',
          startedAt: current.turns[0]!.startedAt!,
          turnStartedAt: current.turns[0]!.startedAt!,
          updatedAt: current.turns[0]!.startedAt!
        },
        childRuns: [],
        approvalReviews: []
      }
    }, controller, 100, 3)
    expect(reconnecting).toContain('Reconnecting to live stream')
    expect(reconnecting).toContain('Reconnecting')
  })

  it('uses phase motion and a request-local context gauge without cumulative usage overflow', () => {
    const now = new Date().toISOString()
    const contextRuntime = {
      ...runtime,
      runtimeInfo: {
        ...runtime.runtimeInfo,
        capabilities: { model: { contextWindowTokens: 500_000 } }
      }
    } as unknown as TuiConnection
    const controller = new TuiController(
      {} as KunTuiClient,
      { ...options, continueLatest: false },
      contextRuntime
    )
    const current = detail()
    current.status = 'running'
    current.turns = [{
      id: 'turn_loading',
      threadId: current.id,
      status: 'running',
      orchestration: 'direct',
      prompt: 'Stream a response',
      steering: [],
      createdAt: now,
      startedAt: now,
      items: [],
      attachmentIds: [],
      activeSkillIds: [],
      injectedMemoryIds: [],
      injectedMemorySummaries: [],
      injectedInstructionSources: []
    }]
    const projection = projectThreadSnapshot(current)
    projection.usage = { ...emptyUsageSnapshot(), totalTokens: 750_000 }
    projection.contextSnapshot = {
      kind: 'context_snapshot',
      seq: 2,
      timestamp: now,
      threadId: current.id,
      turnId: 'turn_loading',
      model: current.model,
      stepIndex: 0,
      contextWindowTokens: 500_000,
      softThresholdTokens: 375_000,
      hardThresholdTokens: 425_000,
      estimatedInputTokens: 7_100,
      breakdown: {
        tools: 1_000,
        system: 1_000,
        skills: 100,
        messages: 5_000,
        other: 0
      },
      toolCount: 1,
      activeSkillIds: [],
      contextManagement: 'kun-managed',
      nativeHistory: 'none'
    }
    projection.activity = {
      turnId: 'turn_loading',
      phase: 'responding',
      label: 'Responding',
      startedAt: now,
      turnStartedAt: now,
      updatedAt: now
    }
    const state = { ...controller.state, connection: 'connected' as const, projection }
    const first = renderActivityRow(state, controller, 140, 0)
    const second = renderActivityRow(state, controller, 140, 1)
    const narrow = renderActivityRow(state, controller, 70, 0)
    const firstPlain = sanitizeTerminalText(first)
    const secondPlain = sanitizeTerminalText(second)
    const narrowPlain = sanitizeTerminalText(narrow)
    expect(firstPlain).toContain('▏')
    expect(secondPlain).toContain('▎')
    expect(firstPlain).not.toContain('Tip:')
    expect(secondPlain).not.toContain('Tip:')
    expect(firstPlain).toContain('7.1k / 500k · 1%')
    expect(narrowPlain).not.toContain('Tip:')
    expect(visibleWidth(first)).toBeLessThanOrEqual(140)
    expect(visibleWidth(second)).toBeLessThanOrEqual(140)
    expect(visibleWidth(narrow)).toBeLessThanOrEqual(70)
  })

  it('does not flash a redundant total timer when the first phase starts with the turn', () => {
    vi.useFakeTimers()
    try {
      const turnStartedAt = '2026-07-22T00:00:00.000Z'
      const phaseStartedAt = '2026-07-22T00:00:00.040Z'
      const controller = new TuiController(
        {} as KunTuiClient,
        { ...options, continueLatest: false },
        runtime
      )
      const current = detail()
      current.status = 'running'
      current.turns = [{
        id: 'turn_pre_send',
        threadId: current.id,
        status: 'running',
        orchestration: 'direct',
        prompt: 'Start the conversation',
        steering: [],
        createdAt: turnStartedAt,
        startedAt: turnStartedAt,
        items: [],
        attachmentIds: [],
        activeSkillIds: [],
        injectedMemoryIds: [],
        injectedMemorySummaries: [],
        injectedInstructionSources: []
      }]
      const projection = projectThreadSnapshot(current)
      projection.activity = {
        turnId: 'turn_pre_send',
        phase: 'starting',
        label: 'Pre-Send',
        startedAt: phaseStartedAt,
        turnStartedAt,
        updatedAt: phaseStartedAt
      }
      const state = { ...controller.state, connection: 'connected' as const, projection }

      const totalVisibility = [130, 160, 230, 260].map((elapsedMs, animationFrame) => {
        vi.setSystemTime(Date.parse(turnStartedAt) + elapsedMs)
        return sanitizeTerminalText(
          renderActivityRow(state, controller, 120, animationFrame)
        ).includes('· total ')
      })

      expect(totalVisibility).toEqual([false, false, false, false])
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps total timing visible when the current phase started meaningfully later', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime('2026-07-22T00:04:28.000Z')
      const turnStartedAt = '2026-07-22T00:00:00.000Z'
      const phaseStartedAt = '2026-07-22T00:04:21.300Z'
      const controller = new TuiController(
        {} as KunTuiClient,
        { ...options, continueLatest: false },
        runtime
      )
      const current = detail()
      current.status = 'running'
      current.turns = [{
        id: 'turn_pre_send',
        threadId: current.id,
        status: 'running',
        orchestration: 'direct',
        prompt: 'Continue the conversation',
        steering: [],
        createdAt: turnStartedAt,
        startedAt: turnStartedAt,
        items: [],
        attachmentIds: [],
        activeSkillIds: [],
        injectedMemoryIds: [],
        injectedMemorySummaries: [],
        injectedInstructionSources: []
      }]
      const projection = projectThreadSnapshot(current)
      projection.activity = {
        turnId: 'turn_pre_send',
        phase: 'starting',
        label: 'Pre-Send',
        startedAt: phaseStartedAt,
        turnStartedAt,
        updatedAt: phaseStartedAt
      }

      const rendered = sanitizeTerminalText(renderActivityRow({
        ...controller.state,
        connection: 'connected',
        projection
      }, controller, 120, 0))

      expect(rendered).toContain('· 6.7s · total 4m 28s')
    } finally {
      vi.useRealTimers()
    }
  })

  it('omits context occupancy when no matching request snapshot exists', () => {
    const now = new Date().toISOString()
    const controller = new TuiController(
      {} as KunTuiClient,
      { ...options, continueLatest: false },
      runtime
    )
    const current = detail()
    current.status = 'running'
    current.turns = [{
      id: 'turn_loading',
      threadId: current.id,
      status: 'running',
      orchestration: 'direct',
      prompt: 'Stream a response',
      steering: [],
      createdAt: now,
      startedAt: now,
      items: [],
      attachmentIds: [],
      activeSkillIds: [],
      injectedMemoryIds: [],
      injectedMemorySummaries: [],
      injectedInstructionSources: []
    }]
    const projection = projectThreadSnapshot(current)
    projection.usage = { ...emptyUsageSnapshot(), totalTokens: 750_000 }
    projection.contextSnapshot = {
      kind: 'context_snapshot',
      seq: 2,
      timestamp: now,
      threadId: current.id,
      turnId: 'turn_loading',
      model: 'different-model',
      stepIndex: 0,
      contextWindowTokens: 500_000,
      softThresholdTokens: 375_000,
      hardThresholdTokens: 425_000,
      estimatedInputTokens: 400_000,
      breakdown: {
        tools: 0,
        system: 0,
        skills: 0,
        messages: 400_000,
        other: 0
      },
      toolCount: 0,
      activeSkillIds: []
    }
    projection.activity = {
      turnId: 'turn_loading',
      phase: 'responding',
      label: 'Responding',
      startedAt: now,
      turnStartedAt: now,
      updatedAt: now
    }

    const rendered = sanitizeTerminalText(renderActivityRow({
      ...controller.state,
      connection: 'connected',
      projection
    }, controller, 140, 0))

    expect(rendered).not.toContain('750k')
    expect(rendered).not.toContain('400k / 500k')
  })

  it('renders tool input and output as a compact semantic tree', () => {
    const current = detail()
    current.turns = [{
      id: 'turn_tools',
      threadId: current.id,
      status: 'completed',
      orchestration: 'direct',
      prompt: 'Inspect the file',
      steering: [],
      createdAt: current.createdAt,
      startedAt: current.createdAt,
      finishedAt: '2026-07-22T00:00:02.000Z',
      items: [
        {
          id: 'user_tools',
          threadId: current.id,
          turnId: 'turn_tools',
          role: 'user',
          status: 'completed',
          createdAt: current.createdAt,
          kind: 'user_message',
          text: 'Inspect the file'
        },
        {
          id: 'call_tools',
          threadId: current.id,
          turnId: 'turn_tools',
          role: 'assistant',
          status: 'completed',
          createdAt: current.createdAt,
          finishedAt: '2026-07-22T00:00:01.000Z',
          kind: 'tool_call',
          toolName: 'read_file',
          callId: 'call_tools',
          toolKind: 'tool_call',
          arguments: { path: '/tmp/project/README.md' }
        },
        {
          id: 'result_tools',
          threadId: current.id,
          turnId: 'turn_tools',
          role: 'tool',
          status: 'completed',
          createdAt: '2026-07-22T00:00:01.000Z',
          finishedAt: '2026-07-22T00:00:02.000Z',
          kind: 'tool_result',
          toolName: 'read_file',
          callId: 'call_tools',
          toolKind: 'tool_call',
          output: 'README contents',
          isError: false
        }
      ],
      attachmentIds: [],
      activeSkillIds: [],
      injectedMemoryIds: [],
      injectedMemorySummaries: [],
      injectedInstructionSources: []
    }]
    const transcript = new TranscriptComponent()
    const projection = projectThreadSnapshot(current)

    transcript.update(projection, false, false)
    const compact = transcript.render(80)
    const compactPlain = sanitizeTerminalText(compact.join('\n'))
    expect(compactPlain).toContain('● Read')
    expect(compactPlain).toContain('└')
    expect(compactPlain).toContain('README contents')
    expect(compact.every((line) => visibleWidth(line) <= 80)).toBe(true)

    transcript.update(projection, false, true)
    const expanded = transcript.render(80)
    const expandedPlain = sanitizeTerminalText(expanded.join('\n'))
    expect(expandedPlain).toContain('├ input')
    expect(expandedPlain).toContain('└ output')
    expect(expandedPlain).toContain('/tmp/project/README.md')
    expect(expanded.every((line) => visibleWidth(line) <= 80)).toBe(true)
  })
})
