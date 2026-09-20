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

  it('loop foreach (parallel) maps each array item through the body, preserving order', async () => {
    const body = buildWorkflow({
      id: 'fe-body',
      name: 'FeBody',
      enabled: true,
      nodes: [
        { id: 'bm', type: 'manual-trigger', config: {} },
        { id: 'bs', type: 'set-fields', config: { fields: [{ key: 'out', value: '{{$loop.item}}!' }], keepIncoming: false } }
      ],
      connections: [{ id: 'be1', source: 'bm', sourceHandle: 'out', target: 'bs', targetHandle: 'in' }]
    })
    const parent = buildWorkflow({
      id: 'fe-parent',
      name: 'FeParent',
      enabled: true,
      nodes: [
        { id: 'm', type: 'manual-trigger', config: {} },
        { id: 'arr', type: 'code', config: { code: "return ['a', 'b', 'c']" } },
        {
          id: 'lp',
          type: 'loop',
          config: {
            workflowId: 'fe-body',
            mode: 'foreach',
            execution: 'parallel',
            concurrency: 3,
            maxIterations: 10,
            leftExpr: '',
            operator: 'equals',
            rightValue: '',
            caseSensitive: false
          }
        }
      ],
      connections: [
        { id: 'e1', source: 'm', sourceHandle: 'out', target: 'arr', targetHandle: 'in' },
        { id: 'e2', source: 'arr', sourceHandle: 'out', target: 'lp', targetHandle: 'in' }
      ]
    })
    const store = createStore(settingsWithWorkflows([body, parent]))
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: vi.fn() as never, logError: vi.fn() })
    const runId = requireOk(await runtime.runWorkflow('fe-parent'))
    await waitFor(async () => {
      const run = (await store.load()).workflow.workflows
        .find((wf) => wf.id === 'fe-parent')!
        .runs.find((entry) => entry.id === runId)
      return Boolean(run && run.status !== 'running')
    }, 10_000)
    const run = store.read().workflow.workflows.find((wf) => wf.id === 'fe-parent')!.runs.find((entry) => entry.id === runId)!
    expect(run.status).toBe('success')
    const loop = run.nodeResults.find((result) => result.nodeId === 'lp')!
    expect(JSON.parse(loop.outputJson)).toEqual([{ out: 'a!' }, { out: 'b!' }, { out: 'c!' }])
    runtime.stop()
  }, 15_000)

  it('human-approval pauses the run and routes to the approved branch', async () => {
    const workflow = buildWorkflow({
      id: 'wf-ha',
      name: 'HA',
      enabled: true,
      nodes: [
        { id: 'm', type: 'manual-trigger', config: {} },
        { id: 'a', type: 'human-approval', config: { title: 'Confirm', instruction: 'ok?', timeoutMs: 0, onTimeout: 'rejected' } },
        { id: 'yes', type: 'set-fields', config: { fields: [{ key: 'path', value: 'approved' }], keepIncoming: false } },
        { id: 'no', type: 'set-fields', config: { fields: [{ key: 'path', value: 'rejected' }], keepIncoming: false } }
      ],
      connections: [
        { id: 'e1', source: 'm', sourceHandle: 'out', target: 'a', targetHandle: 'in' },
        { id: 'e2', source: 'a', sourceHandle: 'approved', target: 'yes', targetHandle: 'in' },
        { id: 'e3', source: 'a', sourceHandle: 'rejected', target: 'no', targetHandle: 'in' }
      ]
    })
    const store = createStore(settingsWithWorkflows([workflow]))
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: vi.fn() as never, logError: vi.fn() })
    const runId = requireOk(await runtime.runWorkflow('wf-ha'))
    await waitFor(async () => (await runtime.status()).pendingApprovals.length > 0, 10_000)
    const pending = (await runtime.status()).pendingApprovals[0]
    expect(pending.title).toBe('Confirm')
    expect(pending.instruction).toBe('ok?')
    // Live run log: while paused, the trigger has a finished result and the approval node is mid-run.
    const live = await runtime.status()
    expect(live.nodeResults['wf-ha']?.['m']?.status).toBe('success')
    expect(live.nodeResults['wf-ha']?.['a']?.status).toBe('running')
    expect(runtime.resolveApproval(pending.token, 'approved')).toBe(true)
    await waitFor(async () => {
      const run = store.read().workflow.workflows[0].runs.find((entry) => entry.id === runId)
      return Boolean(run && run.status !== 'running')
    }, 10_000)
    const run = store.read().workflow.workflows[0].runs.find((entry) => entry.id === runId)!
    expect(run.status).toBe('success')
    expect(run.nodeResults.find((result) => result.nodeId === 'yes')?.status).toBe('success')
    const rejectedBranch = run.nodeResults.find((result) => result.nodeId === 'no')
    expect(rejectedBranch === undefined || rejectedBranch.status === 'skipped').toBe(true)
    runtime.stop()
  }, 20_000)

  it('stop cancels a nested in-flight HTTP node and waits for terminal persistence', async () => {
    const child = buildWorkflow({
      id: 'shutdown-child',
      name: 'Shutdown child',
      enabled: true,
      nodes: [
        { id: 'child-trigger', type: 'manual-trigger', config: {} },
        {
          id: 'child-http',
          type: 'http-request',
          config: {
            method: 'GET',
            url: 'https://example.test/slow',
            headers: [],
            body: '',
            parseJson: false,
            timeoutMs: 60_000
          }
        }
      ],
      connections: [
        { id: 'child-edge', source: 'child-trigger', target: 'child-http' }
      ]
    })
    const parent = buildWorkflow({
      id: 'shutdown-parent',
      name: 'Shutdown parent',
      enabled: true,
      nodes: [
        { id: 'parent-trigger', type: 'manual-trigger', config: {} },
        { id: 'parent-sub', type: 'subworkflow', config: { workflowId: child.id } }
      ],
      connections: [
        { id: 'parent-edge', source: 'parent-trigger', target: 'parent-sub' }
      ]
    })
    let requestSignal: AbortSignal | undefined
    let requestStarted!: () => void
    const started = new Promise<void>((resolve) => { requestStarted = resolve })
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      requestSignal = init.signal as AbortSignal
      requestStarted()
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        }, { once: true })
      })
    }))
    const store = createStore(settingsWithWorkflows([child, parent]))
    const runtime = createWorkflowRuntime({
      store: store as never,
      runtimeRequest: vi.fn() as never,
      logError: vi.fn()
    })

    const runId = requireOk(await runtime.runWorkflow(parent.id))
    await started
    await runtime.stop()

    expect(requestSignal?.aborted).toBe(true)
    const run = store.read().workflow.workflows
      .find((workflow) => workflow.id === parent.id)!
      .runs.find((entry) => entry.id === runId)
    expect(run).toMatchObject({ status: 'error', message: 'Canceled.' })
    expect((await runtime.status()).runningWorkflowIds).toEqual([])
  })

  it('runForHook runs a bound workflow with the hook payload as {{json.*}}', async () => {
    const workflow = buildWorkflow({
      id: 'hk',
      name: 'Hook',
      enabled: true,
      nodes: [
        { id: 'm', type: 'manual-trigger', config: {} },
        { id: 's', type: 'set-fields', config: { fields: [{ key: 'seen', value: '{{json.call.toolName}}' }], keepIncoming: false } }
      ],
      connections: [{ id: 'e1', source: 'm', sourceHandle: 'out', target: 's', targetHandle: 'in' }]
    })
    const store = createStore(settingsWithWorkflows([workflow]))
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: vi.fn() as never, logError: vi.fn() })
    const result = await runtime.runForHook('hk', { call: { toolName: 'write' } })
    expect(result.skipped).toBe(false)
    expect(result.status).toBe('success')
    expect(result.output).toContain('write')
    runtime.stop()
  }, 15_000)

  it('hook runs are reentrancy-guarded so a workflow can not loop via its own edits', async () => {
    const workflow = buildWorkflow({
      id: 'hkp',
      name: 'HookPause',
      enabled: true,
      nodes: [
        { id: 'm', type: 'manual-trigger', config: {} },
        { id: 'a', type: 'human-approval', config: { title: 'x', instruction: '', timeoutMs: 0, onTimeout: 'rejected' } }
      ],
      connections: [{ id: 'e1', source: 'm', sourceHandle: 'out', target: 'a', targetHandle: 'in' }]
    })
    const store = createStore(settingsWithWorkflows([workflow]))
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: vi.fn() as never, logError: vi.fn() })
    const first = runtime.runForHook('hkp', {}) // pauses at the approval node
    await waitFor(async () => (await runtime.status()).pendingApprovals.length > 0, 10_000)
    const second = await runtime.runForHook('hkp', {}) // blocked: a hook run is already active
    expect(second.skipped).toBe(true)
    const token = (await runtime.status()).pendingApprovals[0].token
    runtime.resolveApproval(token, 'approved')
    await first
    runtime.stop()
  }, 20_000)

  it('redacts secret env values from the run-level error message and node error', async () => {
    const workflow = buildWorkflow({
      id: 'wf-secret',
      name: 'Secret',
      enabled: true,
      env: [{ key: 'TOKEN', value: 'sk-leak-123', type: 'secret' }],
      nodes: [
        { id: 'm', type: 'manual-trigger', config: {} },
        { id: 'c', type: 'code', config: { code: "throw new Error('boom sk-leak-123 boom')" } }
      ],
      connections: [{ id: 'e1', source: 'm', sourceHandle: 'out', target: 'c', targetHandle: 'in' }]
    })
    const store = createStore(settingsWithWorkflows([workflow]))
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: vi.fn() as never, logError: vi.fn() })
    const runId = requireOk(await runtime.runWorkflow('wf-secret'))
    await waitFor(async () => {
      const run = store.read().workflow.workflows[0].runs.find((entry) => entry.id === runId)
      return Boolean(run && run.status !== 'running')
    }, 10_000)
    const wf = store.read().workflow.workflows[0]
    const run = wf.runs.find((entry) => entry.id === runId)!
    expect(run.status).toBe('error')
    // The secret must not leak into the run message, the node error, or the workflow's lastMessage.
    expect(run.message).not.toContain('sk-leak-123')
    expect(run.message).toContain('***')
    expect(run.nodeResults.find((result) => result.nodeId === 'c')?.error).not.toContain('sk-leak-123')
    expect(wf.lastMessage).not.toContain('sk-leak-123')
    runtime.stop()
  }, 15_000)

  it('resolves typed node inputs from upstream and exposes them as {{$input.key}}', async () => {
    const workflow = buildWorkflow({
      id: 'wf-in',
      name: 'Inputs',
      enabled: true,
      nodes: [
        { id: 'm', type: 'manual-trigger', config: {} },
        { id: 'c', type: 'code', config: { code: "return { title: 'hello', n: 7 }" } },
        {
          id: 'tpl',
          type: 'template',
          inputs: [
            { key: 't', type: 'text', source: '{{$nodes.c.json.title}}' },
            { key: 'num', type: 'number', source: '{{$nodes.c.json.n}}' }
          ],
          config: { template: '{{$input.t}}-{{$input.num}}', outputMode: 'text' }
        }
      ],
      connections: [
        { id: 'e1', source: 'm', sourceHandle: 'out', target: 'c', targetHandle: 'in' },
        { id: 'e2', source: 'c', sourceHandle: 'out', target: 'tpl', targetHandle: 'in' }
      ]
    })
    const store = createStore(settingsWithWorkflows([workflow]))
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: vi.fn() as never, logError: vi.fn() })
    const runId = requireOk(await runtime.runWorkflow('wf-in'))
    await waitFor(async () => {
      const run = store.read().workflow.workflows[0].runs.find((entry) => entry.id === runId)
      return Boolean(run && run.status !== 'running')
    }, 10_000)
    const run = store.read().workflow.workflows[0].runs.find((entry) => entry.id === runId)!
    expect(run.status).toBe('success')
    const tpl = run.nodeResults.find((result) => result.nodeId === 'tpl')!
    expect(JSON.parse(tpl.outputJson).text).toBe('hello-7')
    runtime.stop()
  }, 15_000)

  it('sort orders the upstream array by a numeric field', async () => {
    const store = createStore(
      settingsWithWorkflows([
        buildWorkflow({
          id: 'wf-sort',
          name: 'Sort',
          enabled: true,
          nodes: [
            { id: 'm', type: 'manual-trigger', config: {} },
            { id: 'c', type: 'code', config: { code: 'return [{v:3},{v:1},{v:2}]' } },
            { id: 'srt', type: 'sort', config: { field: 'v', order: 'asc', numeric: true } }
          ],
          connections: [
            { id: 'e1', source: 'm', sourceHandle: 'out', target: 'c', targetHandle: 'in' },
            { id: 'e2', source: 'c', sourceHandle: 'out', target: 'srt', targetHandle: 'in' }
          ]
        })
      ])
    )
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: vi.fn() as never, logError: vi.fn() })
    const runId = requireOk(await runtime.runWorkflow('wf-sort'))
    await waitFor(async () => {
      const run = (await store.load()).workflow.workflows[0].runs.find((entry) => entry.id === runId)
      return Boolean(run && run.status !== 'running')
    }, 10_000)
    const run = store.read().workflow.workflows[0].runs.find((entry) => entry.id === runId)!
    expect(run.status).toBe('success')
    const sorted = run.nodeResults.find((result) => result.nodeId === 'srt')!
    expect(JSON.parse(sorted.outputJson)).toEqual([{ v: 1 }, { v: 2 }, { v: 3 }])
    runtime.stop()
  }, 15_000)

  it('limit keeps the last N items of the upstream array', async () => {
    const store = createStore(
      settingsWithWorkflows([
        buildWorkflow({
          id: 'wf-limit',
          name: 'Limit',
          enabled: true,
          nodes: [
            { id: 'm', type: 'manual-trigger', config: {} },
            { id: 'c', type: 'code', config: { code: 'return [1,2,3,4,5]' } },
            { id: 'lim', type: 'limit', config: { count: 2, from: 'last' } }
          ],
          connections: [
            { id: 'e1', source: 'm', sourceHandle: 'out', target: 'c', targetHandle: 'in' },
            { id: 'e2', source: 'c', sourceHandle: 'out', target: 'lim', targetHandle: 'in' }
          ]
        })
      ])
    )
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: vi.fn() as never, logError: vi.fn() })
    const runId = requireOk(await runtime.runWorkflow('wf-limit'))
    await waitFor(async () => {
      const run = (await store.load()).workflow.workflows[0].runs.find((entry) => entry.id === runId)
      return Boolean(run && run.status !== 'running')
    }, 10_000)
    const run = store.read().workflow.workflows[0].runs.find((entry) => entry.id === runId)!
    expect(run.status).toBe('success')
    const limited = run.nodeResults.find((result) => result.nodeId === 'lim')!
    expect(JSON.parse(limited.outputJson)).toEqual([4, 5])
    runtime.stop()
  }, 15_000)

  it('aggregate sums a field across the upstream array', async () => {
    const store = createStore(
      settingsWithWorkflows([
        buildWorkflow({
          id: 'wf-agg',
          name: 'Agg',
          enabled: true,
          nodes: [
            { id: 'm', type: 'manual-trigger', config: {} },
            { id: 'c', type: 'code', config: { code: 'return [{price:10},{price:5},{price:7}]' } },
            { id: 'ag', type: 'aggregate', config: { mode: 'sum', field: 'price', separator: ', ' } }
          ],
          connections: [
            { id: 'e1', source: 'm', sourceHandle: 'out', target: 'c', targetHandle: 'in' },
            { id: 'e2', source: 'c', sourceHandle: 'out', target: 'ag', targetHandle: 'in' }
          ]
        })
      ])
    )
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: vi.fn() as never, logError: vi.fn() })
    const runId = requireOk(await runtime.runWorkflow('wf-agg'))
    await waitFor(async () => {
      const run = (await store.load()).workflow.workflows[0].runs.find((entry) => entry.id === runId)
      return Boolean(run && run.status !== 'running')
    }, 10_000)
    const run = store.read().workflow.workflows[0].runs.find((entry) => entry.id === runId)!
    expect(run.status).toBe('success')
    const agg = run.nodeResults.find((result) => result.nodeId === 'ag')!
    expect(JSON.parse(agg.outputJson)).toEqual({ sum: 22 })
    runtime.stop()
  }, 15_000)

  it('filter passes the branch when the condition holds and prunes it otherwise', async () => {
    const makeFilterWorkflow = (id: string, rightValue: string): WorkflowV1 =>
      buildWorkflow({
        id,
        name: id,
        enabled: true,
        nodes: [
          { id: 'm', type: 'manual-trigger', config: {} },
          { id: 's', type: 'set-fields', config: { fields: [{ key: 'v', value: 'B' }], keepIncoming: false } },
          { id: 'f', type: 'filter', config: { leftExpr: 'json.v', operator: 'equals', rightValue, caseSensitive: false } },
          { id: 'd', type: 'set-fields', config: { fields: [{ key: 'hit', value: '1' }], keepIncoming: false } }
        ],
        connections: [
          { id: 'e1', source: 'm', sourceHandle: 'out', target: 's', targetHandle: 'in' },
          { id: 'e2', source: 's', sourceHandle: 'out', target: 'f', targetHandle: 'in' },
          { id: 'e3', source: 'f', sourceHandle: 'out', target: 'd', targetHandle: 'in' }
        ]
      })

    const store = createStore(
      settingsWithWorkflows([makeFilterWorkflow('wf-pass', 'B'), makeFilterWorkflow('wf-block', 'C')])
    )
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: vi.fn() as never, logError: vi.fn() })

    const passId = requireOk(await runtime.runWorkflow('wf-pass'))
    const blockId = requireOk(await runtime.runWorkflow('wf-block'))
    await waitFor(async () => {
      const settings = await store.load()
      const passRun = settings.workflow.workflows.find((wf) => wf.id === 'wf-pass')!.runs.find((e) => e.id === passId)
      const blockRun = settings.workflow.workflows.find((wf) => wf.id === 'wf-block')!.runs.find((e) => e.id === blockId)
      return Boolean(passRun && passRun.status !== 'running' && blockRun && blockRun.status !== 'running')
    }, 10_000)

    const settings = store.read()
    const passRun = settings.workflow.workflows.find((wf) => wf.id === 'wf-pass')!.runs.find((e) => e.id === passId)!
    const blockRun = settings.workflow.workflows.find((wf) => wf.id === 'wf-block')!.runs.find((e) => e.id === blockId)!
    expect(passRun.status).toBe('success')
    expect(passRun.nodeResults.map((r) => r.nodeId)).toContain('d')
    expect(blockRun.status).toBe('success')
    expect(blockRun.nodeResults.map((r) => r.nodeId)).not.toContain('d')
    runtime.stop()
  }, 15_000)

  it('code node runs a bash script with stdin/env input and parses its stdout', async () => {
    const store = createStore(
      settingsWithWorkflows([
        buildWorkflow({
          id: 'wf-bash',
          name: 'Bash',
          enabled: true,
          nodes: [
            { id: 'm', type: 'manual-trigger', config: {} },
            { id: 's', type: 'set-fields', config: { fields: [{ key: 'n', value: '5' }], keepIncoming: false } },
            {
              id: 'c',
              type: 'code',
              config: { language: 'bash', code: 'echo "{\\"got\\": $WORKFLOW_JSON, \\"lang\\": \\"bash\\"}"' }
            }
          ],
          connections: [
            { id: 'e1', source: 'm', sourceHandle: 'out', target: 's', targetHandle: 'in' },
            { id: 'e2', source: 's', sourceHandle: 'out', target: 'c', targetHandle: 'in' }
          ]
        })
      ])
    )
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: vi.fn() as never, logError: vi.fn() })
    const runId = requireOk(await runtime.runWorkflow('wf-bash'))
    await waitFor(async () => {
      const run = (await store.load()).workflow.workflows[0].runs.find((entry) => entry.id === runId)
      return Boolean(run && run.status !== 'running')
    }, 10_000)
    const run = store.read().workflow.workflows[0].runs.find((entry) => entry.id === runId)!
    expect(run.status).toBe('success')
    const code = run.nodeResults.find((result) => result.nodeId === 'c')!
    const output = JSON.parse(code.outputJson) as { got: { n: string }; lang: string }
    expect(output.lang).toBe('bash')
    expect(output.got.n).toBe('5')
    runtime.stop()
  }, 15_000)

  it('custom node runs its module with the injected $fields', async () => {
    const module: WorkflowCustomModuleV1 = {
      id: 'mod-greet',
      name: 'Greet',
      description: '',
      icon: '',
      language: 'javascript',
      fields: [{ key: 'who', label: 'Who', type: 'text', defaultValue: 'world', options: [], placeholder: '' }],
      code: 'return { greeting: "hi " + $fields.who }'
    }
    const store = createStore(
      settingsWithWorkflows(
        [
          buildWorkflow({
            id: 'wf-cm',
            name: 'CM',
            enabled: true,
            nodes: [
              { id: 'm', type: 'manual-trigger', config: {} },
              { id: 'c', type: 'custom', config: { moduleId: 'mod-greet', values: { who: 'Kun' } } }
            ],
            connections: [{ id: 'e1', source: 'm', sourceHandle: 'out', target: 'c', targetHandle: 'in' }]
          })
        ],
        [module]
      )
    )
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: vi.fn() as never, logError: vi.fn() })
    const runId = requireOk(await runtime.runWorkflow('wf-cm'))
    await waitFor(async () => {
      const run = (await store.load()).workflow.workflows[0].runs.find((entry) => entry.id === runId)
      return Boolean(run && run.status !== 'running')
    }, 10_000)
    const run = store.read().workflow.workflows[0].runs.find((entry) => entry.id === runId)!
    expect(run.status).toBe('success')
    const custom = run.nodeResults.find((result) => result.nodeId === 'c')!
    expect(JSON.parse(custom.outputJson)).toEqual({ greeting: 'hi Kun' })
    runtime.stop()
  }, 15_000)

  it('template node renders a text string from the payload', async () => {
    const store = createStore(
      settingsWithWorkflows([
        buildWorkflow({
          id: 'wf-tpl',
          name: 'Tpl',
          enabled: true,
          nodes: [
            { id: 'm', type: 'manual-trigger', config: {} },
            { id: 's', type: 'set-fields', config: { fields: [{ key: 'name', value: 'World' }], keepIncoming: false } },
            { id: 't', type: 'template', config: { template: 'Hello {{json.name}}!', outputMode: 'text' } }
          ],
          connections: [
            { id: 'e1', source: 'm', sourceHandle: 'out', target: 's', targetHandle: 'in' },
            { id: 'e2', source: 's', sourceHandle: 'out', target: 't', targetHandle: 'in' }
          ]
        })
      ])
    )
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: vi.fn() as never, logError: vi.fn() })
    const runId = requireOk(await runtime.runWorkflow('wf-tpl'))
    await waitFor(async () => {
      const run = (await store.load()).workflow.workflows[0].runs.find((entry) => entry.id === runId)
      return Boolean(run && run.status !== 'running')
    }, 10_000)
    const run = store.read().workflow.workflows[0].runs.find((entry) => entry.id === runId)!
    expect(run.status).toBe('success')
    const tpl = run.nodeResults.find((result) => result.nodeId === 't')!
    expect((JSON.parse(tpl.outputJson) as { text: string }).text).toBe('Hello World!')
    runtime.stop()
  }, 15_000)

  it('json node parses a text string into structured json', async () => {
    const store = createStore(
      settingsWithWorkflows([
        buildWorkflow({
          id: 'wf-json',
          name: 'Json',
          enabled: true,
          nodes: [
            { id: 'm', type: 'manual-trigger', config: {} },
            { id: 't', type: 'template', config: { template: '{"a": 1, "b": "x"}', outputMode: 'text' } },
            { id: 'j', type: 'json', config: { mode: 'parse', strict: false } }
          ],
          connections: [
            { id: 'e1', source: 'm', sourceHandle: 'out', target: 't', targetHandle: 'in' },
            { id: 'e2', source: 't', sourceHandle: 'out', target: 'j', targetHandle: 'in' }
          ]
        })
      ])
    )
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: vi.fn() as never, logError: vi.fn() })
    const runId = requireOk(await runtime.runWorkflow('wf-json'))
    await waitFor(async () => {
      const run = (await store.load()).workflow.workflows[0].runs.find((entry) => entry.id === runId)
      return Boolean(run && run.status !== 'running')
    }, 10_000)
    const run = store.read().workflow.workflows[0].runs.find((entry) => entry.id === runId)!
    expect(run.status).toBe('success')
    const jsonNode = run.nodeResults.find((result) => result.nodeId === 'j')!
    expect(JSON.parse(jsonNode.outputJson)).toEqual({ a: 1, b: 'x' })
    runtime.stop()
  }, 15_000)

})
