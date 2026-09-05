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

describe("PiTuiApplication Thinking and markdown rendering", () => {
  it('renders Thinking collapsed by default and expands its muted content on request', () => {
    const item: Extract<TurnItem, { kind: 'assistant_reasoning' }> = {
      id: 'reason_visible',
      threadId: 'thr_pi',
      turnId: 'turn_reasoning',
      role: 'assistant',
      status: 'completed',
      createdAt: '2026-07-22T00:00:00.000Z',
      finishedAt: '2026-07-22T00:00:01.200Z',
      kind: 'assistant_reasoning',
      text: 'Inspect the provider capability before sending the request.'
    }
    const collapsed = renderKunThinking(item, 60, { expanded: false, running: false })
    expect(collapsed.join('\n')).toContain('Thinking')
    expect(collapsed.join('\n')).toContain('collapsed')
    expect(collapsed.join('\n')).toContain('/thinking expand')
    expect(collapsed.join('\n')).not.toContain('Inspect the provider capability')
    expect(collapsed.every((line) => visibleWidth(line) <= 60)).toBe(true)

    const expanded = renderKunThinking(item, 60, { expanded: true, running: false })
    expect(expanded.join('\n')).toContain('Thinking')
    expect(expanded.join('\n')).toContain('Inspect the provider capability')
    expect(expanded.join('\n')).toContain('│')
    expect(expanded.every((line) => visibleWidth(line) <= 60)).toBe(true)
  })

  it('keeps streamed Thinking and the late reply body inside one Kun turn group', () => {
    const current = detail()
    current.status = 'running'
    current.turns = [{
      id: 'turn_grouped',
      threadId: current.id,
      status: 'running',
      orchestration: 'direct',
      prompt: 'Say hello',
      steering: [],
      createdAt: current.createdAt,
      startedAt: current.createdAt,
      items: [
        {
          id: 'user_grouped',
          threadId: current.id,
          turnId: 'turn_grouped',
          role: 'user',
          status: 'completed',
          createdAt: current.createdAt,
          kind: 'user_message',
          text: 'Say hello'
        },
        {
          id: 'reason_grouped',
          threadId: current.id,
          turnId: 'turn_grouped',
          role: 'assistant',
          status: 'running',
          createdAt: current.createdAt,
          kind: 'assistant_reasoning',
          text: 'Prepare a concise greeting.'
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

    const reasoningOnly = transcript.render(80).join('\n')
    expect(reasoningOnly.indexOf('You')).toBeLessThan(reasoningOnly.indexOf('Kun'))
    expect(reasoningOnly.indexOf('Kun')).toBeLessThan(reasoningOnly.indexOf('Thinking'))
    expect(reasoningOnly.match(/Kun/g)).toHaveLength(1)

    current.turns[0]!.items.push({
      id: 'answer_grouped',
      threadId: current.id,
      turnId: 'turn_grouped',
      role: 'assistant',
      status: 'running',
      createdAt: current.createdAt,
      kind: 'assistant_text',
      text: 'Hello.'
    })
    transcript.update(projectThreadSnapshot(current), false, false)

    const withReply = transcript.render(80).join('\n')
    expect(withReply.indexOf('Kun')).toBeLessThan(withReply.indexOf('Thinking'))
    expect(withReply.indexOf('Thinking')).toBeLessThan(withReply.indexOf('Hello.'))
    expect(withReply.match(/Kun/g)).toHaveLength(1)
  })

  it('renders completed fenced code as labeled terminal blocks without source delimiters', () => {
    const rendered = renderAssistantMessage([
      'Tagged:',
      '```ts',
      'const answer = "<ok>"',
      '```',
      '',
      'Bare:',
      '```',
      '  keep indentation',
      '```',
      '',
      'Fallback:',
      '```made-up-language',
      'alpha < beta',
      '```'
    ].join('\n'), 54)
    const plain = sanitizeTerminalText(rendered.join('\n'))

    expect(plain).toContain('╭─ typescript')
    expect(plain).toContain('╭─ code')
    expect(plain).toContain('╭─ made-up-language')
    expect(plain).toContain('│ const answer = "<ok>"')
    expect(plain).toContain('│   keep indentation')
    expect(plain).toContain('│ alpha < beta')
    expect(plain).toContain('╰─')
    expect(plain).not.toMatch(/```|~~~/u)
    expect(rendered.every((line) => visibleWidth(line) <= 54)).toBe(true)
  })

  it('keeps an unterminated streamed code block styled and bounded at narrow widths', () => {
    const rendered = renderAssistantMessage([
      '```typescript',
      '  const message = "a deliberately long streamed code line that must wrap safely";'
    ].join('\n'), 32, true)
    const plain = sanitizeTerminalText(rendered.join('\n'))

    expect(plain).toContain('╭─ typescript')
    expect(plain).toContain('│   const message')
    expect(plain).toContain('▍')
    expect(plain).not.toContain('```')
    expect(rendered.every((line) => visibleWidth(line) <= 32)).toBe(true)
  })

  it('maps only a Thinking title row and toggles that reasoning item independently', () => {
    const current = detail()
    current.turns = [{
      id: 'turn_click',
      threadId: current.id,
      status: 'completed',
      orchestration: 'direct',
      prompt: 'Explain',
      steering: [],
      createdAt: current.createdAt,
      startedAt: current.createdAt,
      finishedAt: '2026-07-22T00:00:02.000Z',
      items: [
        {
          id: 'user_click',
          threadId: current.id,
          turnId: 'turn_click',
          role: 'user',
          status: 'completed',
          createdAt: current.createdAt,
          kind: 'user_message',
          text: 'Explain'
        },
        {
          id: 'reason_click',
          threadId: current.id,
          turnId: 'turn_click',
          role: 'assistant',
          status: 'completed',
          createdAt: current.createdAt,
          finishedAt: '2026-07-22T00:00:01.000Z',
          kind: 'assistant_reasoning',
          text: 'Inspect exactly one disclosure.'
        },
        {
          id: 'answer_click',
          threadId: current.id,
          turnId: 'turn_click',
          role: 'assistant',
          status: 'completed',
          createdAt: '2026-07-22T00:00:01.000Z',
          finishedAt: '2026-07-22T00:00:02.000Z',
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
    const collapsed = transcript.render(90)
    const titleRow = collapsed.findIndex((line) => line.includes('Thinking'))

    expect(titleRow).toBeGreaterThanOrEqual(0)
    expect(transcript.reasoningAtRenderedRow(titleRow)).toBe('reason_click')
    expect(transcript.reasoningAtRenderedRow(titleRow + 1)).toBeUndefined()
    expect(transcript.toggleReasoningAtRenderedRow(titleRow)).toBe('reason_click')
    expect(transcript.render(90).join('\n')).toContain('Inspect exactly one disclosure.')

    expect(transcript.toggleReasoningAtRenderedRow(titleRow + 1)).toBeUndefined()
    expect(transcript.toggleReasoningAtRenderedRow(titleRow)).toBe('reason_click')
    expect(transcript.render(90).join('\n')).not.toContain('Inspect exactly one disclosure.')
  })

  it('renders persisted image attachments beneath their user message', () => {
    const current = detail()
    current.turns = [{
      id: 'turn_image',
      threadId: current.id,
      status: 'completed',
      orchestration: 'direct',
      prompt: 'What is this?',
      steering: [],
      createdAt: current.createdAt,
      startedAt: current.createdAt,
      finishedAt: current.createdAt,
      items: [{
        id: 'user_image',
        threadId: current.id,
        turnId: 'turn_image',
        role: 'user',
        status: 'completed',
        createdAt: current.createdAt,
        finishedAt: current.createdAt,
        kind: 'user_message',
        text: 'What is this?'
      }],
      attachmentIds: ['att_image'],
      activeSkillIds: [],
      injectedMemoryIds: [],
      injectedMemorySummaries: [],
      injectedInstructionSources: []
    }]
    const transcript = new TranscriptComponent()
    transcript.update(projectThreadSnapshot(current), false, false, false, {
      att_image: {
        id: 'att_image',
        name: 'clipboard.png',
        kind: 'image',
        mimeType: 'image/png',
        byteSize: 2048,
        hash: 'image-hash',
        width: 640,
        height: 480,
        threadIds: [current.id],
        workspaces: [current.workspace],
        createdAt: current.createdAt,
        updatedAt: current.createdAt
      }
    })

    const rendered = sanitizeTerminalText(transcript.render(90).join('\n'))
    expect(rendered).toContain('You  What is this?')
    expect(rendered).toContain('Image  clipboard.png · image/png · 2.0 KiB · 640×480')

    transcript.update(projectThreadSnapshot(current), false, false)
    expect(sanitizeTerminalText(transcript.render(90).join('\n'))).toContain('Attachment · attached')
  })

  it('advances Thinking only during the reasoning phase and freezes it when the reply starts', () => {
    vi.useFakeTimers()
    try {
      const startedAt = '2026-07-22T00:00:00.000Z'
      vi.setSystemTime(new Date('2026-07-22T00:00:03.000Z'))
      const current = detail()
      current.status = 'running'
      current.createdAt = startedAt
      current.updatedAt = startedAt
      current.turns = [{
        id: 'turn_timed',
        threadId: current.id,
        status: 'running',
        orchestration: 'direct',
        prompt: 'Think briefly',
        steering: [],
        createdAt: startedAt,
        startedAt,
        items: [{
          id: 'reason_timed',
          threadId: current.id,
          turnId: 'turn_timed',
          role: 'assistant',
          status: 'running',
          createdAt: startedAt,
          kind: 'assistant_reasoning',
          text: 'Working it out.'
        }],
        attachmentIds: [],
        activeSkillIds: [],
        injectedMemoryIds: [],
        injectedMemorySummaries: [],
        injectedInstructionSources: []
      }]
      const transcript = new TranscriptComponent()
      transcript.update(projectThreadSnapshot(current), false, false)

      expect(transcript.render(80).join('\n')).toContain('3.0s')
      vi.advanceTimersByTime(2_000)
      expect(transcript.render(80).join('\n')).toContain('5.0s')

      current.turns[0]!.items.push({
        id: 'answer_timed',
        threadId: current.id,
        turnId: 'turn_timed',
        role: 'assistant',
        status: 'running',
        createdAt: new Date().toISOString(),
        kind: 'assistant_text',
        text: 'Done.'
      })
      transcript.update(projectThreadSnapshot(current), false, false)
      const frozen = transcript.render(80).join('\n')
      expect(frozen).toContain('5.0s')

      current.status = 'idle'
      current.turns[0]!.status = 'completed'
      current.turns[0]!.finishedAt = '2026-07-22T00:00:06.000Z'
      current.turns[0]!.items[0]!.status = 'completed'
      current.turns[0]!.items[1]!.status = 'completed'
      transcript.update(projectThreadSnapshot(current), false, false)
      expect(transcript.render(80).join('\n')).toContain('5.0s')

      vi.advanceTimersByTime(10 * 60_000)
      expect(transcript.render(80).join('\n')).toContain('5.0s')
      expect(transcript.render(80).join('\n')).not.toContain('10m')
    } finally {
      vi.useRealTimers()
    }
  })
})
