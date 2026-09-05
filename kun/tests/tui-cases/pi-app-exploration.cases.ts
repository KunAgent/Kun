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

describe("PiTuiApplication exploration rendering", () => {
  it('merges exploration Thinking in source order and stops at execution boundaries', () => {
    const current = detail()
    const turnId = 'turn_exploration'
    const startedAt = '2026-07-22T00:00:00.000Z'
    const search = testToolCall({
      id: 'call_search',
      turnId,
      toolName: 'grep',
      createdAt: '2026-07-22T00:00:01.000Z',
      finishedAt: '2026-07-22T00:00:02.000Z',
      arguments: { pattern: 'modelCapabilities', path: 'loop.test.ts' }
    })
    const read = testToolCall({
      id: 'call_read',
      turnId,
      toolName: 'read',
      createdAt: '2026-07-22T00:00:03.000Z',
      finishedAt: '2026-07-22T00:00:04.000Z',
      arguments: { path: 'loop.test.ts' }
    })
    const edit = testToolCall({
      id: 'call_edit',
      turnId,
      toolName: 'edit',
      toolKind: 'file_change',
      createdAt: '2026-07-22T00:00:05.000Z',
      finishedAt: '2026-07-22T00:00:06.000Z',
      arguments: { path: 'src/app.ts' }
    })
    const run = testToolCall({
      id: 'call_run',
      turnId,
      toolName: 'bash',
      toolKind: 'command_execution',
      createdAt: '2026-07-22T00:00:07.000Z',
      finishedAt: '2026-07-22T00:00:08.000Z',
      arguments: { command: 'rg modelCapabilities' }
    })
    const singleRead = testToolCall({
      id: 'call_single_read',
      turnId,
      toolName: 'read_file',
      createdAt: '2026-07-22T00:00:09.000Z',
      finishedAt: '2026-07-22T00:00:10.000Z',
      arguments: { path: 'README.md' }
    })
    current.turns = [{
      id: turnId,
      threadId: current.id,
      status: 'completed',
      orchestration: 'direct',
      prompt: 'Explore and update',
      steering: [],
      createdAt: startedAt,
      startedAt,
      finishedAt: '2026-07-22T00:00:11.000Z',
      items: [
        {
          id: 'user_exploration',
          threadId: current.id,
          turnId,
          role: 'user',
          status: 'completed',
          createdAt: startedAt,
          kind: 'user_message',
          text: 'Explore and update'
        },
        {
          id: 'reasoning_before_search',
          threadId: current.id,
          turnId,
          role: 'assistant',
          status: 'completed',
          createdAt: '2026-07-22T00:00:01.000Z',
          kind: 'assistant_reasoning',
          text: 'Find the relevant tests.'
        },
        search,
        testToolResult({
          id: search.id,
          turnId,
          toolName: search.toolName,
          createdAt: '2026-07-22T00:00:02.000Z',
          finishedAt: '2026-07-22T00:00:02.000Z',
          output: 'loop.test.ts:319'
        }),
        {
          id: 'reasoning_between_tools',
          threadId: current.id,
          turnId,
          role: 'assistant',
          status: 'completed',
          createdAt: '2026-07-22T00:00:03.000Z',
          kind: 'assistant_reasoning',
          text: 'Read the matching test.'
        },
        read,
        testToolResult({
          id: read.id,
          turnId,
          toolName: read.toolName,
          createdAt: '2026-07-22T00:00:04.000Z',
          finishedAt: '2026-07-22T00:00:04.000Z',
          output: 'supportsToolCalling: true'
        }),
        edit,
        testToolResult({
          id: edit.id,
          turnId,
          toolName: edit.toolName,
          toolKind: edit.toolKind,
          createdAt: '2026-07-22T00:00:06.000Z',
          output: 'updated src/app.ts'
        }),
        run,
        testToolResult({
          id: run.id,
          turnId,
          toolName: run.toolName,
          toolKind: run.toolKind,
          createdAt: '2026-07-22T00:00:08.000Z',
          output: 'src/app.ts:1'
        }),
        {
          id: 'reasoning_after_execution',
          threadId: current.id,
          turnId,
          role: 'assistant',
          status: 'completed',
          createdAt: '2026-07-22T00:00:08.500Z',
          kind: 'assistant_reasoning',
          text: 'Check the final README separately.'
        },
        singleRead,
        testToolResult({
          id: singleRead.id,
          turnId,
          toolName: singleRead.toolName,
          createdAt: '2026-07-22T00:00:10.000Z',
          output: 'Kun'
        }),
        {
          id: 'answer_exploration',
          threadId: current.id,
          turnId,
          role: 'assistant',
          status: 'completed',
          createdAt: '2026-07-22T00:00:11.000Z',
          kind: 'assistant_text',
          text: 'Done.'
        }
      ],
      attachmentIds: [],
      activeSkillIds: [],
      injectedMemoryIds: [],
      injectedMemorySummaries: [],
      injectedInstructionSources: []
    }]

    const transcript = new TranscriptComponent()
    transcript.update(projectThreadSnapshot(current), false, false)
    const rendered = sanitizeTerminalText(transcript.render(96).join('\n'))

    expect(rendered.match(/Explored/g)).toHaveLength(1)
    expect(rendered).toContain('Explored · 2 actions · 3.0s')
    expect(rendered).toContain('Search modelCapabilities')
    expect(rendered).toContain('Read loop.test.ts')
    expect(rendered.match(/Thinking/g)).toHaveLength(1)
    expect(rendered.indexOf('Explored')).toBeLessThan(rendered.indexOf('Edit'))
    expect(rendered).toContain('Run · rg modelCapabilities')
    expect(rendered.indexOf('Run · rg modelCapabilities')).toBeLessThan(rendered.indexOf('Thinking'))
    expect(rendered.indexOf('Thinking')).toBeLessThan(rendered.indexOf('Read · README.md'))
    expect(rendered).toContain('Read · README.md')

    transcript.update(projectThreadSnapshot(current), true, false)
    const expanded = sanitizeTerminalText(transcript.render(96).join('\n'))
    expect(expanded.indexOf('Find the relevant tests.'))
      .toBeLessThan(expanded.indexOf('Search modelCapabilities'))
    expect(expanded.indexOf('Search modelCapabilities'))
      .toBeLessThan(expanded.indexOf('Read the matching test.'))
    expect(expanded.indexOf('Read the matching test.'))
      .toBeLessThan(expanded.indexOf('Read loop.test.ts'))
    expect(expanded.indexOf('Read loop.test.ts')).toBeLessThan(expanded.indexOf('Edit'))
    expect(expanded.indexOf('Run · rg modelCapabilities'))
      .toBeLessThan(expanded.indexOf('Check the final README separately.'))
    expect(expanded.indexOf('Check the final README separately.'))
      .toBeLessThan(expanded.indexOf('Read · README.md'))
  })

  it('shows live, failed, capped, expanded, and narrow exploration group states', () => {
    const current = detail()
    const turnId = 'turn_live_exploration'
    const startedAt = new Date().toISOString()
    const items: TurnItem[] = [{
      id: 'user_live_exploration',
      threadId: current.id,
      turnId,
      role: 'user',
      status: 'completed',
      createdAt: startedAt,
      kind: 'user_message',
      text: 'Inspect many files'
    }]
    for (let index = 0; index < 14; index += 1) {
      const createdAt = new Date(Date.parse(startedAt) + (index + 1) * 1_000).toISOString()
      const call = testToolCall({
        id: `call_search_${index}`,
        turnId,
        toolName: index % 2 === 0 ? 'grep' : 'read_file',
        createdAt,
        status: index === 13 ? 'running' : 'completed',
        ...(index === 13 ? {} : { finishedAt: createdAt }),
        arguments: index % 2 === 0
          ? { pattern: `needle-${index}`, path: `src/file-${index}.ts` }
          : { path: `src/file-${index}.ts` }
      })
      items.push(call)
      if (index !== 13) {
        items.push(testToolResult({
          id: call.id,
          turnId,
          toolName: call.toolName,
          createdAt,
          finishedAt: createdAt,
          output: `result-${index}`,
          isError: index === 2
        }))
      }
    }
    current.status = 'running'
    current.turns = [{
      id: turnId,
      threadId: current.id,
      status: 'running',
      orchestration: 'direct',
      prompt: 'Inspect many files',
      steering: [],
      createdAt: startedAt,
      startedAt,
      items,
      attachmentIds: [],
      activeSkillIds: [],
      injectedMemoryIds: [],
      injectedMemorySummaries: [],
      injectedInstructionSources: []
    }]

    const transcript = new TranscriptComponent()
    const projection = projectThreadSnapshot(current)
    transcript.update(projection, false, false)
    const compactLines = transcript.render(52, 1)
    const compact = sanitizeTerminalText(compactLines.join('\n'))

    expect(compact).toContain('Exploring · 14 actions · 1 failed')
    expect(compact).toContain('… +2 more')
    expect(compact).not.toContain('input ·')
    expect(compactLines.every((line) => visibleWidth(line) <= 52)).toBe(true)

    transcript.update(projection, false, true)
    const expandedLines = transcript.render(52, 2)
    const expanded = sanitizeTerminalText(expandedLines.join('\n'))
    expect(expanded).not.toContain('+2 more')
    expect(expanded).toContain('src/file-13.ts')
    expect(expanded).toContain('input ·')
    expect(expanded).toContain('output ·')
    expect(expandedLines.every((line) => visibleWidth(line) <= 52)).toBe(true)
  })
})
