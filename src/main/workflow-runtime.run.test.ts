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
  defaultTerminalSettings, defaultRemoteAccessSettings,
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
    remote: defaultRemoteAccessSettings(),
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

  it('preserves the latest webhook endpoint while reconciling a stale workflow snapshot', async () => {
    const workflow = buildWorkflow({
      id: 'wf-scheduled',
      name: 'Scheduled',
      enabled: true,
      nextRunAt: '',
      nodes: [{
        id: 'schedule',
        type: 'schedule-trigger',
        config: { schedule: { kind: 'interval', everyMinutes: 10 } }
      }],
      connections: []
    })
    const initial = settingsWithWorkflows([workflow])
    const store = createStore(initial)
    const runtime = createWorkflowRuntime({
      store: store as never,
      runtimeRequest: vi.fn() as never,
      logError: vi.fn()
    })
    store.replace({
      ...initial,
      workflow: {
        ...initial.workflow,
        webhookPort: 28799,
        webhookSecret: 'latest-secret'
      }
    })

    await (runtime as unknown as {
      ensureNextRuns: (settings: AppSettingsV1) => Promise<void>
    }).ensureNextRuns(initial)

    expect(store.read().workflow.webhookPort).toBe(28799)
    expect(store.read().workflow.webhookSecret).toBe('latest-secret')
    expect(store.read().workflow.workflows[0].nextRunAt).not.toBe('')
  })

  it('runs trigger → AI → condition(true) → delay and skips the false branch', async () => {
    const runtimeRequest = vi.fn(async (_settings: AppSettingsV1, pathAndQuery: string) => {
      if (pathAndQuery === '/v1/threads') {
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
                items: [{ kind: 'assistant_text', text: 'HELLO WORLD', turnId: 'turn-1' }]
              }
            ]
          })
        }
      }
      return { ok: false, status: 404, body: '{}' }
    })

    const workflow = buildWorkflow({
      id: 'wf-1',
      name: 'Demo',
      enabled: true,
      nodes: [
        { id: 'm', type: 'manual-trigger', config: {} },
        { id: 'a', type: 'ai-agent', config: { prompt: 'say hi', model: 'test-model' } },
        { id: 'c', type: 'condition', config: { leftExpr: '', operator: 'contains', rightValue: 'HELL' } },
        { id: 'd', type: 'delay', config: { delayMs: 10 } },
        { id: 'h', type: 'http-request', config: { method: 'GET', url: 'https://example.com' } }
      ],
      connections: [
        { id: 'e1', source: 'm', sourceHandle: 'out', target: 'a', targetHandle: 'in' },
        { id: 'e2', source: 'a', sourceHandle: 'out', target: 'c', targetHandle: 'in' },
        { id: 'e3', source: 'c', sourceHandle: 'true', target: 'd', targetHandle: 'in' },
        { id: 'e4', source: 'c', sourceHandle: 'false', target: 'h', targetHandle: 'in' }
      ]
    })

    const store = createStore(settingsWithWorkflows([workflow]))
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: runtimeRequest as never, logError: vi.fn() })

    const runId = requireOk(await runtime.runWorkflow('wf-1'))
    await waitFor(async () => {
      const run = (await store.load()).workflow.workflows[0].runs.find((entry) => entry.id === runId)
      return Boolean(run && run.status !== 'running')
    }, 15_000)

    const persisted = store.read().workflow.workflows[0]
    const run = persisted.runs.find((entry) => entry.id === runId)!
    const ranIds = run.nodeResults.map((result) => result.nodeId)

    expect(run.status).toBe('success')
    expect(persisted.lastStatus).toBe('success')
    expect(ranIds).toEqual(expect.arrayContaining(['m', 'a', 'c', 'd']))
    expect(ranIds).not.toContain('h') // false branch must be skipped

    const aiResult = run.nodeResults.find((result) => result.nodeId === 'a')!
    expect(aiResult.status).toBe('success')
    expect(aiResult.message).toContain('HELLO WORLD')
    expect(aiResult.threadId).toBe('thread-1')

    const conditionResult = run.nodeResults.find((result) => result.nodeId === 'c')!
    expect(conditionResult.message).toBe('true')

    runtime.stop()
  }, 20_000)

  it('executes an HTTP request node and captures the response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"value":42}', { status: 200, statusText: 'OK' }))
    )

    const workflow = buildWorkflow({
      id: 'wf-http',
      name: 'Http',
      enabled: true,
      nodes: [
        { id: 'm', type: 'manual-trigger', config: {} },
        {
          id: 'h',
          type: 'http-request',
          config: { method: 'GET', url: 'https://example.com/data', parseJson: true }
        }
      ],
      connections: [{ id: 'e1', source: 'm', sourceHandle: 'out', target: 'h', targetHandle: 'in' }]
    })

    const store = createStore(settingsWithWorkflows([workflow]))
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: vi.fn() as never, logError: vi.fn() })

    const runId = requireOk(await runtime.runWorkflow('wf-http'))
    await waitFor(async () => {
      const run = (await store.load()).workflow.workflows[0].runs.find((entry) => entry.id === runId)
      return Boolean(run && run.status !== 'running')
    }, 10_000)

    const run = store.read().workflow.workflows[0].runs.find((entry) => entry.id === runId)!
    const httpResult = run.nodeResults.find((result) => result.nodeId === 'h')!
    expect(run.status).toBe('success')
    expect(httpResult.status).toBe('success')
    expect(httpResult.message).toContain('200')
    expect(httpResult.outputJson).toContain('42')

    runtime.stop()
  }, 15_000)

  it('marks the run as error when a node fails and stops the chain', async () => {
    const runtimeRequest = vi.fn(async (_settings: AppSettingsV1, pathAndQuery: string) => {
      if (pathAndQuery === '/v1/threads') {
        return { ok: false, status: 500, body: JSON.stringify({ message: 'boom' }) }
      }
      return { ok: false, status: 404, body: '{}' }
    })

    const workflow = buildWorkflow({
      id: 'wf-err',
      name: 'Err',
      enabled: true,
      nodes: [
        { id: 'm', type: 'manual-trigger', config: {} },
        { id: 'a', type: 'ai-agent', config: { prompt: 'fail', model: 'test-model' } },
        { id: 'd', type: 'delay', config: { delayMs: 10 } }
      ],
      connections: [
        { id: 'e1', source: 'm', sourceHandle: 'out', target: 'a', targetHandle: 'in' },
        { id: 'e2', source: 'a', sourceHandle: 'out', target: 'd', targetHandle: 'in' }
      ]
    })

    const store = createStore(settingsWithWorkflows([workflow]))
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: runtimeRequest as never, logError: vi.fn() })

    const runId = requireOk(await runtime.runWorkflow('wf-err'))
    await waitFor(async () => {
      const run = (await store.load()).workflow.workflows[0].runs.find((entry) => entry.id === runId)
      return Boolean(run && run.status !== 'running')
    }, 10_000)

    const persisted = store.read().workflow.workflows[0]
    const run = persisted.runs.find((entry) => entry.id === runId)!
    expect(run.status).toBe('error')
    expect(persisted.lastStatus).toBe('error')
    const aiResult = run.nodeResults.find((result) => result.nodeId === 'a')!
    expect(aiResult.status).toBe('error')
    expect(aiResult.error).toContain('boom')
    // The downstream delay node must not have run.
    expect(run.nodeResults.find((result) => result.nodeId === 'd')).toBeUndefined()

    runtime.stop()
  }, 15_000)

  it('set-fields node shapes JSON and interpolates the upstream output', async () => {
    const runtimeRequest = vi.fn(async (_settings: AppSettingsV1, pathAndQuery: string) => {
      if (pathAndQuery === '/v1/threads') return { ok: true, status: 200, body: JSON.stringify({ id: 'thread-1' }) }
      if (pathAndQuery.includes('/turns')) return { ok: true, status: 200, body: JSON.stringify({ turn: { id: 'turn-1' } }) }
      if (pathAndQuery.startsWith('/v1/threads/')) {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            turns: [{ id: 'turn-1', status: 'completed', items: [{ kind: 'assistant_text', text: 'WORLD', turnId: 'turn-1' }] }]
          })
        }
      }
      return { ok: false, status: 404, body: '{}' }
    })

    const workflow = buildWorkflow({
      id: 'wf-set',
      name: 'Set',
      enabled: true,
      nodes: [
        { id: 'm', type: 'manual-trigger', config: {} },
        { id: 'a', type: 'ai-agent', config: { prompt: 'hi', model: 'test-model' } },
        {
          id: 's',
          type: 'set-fields',
          config: { fields: [{ key: 'greeting', value: 'hello {{text}}' }, { key: 'fixed', value: 'x' }], keepIncoming: false }
        }
      ],
      connections: [
        { id: 'e1', source: 'm', sourceHandle: 'out', target: 'a', targetHandle: 'in' },
        { id: 'e2', source: 'a', sourceHandle: 'out', target: 's', targetHandle: 'in' }
      ]
    })

    const store = createStore(settingsWithWorkflows([workflow]))
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: runtimeRequest as never, logError: vi.fn() })

    const runId = requireOk(await runtime.runWorkflow('wf-set'))
    await waitFor(async () => {
      const run = (await store.load()).workflow.workflows[0].runs.find((entry) => entry.id === runId)
      return Boolean(run && run.status !== 'running')
    }, 10_000)

    const run = store.read().workflow.workflows[0].runs.find((entry) => entry.id === runId)!
    expect(run.status).toBe('success')
    const setResult = run.nodeResults.find((result) => result.nodeId === 's')!
    const output = JSON.parse(setResult.outputJson) as Record<string, unknown>
    expect(output).toEqual({ greeting: 'hello WORLD', fixed: 'x' })

    runtime.stop()
  }, 15_000)

  it('switch routes to the matching case and prunes the others', async () => {
    const store = createStore(
      settingsWithWorkflows([
        buildWorkflow({
          id: 'wf-sw',
          name: 'Sw',
          enabled: true,
          nodes: [
            { id: 'm', type: 'manual-trigger', config: {} },
            { id: 's', type: 'set-fields', config: { fields: [{ key: 'v', value: 'B' }], keepIncoming: false } },
            {
              id: 'sw',
              type: 'switch',
              config: {
                rules: [
                  { leftExpr: 'json.v', operator: 'equals', rightValue: 'A', caseSensitive: false },
                  { leftExpr: 'json.v', operator: 'equals', rightValue: 'B', caseSensitive: false }
                ],
                fallback: false
              }
            },
            { id: 'out0', type: 'set-fields', config: { fields: [{ key: 'hit', value: '0' }], keepIncoming: false } },
            { id: 'out1', type: 'set-fields', config: { fields: [{ key: 'hit', value: '1' }], keepIncoming: false } }
          ],
          connections: [
            { id: 'e1', source: 'm', sourceHandle: 'out', target: 's', targetHandle: 'in' },
            { id: 'e2', source: 's', sourceHandle: 'out', target: 'sw', targetHandle: 'in' },
            { id: 'e3', source: 'sw', sourceHandle: 'case-0', target: 'out0', targetHandle: 'in' },
            { id: 'e4', source: 'sw', sourceHandle: 'case-1', target: 'out1', targetHandle: 'in' }
          ]
        })
      ])
    )
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: vi.fn() as never, logError: vi.fn() })
    const runId = requireOk(await runtime.runWorkflow('wf-sw'))
    await waitFor(async () => {
      const run = (await store.load()).workflow.workflows[0].runs.find((entry) => entry.id === runId)
      return Boolean(run && run.status !== 'running')
    }, 10_000)
    const run = store.read().workflow.workflows[0].runs.find((entry) => entry.id === runId)!
    const ids = run.nodeResults.map((result) => result.nodeId)
    expect(run.status).toBe('success')
    expect(ids).toEqual(expect.arrayContaining(['m', 's', 'sw', 'out1']))
    expect(ids).not.toContain('out0')
    runtime.stop()
  }, 15_000)

  it('merge waits for all branches and combines their outputs', async () => {
    const store = createStore(
      settingsWithWorkflows([
        buildWorkflow({
          id: 'wf-mg',
          name: 'Mg',
          enabled: true,
          nodes: [
            { id: 'm', type: 'manual-trigger', config: {} },
            { id: 'a', type: 'set-fields', config: { fields: [{ key: 'x', value: '1' }], keepIncoming: false } },
            { id: 'b', type: 'set-fields', config: { fields: [{ key: 'y', value: '2' }], keepIncoming: false } },
            { id: 'mg', type: 'merge', config: { mode: 'object' } }
          ],
          connections: [
            { id: 'e1', source: 'm', sourceHandle: 'out', target: 'a', targetHandle: 'in' },
            { id: 'e2', source: 'm', sourceHandle: 'out', target: 'b', targetHandle: 'in' },
            { id: 'e3', source: 'a', sourceHandle: 'out', target: 'mg', targetHandle: 'in' },
            { id: 'e4', source: 'b', sourceHandle: 'out', target: 'mg', targetHandle: 'in' }
          ]
        })
      ])
    )
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: vi.fn() as never, logError: vi.fn() })
    const runId = requireOk(await runtime.runWorkflow('wf-mg'))
    await waitFor(async () => {
      const run = (await store.load()).workflow.workflows[0].runs.find((entry) => entry.id === runId)
      return Boolean(run && run.status !== 'running')
    }, 10_000)
    const run = store.read().workflow.workflows[0].runs.find((entry) => entry.id === runId)!
    expect(run.status).toBe('success')
    const merge = run.nodeResults.find((result) => result.nodeId === 'mg')!
    expect(JSON.parse(merge.outputJson)).toEqual({ x: '1', y: '2' })
    runtime.stop()
  }, 15_000)

  it('code node evaluates JS against the upstream payload', async () => {
    const store = createStore(
      settingsWithWorkflows([
        buildWorkflow({
          id: 'wf-code',
          name: 'Code',
          enabled: true,
          nodes: [
            { id: 'm', type: 'manual-trigger', config: {} },
            { id: 's', type: 'set-fields', config: { fields: [{ key: 'n', value: '5' }], keepIncoming: false } },
            { id: 'c', type: 'code', config: { code: 'return { doubled: Number($json.n) * 2 }' } }
          ],
          connections: [
            { id: 'e1', source: 'm', sourceHandle: 'out', target: 's', targetHandle: 'in' },
            { id: 'e2', source: 's', sourceHandle: 'out', target: 'c', targetHandle: 'in' }
          ]
        })
      ])
    )
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: vi.fn() as never, logError: vi.fn() })
    const runId = requireOk(await runtime.runWorkflow('wf-code'))
    await waitFor(async () => {
      const run = (await store.load()).workflow.workflows[0].runs.find((entry) => entry.id === runId)
      return Boolean(run && run.status !== 'running')
    }, 10_000)
    const run = store.read().workflow.workflows[0].runs.find((entry) => entry.id === runId)!
    expect(run.status).toBe('success')
    const code = run.nodeResults.find((result) => result.nodeId === 'c')!
    expect(JSON.parse(code.outputJson)).toEqual({ doubled: 10 })
    runtime.stop()
  }, 15_000)

  it('code node times out on an infinite loop and errors the run', async () => {
    const store = createStore(
      settingsWithWorkflows([
        buildWorkflow({
          id: 'wf-loop',
          name: 'Loop',
          enabled: true,
          nodes: [
            { id: 'm', type: 'manual-trigger', config: {} },
            { id: 'c', type: 'code', config: { code: 'while (true) {}' } }
          ],
          connections: [{ id: 'e1', source: 'm', sourceHandle: 'out', target: 'c', targetHandle: 'in' }]
        })
      ])
    )
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: vi.fn() as never, logError: vi.fn() })
    const runId = requireOk(await runtime.runWorkflow('wf-loop'))
    await waitFor(async () => {
      const run = (await store.load()).workflow.workflows[0].runs.find((entry) => entry.id === runId)
      return Boolean(run && run.status !== 'running')
    }, 10_000)
    const run = store.read().workflow.workflows[0].runs.find((entry) => entry.id === runId)!
    expect(run.status).toBe('error')
    const code = run.nodeResults.find((result) => result.nodeId === 'c')!
    expect(code.status).toBe('error')
    expect(code.error.toLowerCase()).toContain('code')
    runtime.stop()
  }, 15_000)

  it('subworkflow node runs another workflow and returns its output', async () => {
    const child = buildWorkflow({
      id: 'child',
      name: 'Child',
      enabled: true,
      nodes: [
        { id: 'cm', type: 'manual-trigger', config: {} },
        { id: 'cs', type: 'set-fields', config: { fields: [{ key: 'childOut', value: 'yes' }], keepIncoming: false } }
      ],
      connections: [{ id: 'ce1', source: 'cm', sourceHandle: 'out', target: 'cs', targetHandle: 'in' }]
    })
    const parent = buildWorkflow({
      id: 'parent',
      name: 'Parent',
      enabled: true,
      nodes: [
        { id: 'pm', type: 'manual-trigger', config: {} },
        { id: 'sub', type: 'subworkflow', config: { workflowId: 'child' } }
      ],
      connections: [{ id: 'pe1', source: 'pm', sourceHandle: 'out', target: 'sub', targetHandle: 'in' }]
    })
    const store = createStore(settingsWithWorkflows([child, parent]))
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: vi.fn() as never, logError: vi.fn() })
    const runId = requireOk(await runtime.runWorkflow('parent'))
    await waitFor(async () => {
      const run = (await store.load()).workflow.workflows
        .find((wf) => wf.id === 'parent')!
        .runs.find((entry) => entry.id === runId)
      return Boolean(run && run.status !== 'running')
    }, 10_000)
    const run = store.read().workflow.workflows.find((wf) => wf.id === 'parent')!.runs.find((entry) => entry.id === runId)!
    expect(run.status).toBe('success')
    const sub = run.nodeResults.find((result) => result.nodeId === 'sub')!
    expect(JSON.parse(sub.outputJson)).toEqual({ childOut: 'yes' })
    runtime.stop()
  }, 15_000)

  it('subworkflow recursion is bounded by the depth guard', async () => {
    const selfRef = buildWorkflow({
      id: 'self',
      name: 'Self',
      enabled: true,
      nodes: [
        { id: 'm', type: 'manual-trigger', config: {} },
        { id: 'sub', type: 'subworkflow', config: { workflowId: 'self' } }
      ],
      connections: [{ id: 'e1', source: 'm', sourceHandle: 'out', target: 'sub', targetHandle: 'in' }]
    })
    const store = createStore(settingsWithWorkflows([selfRef]))
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: vi.fn() as never, logError: vi.fn() })
    const runId = requireOk(await runtime.runWorkflow('self'))
    await waitFor(async () => {
      const run = (await store.load()).workflow.workflows[0].runs.find((entry) => entry.id === runId)
      return Boolean(run && run.status !== 'running')
    }, 10_000)
    const run = store.read().workflow.workflows[0].runs.find((entry) => entry.id === runId)!
    expect(run.status).toBe('error')
    expect(run.nodeResults.find((result) => result.nodeId === 'sub')!.error.toLowerCase()).toContain('deep')
    runtime.stop()
  }, 15_000)

  it('webhook trigger fires the workflow with the request body', async () => {
    const port = 18765
    const settings = settingsWithWorkflows([
      buildWorkflow({
        id: 'wf-wh',
        name: 'Wh',
        enabled: true,
        nodes: [
          { id: 'w', type: 'webhook-trigger', config: { path: '/hook', method: 'POST' } },
          {
            id: 's',
            type: 'set-fields',
            config: { fields: [{ key: 'echo', value: '{{json.name}}' }], keepIncoming: false }
          }
        ],
        connections: [{ id: 'e1', source: 'w', sourceHandle: 'out', target: 's', targetHandle: 'in' }]
      })
    ])
    settings.workflow.webhookPort = port
    const store = createStore(settings)
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: vi.fn() as never, logError: vi.fn() })
    runtime.sync(store.read())
    try {
      await new Promise((resolve) => setTimeout(resolve, 250))
      const response = await fetch(`http://127.0.0.1:${port}/hook`, {
        method: 'POST',
        body: JSON.stringify({ name: 'kun' })
      })
      const body = (await response.json()) as { ok: boolean; runId: string }
      expect(response.status).toBe(200)
      expect(body.ok).toBe(true)
      await waitFor(async () => {
        const run = (await store.load()).workflow.workflows[0].runs.find((entry) => entry.id === body.runId)
        return Boolean(run && run.status !== 'running')
      }, 5_000)
      const run = store.read().workflow.workflows[0].runs.find((entry) => entry.id === body.runId)!
      expect(run.status).toBe('success')
      const setResult = run.nodeResults.find((result) => result.nodeId === 's')!
      expect(JSON.parse(setResult.outputJson)).toEqual({ echo: 'kun' })
    } finally {
      runtime.stop()
    }
  }, 15_000)

  it('loop runs the body until the stop condition holds', async () => {
    const body = buildWorkflow({
      id: 'body',
      name: 'Body',
      enabled: true,
      nodes: [
        { id: 'bm', type: 'manual-trigger', config: {} },
        { id: 'bc', type: 'code', config: { code: 'return { n: (Number($json.n) || 0) + 1 }' } }
      ],
      connections: [{ id: 'be1', source: 'bm', sourceHandle: 'out', target: 'bc', targetHandle: 'in' }]
    })
    const parent = buildWorkflow({
      id: 'parent',
      name: 'P',
      enabled: true,
      nodes: [
        { id: 'm', type: 'manual-trigger', config: {} },
        {
          id: 'lp',
          type: 'loop',
          config: {
            workflowId: 'body',
            maxIterations: 10,
            leftExpr: 'json.n',
            operator: 'gte',
            rightValue: '3',
            caseSensitive: false
          }
        }
      ],
      connections: [{ id: 'e1', source: 'm', sourceHandle: 'out', target: 'lp', targetHandle: 'in' }]
    })
    const store = createStore(settingsWithWorkflows([body, parent]))
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: vi.fn() as never, logError: vi.fn() })
    const runId = requireOk(await runtime.runWorkflow('parent'))
    await waitFor(async () => {
      const run = (await store.load()).workflow.workflows
        .find((wf) => wf.id === 'parent')!
        .runs.find((entry) => entry.id === runId)
      return Boolean(run && run.status !== 'running')
    }, 10_000)
    const run = store.read().workflow.workflows.find((wf) => wf.id === 'parent')!.runs.find((entry) => entry.id === runId)!
    expect(run.status).toBe('success')
    const loop = run.nodeResults.find((result) => result.nodeId === 'lp')!
    const output = JSON.parse(loop.outputJson) as { n: number; _iterations: number; _done: boolean }
    expect(output.n).toBe(3)
    expect(output._iterations).toBe(3)
    expect(output._done).toBe(true)
    runtime.stop()
  }, 15_000)

})
