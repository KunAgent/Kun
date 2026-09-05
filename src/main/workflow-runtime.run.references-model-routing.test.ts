import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultClawSettings,
  defaultDesignSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  defaultTerminalSettings,
  mergeWorkflowSettings,
  normalizeWorkflow,
  normalizeWorkflowSettings,
  type AppSettingsPatch,
  type AppSettingsV1,
  type WorkflowCustomModuleV1,
  type WorkflowNodeKind,
  type WorkflowRunResult,
  type WorkflowV1
} from '../shared/app-settings'
import { createWorkflowRuntime } from './workflow-runtime'

let workflowWorkspaceRoot = ''

// Loose fixture builders — normalizeWorkflow fills name/position/disabled and
// per-kind config defaults at runtime, so tests pass partial nodes. The single
// cast in buildWorkflow keeps every call site type-clean without `as any`.
type NodeSpec = {
  id: string
  type: WorkflowNodeKind
  name?: string
  disabled?: boolean
  onError?: 'fail' | 'continue' | 'fallback'
  retries?: number
  retryDelayMs?: number
  fallbackJson?: string
  inputs?: { key: string; type: 'text' | 'number' | 'boolean' | 'json'; source: string }[]
  config?: Record<string, unknown>
}
type ConnSpec = { id: string; source: string; sourceHandle?: string; target: string; targetHandle?: string }
type WorkflowSpec = Omit<Partial<WorkflowV1>, 'nodes' | 'connections'> & {
  nodes?: NodeSpec[]
  connections?: ConnSpec[]
}

function settingsWithWorkflows(workflows: WorkflowV1[], modules: WorkflowCustomModuleV1[] = []): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
    composerSendKey: 'enter',
    provider: defaultModelProviderSettings(),
    agents: { kun: { ...defaultKunRuntimeSettings(), model: 'test-model', apiKey: 'test-key' } },
    workspaceRoot: workflowWorkspaceRoot,
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: { enabled: true, retentionDays: 7 },
    checkpointCleanup: { createEnabled: false, enabled: false, intervalDays: 3 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    workflow: normalizeWorkflowSettings({ enabled: true, workflows, modules }),
    design: defaultDesignSettings(),
    terminal: defaultTerminalSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: '',
    chatWelcomeMessage: '',
    codeAgentPresets: [],
    disabledSkillIds: []
  }
}

function createStore(initial: AppSettingsV1) {
  let current = initial
  return {
    load: async () => current,
    patch: async (partial: AppSettingsPatch) => {
      current = { ...current, workflow: mergeWorkflowSettings(current.workflow, partial.workflow) }
      return current
    },
    update: async (
      mutation: (settings: AppSettingsV1) => AppSettingsV1 | Promise<AppSettingsV1>
    ) => {
      current = await mutation(current)
      return current
    },
    replace: (next: AppSettingsV1) => { current = next },
    read: () => current
  }
}

function buildWorkflow(partial: WorkflowSpec): WorkflowV1 {
  return normalizeWorkflow(partial as unknown as Partial<WorkflowV1>, 0, '2026-06-18T00:00:00.000Z')
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  throw new Error('Timed out waiting for workflow run to finish')
}

function requireOk(result: WorkflowRunResult): string {
  if (!result.ok) throw new Error(`runWorkflow failed: ${result.message}`)
  return result.runId
}

describe('WorkflowRuntime end-to-end execution', () => {
  beforeEach(() => {
    workflowWorkspaceRoot = mkdtempSync(join(tmpdir(), 'kun-workflow-run-'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (workflowWorkspaceRoot) {
      rmSync(workflowWorkspaceRoot, { recursive: true, force: true })
      workflowWorkspaceRoot = ''
    }
  })

  it('runWorkflowByRef runs by name and returns the output node result', async () => {
    const store = createStore(
      settingsWithWorkflows([
        buildWorkflow({
          id: 'wf-out',
          name: 'Greeter',
          enabled: true,
          nodes: [
            { id: 'm', type: 'manual-trigger', config: {} },
            { id: 's', type: 'set-fields', config: { fields: [{ key: 'greeting', value: 'hi' }], keepIncoming: false } },
            { id: 'o', type: 'output', config: { mode: 'auto', textTemplate: '', jsonPath: '' } }
          ],
          connections: [
            { id: 'e1', source: 'm', sourceHandle: 'out', target: 's', targetHandle: 'in' },
            { id: 'e2', source: 's', sourceHandle: 'out', target: 'o', targetHandle: 'in' }
          ]
        })
      ])
    )
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: vi.fn() as never, logError: vi.fn() })
    const result = await runtime.runWorkflowByRef('Greeter')
    expect(result.ok).toBe(true)
    expect((JSON.parse(result.output) as { greeting: string }).greeting).toBe('hi')
    runtime.stop()
  }, 15_000)

  it('coerces typed manual-trigger inputs onto the run payload', async () => {
    const store = createStore(
      settingsWithWorkflows([
        buildWorkflow({
          id: 'wf-in',
          name: 'Inputs',
          enabled: true,
          nodes: [
            {
              id: 'm',
              type: 'manual-trigger',
              config: {
                inputSchema: [
                  { key: 'n', label: 'N', type: 'number', required: false, options: [], defaultValue: '', description: '' }
                ]
              }
            },
            { id: 'o', type: 'output', config: { mode: 'auto', textTemplate: '', jsonPath: '' } }
          ],
          connections: [{ id: 'e1', source: 'm', sourceHandle: 'out', target: 'o', targetHandle: 'in' }]
        })
      ])
    )
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: vi.fn() as never, logError: vi.fn() })
    const result = await runtime.runWorkflowByRef('Inputs', { n: '5' })
    expect(result.ok).toBe(true)
    expect((JSON.parse(result.output) as { n: number }).n).toBe(5)
    runtime.stop()
  }, 15_000)

  it('resolves {{$nodes.<id>.json.path}} cross-node references', async () => {
    const store = createStore(
      settingsWithWorkflows([
        buildWorkflow({
          id: 'wf-ref',
          name: 'Ref',
          enabled: true,
          nodes: [
            { id: 'm', type: 'manual-trigger', config: {} },
            { id: 's', type: 'set-fields', config: { fields: [{ key: 'a', value: 'hi' }], keepIncoming: false } },
            { id: 't', type: 'template', config: { template: 'got {{$nodes.s.json.a}}', outputMode: 'text' } }
          ],
          connections: [
            { id: 'e1', source: 'm', sourceHandle: 'out', target: 's', targetHandle: 'in' },
            { id: 'e2', source: 's', sourceHandle: 'out', target: 't', targetHandle: 'in' }
          ]
        })
      ])
    )
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: vi.fn() as never, logError: vi.fn() })
    const runId = requireOk(await runtime.runWorkflow('wf-ref'))
    await waitFor(async () => {
      const run = (await store.load()).workflow.workflows[0].runs.find((entry) => entry.id === runId)
      return Boolean(run && run.status !== 'running')
    }, 10_000)
    const run = store.read().workflow.workflows[0].runs.find((entry) => entry.id === runId)!
    expect(run.status).toBe('success')
    const tpl = run.nodeResults.find((result) => result.nodeId === 't')!
    expect((JSON.parse(tpl.outputJson) as { text: string }).text).toBe('got hi')
    runtime.stop()
  }, 15_000)

  it('ai-agent node forwards the picked providerId on POST /v1/threads', async () => {
    // The workflow node UI lets the user pick a non-runtime provider per
    // request. The runtime helper must put that providerId on the body so
    // Kun's MultiProviderModelClient routes the turn to the matching
    // per-provider HTTP client. Without this the runtime would silently
    // fall back to its bound provider — the bug behind the original
    // "Not supported model MiniMax-M3" report.
    const captured: { body: Record<string, unknown> | null } = { body: null }
    const runtimeRequest = vi.fn(async (
      _settings: AppSettingsV1,
      pathAndQuery: string,
      init: { body?: string }
    ) => {
      if (pathAndQuery === '/v1/threads') {
        captured.body = JSON.parse(init.body ?? '{}') as Record<string, unknown>
        return { ok: true, status: 200, body: JSON.stringify({ id: 'thread-1' }) }
      }
      if (pathAndQuery.includes('/turns')) {
        return { ok: true, status: 200, body: JSON.stringify({ turn: { id: 'turn-1' } }) }
      }
      if (pathAndQuery.startsWith('/v1/threads/')) {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            turns: [
              {
                id: 'turn-1',
                status: 'completed',
                items: [{ kind: 'assistant_text', text: 'ok', turnId: 'turn-1' }]
              }
            ]
          })
        }
      }
      return { ok: false, status: 404, body: '{}' }
    })

    const baseSettings = settingsWithWorkflows([
      buildWorkflow({
        id: 'wf-mm',
        name: 'MiniMaxThread',
        enabled: true,
        nodes: [
          { id: 'm', type: 'manual-trigger', config: {} },
          {
            id: 'a',
            type: 'ai-agent',
            config: { prompt: 'say hi', model: 'MiniMax-M3', providerId: 'minimax-token-plan' }
          }
        ],
        connections: [{ id: 'e1', source: 'm', sourceHandle: 'out', target: 'a', targetHandle: 'in' }]
      })
    ])
    const settings: AppSettingsV1 = {
      ...baseSettings,
      provider: {
        ...baseSettings.provider,
        providers: [
          ...baseSettings.provider.providers,
          {
            id: 'minimax-token-plan',
            name: 'MiniMax Token Plan',
            apiKey: 'sk-mm',
            baseUrl: 'https://api.minimaxi.com/anthropic',
            endpointFormat: 'messages',
            useProxy: false,
            models: ['MiniMax-M3'],
            modelProfiles: {}
          }
        ]
      }
    }
    const store = createStore(settings)
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: runtimeRequest as never, logError: vi.fn() })

    const runId = requireOk(await runtime.runWorkflow('wf-mm'))
    await waitFor(async () => {
      const run = (await store.load()).workflow.workflows[0].runs.find((entry) => entry.id === runId)
      return Boolean(run && run.status !== 'running')
    }, 10_000)

    expect(captured.body).not.toBeNull()
    expect(captured.body?.providerId).toBe('minimax-token-plan')
    expect(captured.body?.model).toBe('MiniMax-M3')

    runtime.stop()
  }, 15_000)
})
