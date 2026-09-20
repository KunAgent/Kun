// Per-node-type unit-test catalog for the workflow runtime.
//
// Goal: EVERY WorkflowNodeKind ("item") has at least one unit test here, and
// every meaningful mode/branch of the data-shaping nodes is exercised, so we can
// prove all node types actually work. A completeness guard at the bottom fails if
// a new kind is added to WORKFLOW_NODE_KINDS without a test landing here.
//
// Most non-trigger nodes are tested through `runtime.testNode()` — it runs a
// single node in isolation against a mock upstream payload and returns the node's
// result (status/message/outputJson/error/threadId) without touching the graph
// scheduler, which is the cleanest "unit" boundary for one node. Graph-level
// semantics (branch pruning, joins, the webhook server, secret redaction) live in
// workflow-runtime.run.test.ts; this file does not duplicate them.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WORKFLOW_NODE_KINDS,
  defaultClawSettings,
  defaultDesignSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWriteSettings,
  defaultTerminalSettings, defaultRemoteAccessSettings,
  mergeWorkflowSettings,
  normalizeWorkflow,
  normalizeWorkflowSettings,
  type AppSettingsPatch,
  type AppSettingsV1,
  type WorkflowCustomModuleV1,
  type WorkflowNodeKind,
  type WorkflowNodeRunResultV1,
  type WorkflowRunV1,
  type WorkflowV1
} from '../shared/app-settings'
import {
  computeWorkflowNextRunAt,
  createWorkflowRuntime,
  workflowHasScheduleTrigger,
  type WorkflowRuntime
} from './workflow-runtime'

const imageGenerateMock = vi.hoisted(() => vi.fn(async () => ({
  data: Buffer.from('PNG-BYTES'),
  mimeType: 'image/png'
})))

// The generate-image node lazily imports the kun image client. Replace it with a
// stub so the test never hits a real provider (and never pulls native deps in).
vi.mock('../../kun/src/adapters/tool/image-gen-tool-provider.js', () => ({
  createImageGenClient: () => ({
    generate: imageGenerateMock
  }),
  mapImageSize: (
    _aspectRatio: string | undefined,
    _imageSize: string | undefined,
    _defaultSize: string | undefined,
    defaultResolution: 'auto' | '1K' | '2K' = '1K'
  ) => defaultResolution === 'auto'
    ? 'auto'
    : defaultResolution === '2K' ? '2048x2048' : '1024x1024'
}))

const NOW = '2026-06-19T00:00:00.000Z'
const PYTHON_OK = spawnSync('python3', ['-c', 'pass']).status === 0
let workflowWorkspaceRoot = ''

// ---------------------------------------------------------------------------
// Loose builders — the runtime normalizes raw input, so tests pass partial
// configs and let normalizeWorkflow fill defaults (one explicit cast at the edge
// keeps the whole file type-clean).
// ---------------------------------------------------------------------------

type NodeSpec = {
  id: string
  type: WorkflowNodeKind
  name?: string
  disabled?: boolean
  onError?: 'fail' | 'continue' | 'fallback'
  retries?: number
  inputs?: { key: string; type: 'text' | 'number' | 'boolean' | 'json'; source: string }[]
  config?: Record<string, unknown>
}

type ConnSpec = { id: string; source: string; sourceHandle?: string; target: string; targetHandle?: string }

type WorkflowSpec = {
  id: string
  name?: string
  enabled?: boolean
  nodes: NodeSpec[]
  connections?: ConnSpec[]
}

function wf(spec: WorkflowSpec): WorkflowV1 {
  const raw = {
    enabled: true,
    ...spec,
    connections: (spec.connections ?? []).map((c) => ({
      sourceHandle: 'out',
      targetHandle: 'in',
      ...c
    }))
  }
  return normalizeWorkflow(raw as unknown as Partial<WorkflowV1>, 0, NOW)
}

type SettingsPatch = (settings: AppSettingsV1) => AppSettingsV1

function buildSettings(
  workflows: WorkflowV1[],
  modules: WorkflowCustomModuleV1[] = [],
  patch?: SettingsPatch
): AppSettingsV1 {
  const base: AppSettingsV1 = {
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
  return patch ? patch(base) : base
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
    read: () => current
  }
}

const okEmpty = { ok: false, status: 404, body: '{}' } as const
const defaultRuntimeRequest = (): ReturnType<typeof vi.fn> => vi.fn(async () => okEmpty)

/** Build a runtimeRequest mock that drives the thread→turn→poll path and returns `replyText`. */
function aiRuntimeRequest(replyText: string): ReturnType<typeof vi.fn> {
  return vi.fn(async (_settings: AppSettingsV1, pathAndQuery: string, _init?: { body?: string }) => {
    if (pathAndQuery === '/v1/threads') return { ok: true, status: 200, body: JSON.stringify({ id: 'thread-1' }) }
    if (pathAndQuery.includes('/turns')) return { ok: true, status: 200, body: JSON.stringify({ turn: { id: 'turn-1' } }) }
    if (pathAndQuery.startsWith('/v1/threads/')) {
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({
          turns: [
            { id: 'turn-1', status: 'completed', items: [{ kind: 'assistant_text', text: replyText, turnId: 'turn-1' }] }
          ]
        })
      }
    }
    return okEmpty
  })
}

type TestNodeOpts = {
  extraWorkflows?: WorkflowV1[]
  modules?: WorkflowCustomModuleV1[]
  runtimeRequest?: ReturnType<typeof vi.fn>
  patch?: SettingsPatch
}

/** Run one node in isolation against `mockJson` and return its result (throws on a runtime lookup failure). */
async function testNode(node: NodeSpec, mockJson = '{}', opts: TestNodeOpts = {}): Promise<WorkflowNodeRunResultV1> {
  const target = wf({ id: 'wf-under-test', name: 'wf-under-test', nodes: [node] })
  const settings = buildSettings([target, ...(opts.extraWorkflows ?? [])], opts.modules, opts.patch)
  const store = createStore(settings)
  const runtime = createWorkflowRuntime({
    store: store as never,
    runtimeRequest: (opts.runtimeRequest ?? defaultRuntimeRequest()) as never,
    logError: vi.fn()
  })
  try {
    const res = await runtime.testNode('wf-under-test', node.id, mockJson)
    if (!res.ok) throw new Error(res.message)
    return res.result
  } finally {
    runtime.stop()
  }
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  throw new Error('Timed out waiting for workflow run to finish')
}

/** Run a full workflow to completion and return the persisted run record. */
async function runToEnd(
  runtime: WorkflowRuntime,
  store: ReturnType<typeof createStore>,
  workflowId: string,
  input?: unknown
): Promise<WorkflowRunV1> {
  const started = await runtime.runWorkflow(workflowId, input)
  if (!started.ok || !started.runId) throw new Error(`runWorkflow failed: ${started.message}`)
  const runId = started.runId
  await waitFor(async () => {
    const run = (await store.load()).workflow.workflows.find((w) => w.id === workflowId)?.runs.find((e) => e.id === runId)
    return Boolean(run && run.status !== 'running')
  }, 10_000)
  return store.read().workflow.workflows.find((w) => w.id === workflowId)!.runs.find((e) => e.id === runId)!
}

function parseOut(result: WorkflowNodeRunResultV1): unknown {
  return JSON.parse(result.outputJson)
}

/** Parse the JSON body of a recorded runtimeRequest call (call[2] = the request init). */
function callBody(call: unknown): Record<string, unknown> {
  const init = (call as unknown[])[2] as { body?: string } | undefined
  return init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {}
}

/** The prompt the AI node actually sent to the kun runtime (from the /turns request). */
function turnPrompt(rr: ReturnType<typeof vi.fn>): string {
  const call = rr.mock.calls.find((c) => String((c as unknown[])[1]).includes('/turns'))
  return call ? String(callBody(call).prompt ?? '') : ''
}

/** The workspace the AI node opened its thread in (from the POST /v1/threads request). */
function threadWorkspace(rr: ReturnType<typeof vi.fn>): string {
  const call = rr.mock.calls.find((c) => (c as unknown[])[1] === '/v1/threads')
  return call ? String(callBody(call).workspace ?? '') : ''
}

// Tracks which kinds this file actually tests; the completeness guard cross-checks
// it against WORKFLOW_NODE_KINDS so no node type can ship without coverage.
const COVERED = new Set<WorkflowNodeKind>()
function cover(kind: WorkflowNodeKind): WorkflowNodeKind {
  COVERED.add(kind)
  return kind
}

const FIELD = (over: Record<string, unknown>): Record<string, unknown> => ({
  key: 'k',
  label: 'K',
  type: 'text',
  required: false,
  options: [],
  defaultValue: '',
  description: '',
  ...over
})
beforeEach(() => {
  workflowWorkspaceRoot = mkdtempSync(join(tmpdir(), 'kun-workflow-nodes-'))
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (workflowWorkspaceRoot) {
    rmSync(workflowWorkspaceRoot, { recursive: true, force: true })
    workflowWorkspaceRoot = ''
  }
})

// ===========================================================================
// Triggers
// ===========================================================================

describe('manual-trigger', () => {
  it('emits the run payload and lets the chain proceed', async () => {
    cover('manual-trigger')
    const store = createStore(
      buildSettings([
        wf({
          id: 'mt',
          nodes: [
            { id: 'm', type: 'manual-trigger', config: {} },
            { id: 'o', type: 'output', config: { mode: 'auto' } }
          ],
          connections: [{ id: 'e1', source: 'm', target: 'o' }]
        })
      ])
    )
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: defaultRuntimeRequest() as never, logError: vi.fn() })
    const run = await runToEnd(runtime, store, 'mt')
    expect(run.status).toBe('success')
    expect(run.nodeResults.find((r) => r.nodeId === 'm')?.message).toBe('Triggered')
    runtime.stop()
  }, 15_000)

  it('coerces typed inputs onto the initial payload', async () => {
    const store = createStore(
      buildSettings([
        wf({
          id: 'mt-in',
          name: 'Inputs',
          nodes: [
            {
              id: 'm',
              type: 'manual-trigger',
              config: { inputSchema: [FIELD({ key: 'n', label: 'N', type: 'number' })] }
            },
            { id: 'o', type: 'output', config: { mode: 'auto' } }
          ],
          connections: [{ id: 'e1', source: 'm', target: 'o' }]
        })
      ])
    )
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: defaultRuntimeRequest() as never, logError: vi.fn() })
    const result = await runtime.runWorkflowByRef('Inputs', { n: '5' })
    expect(result.ok).toBe(true)
    expect((JSON.parse(result.output) as { n: number }).n).toBe(5)
    runtime.stop()
  }, 15_000)
})

describe('schedule-trigger', () => {
  it('runs as a trigger and emits its payload', async () => {
    cover('schedule-trigger')
    const store = createStore(
      buildSettings([
        wf({
          id: 'st',
          nodes: [
            { id: 's', type: 'schedule-trigger', config: { schedule: { kind: 'interval', everyMinutes: 30 } } },
            { id: 'sf', type: 'set-fields', config: { fields: [{ key: 'ran', value: 'yes' }], keepIncoming: false } }
          ],
          connections: [{ id: 'e1', source: 's', target: 'sf' }]
        })
      ])
    )
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: defaultRuntimeRequest() as never, logError: vi.fn() })
    const run = await runToEnd(runtime, store, 'st')
    expect(run.status).toBe('success')
    expect(run.nodeResults.find((r) => r.nodeId === 's')?.message).toBe('Triggered')
    expect(parseOut(run.nodeResults.find((r) => r.nodeId === 'sf')!)).toEqual({ ran: 'yes' })
    runtime.stop()
  }, 15_000)

  it('computes the next fire time for every schedule kind', () => {
    const from = new Date('2026-06-19T08:00:00.000Z')
    const next = (schedule: Record<string, unknown>): string =>
      computeWorkflowNextRunAt(
        wf({ id: 'x', enabled: true, nodes: [{ id: 't', type: 'schedule-trigger', config: { schedule } }] }),
        from
      )
    expect(next({ kind: 'interval', everyMinutes: 30 })).toBe(new Date(from.getTime() + 30 * 60_000).toISOString())
    expect(next({ kind: 'cron', cron: '0 9 * * *' })).not.toBe('')
    expect(Number.isFinite(Date.parse(next({ kind: 'daily', timeOfDay: '09:00' })))).toBe(true)
    // 'manual' schedule never auto-fires.
    expect(workflowHasScheduleTrigger(wf({ id: 'm', nodes: [{ id: 't', type: 'schedule-trigger', config: { schedule: { kind: 'manual' } } }] }))).toBe(false)
  })
})

describe('webhook-trigger', () => {
  it('runs as a trigger node and emits its payload to the chain', async () => {
    cover('webhook-trigger')
    // runWorkflow selects the webhook trigger as a fallback, exercising the node's
    // execute path without binding a TCP port (the live server is covered in run.test).
    const store = createStore(
      buildSettings([
        wf({
          id: 'wh',
          nodes: [
            { id: 'w', type: 'webhook-trigger', config: { path: '/hook', method: 'POST' } },
            { id: 'sf', type: 'set-fields', config: { fields: [{ key: 'hit', value: '1' }], keepIncoming: false } }
          ],
          connections: [{ id: 'e1', source: 'w', target: 'sf' }]
        })
      ])
    )
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: defaultRuntimeRequest() as never, logError: vi.fn() })
    const run = await runToEnd(runtime, store, 'wh')
    expect(run.status).toBe('success')
    expect(run.nodeResults.find((r) => r.nodeId === 'w')?.message).toBe('Triggered')
    runtime.stop()
  }, 15_000)
})

// ===========================================================================
// AI nodes
// ===========================================================================

describe('ai-agent', () => {
  it('runs the prompt through the kun runtime and returns the reply', async () => {
    cover('ai-agent')
    const result = await testNode(
      { id: 'a', type: 'ai-agent', config: { prompt: 'say hi', model: 'test-model' } },
      '{}',
      { runtimeRequest: aiRuntimeRequest('HELLO WORLD') }
    )
    expect(result.status).toBe('success')
    expect((parseOut(result) as { text: string }).text).toBe('HELLO WORLD')
    expect(result.threadId).toBe('thread-1')
  }, 15_000)

  it('interpolates {{ }} from the upstream payload into the prompt', async () => {
    const rr = aiRuntimeRequest('ok')
    await testNode(
      { id: 'a', type: 'ai-agent', config: { prompt: 'echo {{json.name}}', model: 'test-model' } },
      '{"name":"Kun"}',
      { runtimeRequest: rr }
    )
    // The template wins verbatim — the raw input is NOT also appended.
    expect(turnPrompt(rr)).toBe('echo Kun')
  }, 15_000)

  it('appends the upstream input to the prompt when it uses no {{ }}', async () => {
    const rr = aiRuntimeRequest('ok')
    await testNode(
      { id: 'a', type: 'ai-agent', config: { prompt: 'say hi', model: 'test-model' } },
      '{"name":"Kun"}',
      { runtimeRequest: rr }
    )
    const prompt = turnPrompt(rr)
    expect(prompt).toContain('say hi')
    expect(prompt).toContain('Kun')
  }, 15_000)

  it('leaves the prompt alone when there is no meaningful upstream input', async () => {
    const rr = aiRuntimeRequest('ok')
    await testNode({ id: 'a', type: 'ai-agent', config: { prompt: 'say hi', model: 'test-model' } }, '{}', {
      runtimeRequest: rr
    })
    expect(turnPrompt(rr)).toBe('say hi')
  }, 15_000)

  it('passes the working directory in as a run parameter ({{json.dir}})', async () => {
    const rr = aiRuntimeRequest('ok')
    const customWorkspaceRoot = mkdtempSync(join(workflowWorkspaceRoot, 'custom-'))
    const store = createStore(
      buildSettings([
        wf({
          id: 'ws',
          name: 'WS',
          nodes: [
            {
              id: 'm',
              type: 'manual-trigger',
              config: { workspaceRoot: '{{json.dir}}', inputSchema: [FIELD({ key: 'dir', label: 'Dir' })] }
            },
            { id: 'a', type: 'ai-agent', config: { prompt: 'hi', model: 'test-model' } }
          ],
          connections: [{ id: 'e1', source: 'm', target: 'a' }]
        })
      ])
    )
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: rr as never, logError: vi.fn() })
    try {
      const result = await runtime.runWorkflowByRef('WS', { dir: customWorkspaceRoot })
      expect(result.ok).toBe(true)
      expect(threadWorkspace(rr)).toBe(customWorkspaceRoot)
    } finally {
      runtime.stop()
    }
  }, 15_000)

  it('fails the node when the runtime errors', async () => {
    const rr = vi.fn(async (_s: AppSettingsV1, path: string) =>
      path === '/v1/threads' ? { ok: false, status: 500, body: JSON.stringify({ message: 'boom' }) } : okEmpty
    )
    const result = await testNode({ id: 'a', type: 'ai-agent', config: { prompt: 'x', model: 'test-model' } }, '{}', {
      runtimeRequest: rr
    })
    expect(result.status).toBe('error')
    expect(result.error).toContain('boom')
  }, 15_000)
})

describe('generate-image', () => {
  it('generates an image and writes it to the output folder', async () => {
    cover('generate-image')
    imageGenerateMock.mockClear()
    const dir = mkdtempSync(join(tmpdir(), 'wf-img-'))
    try {
      const result = await testNode(
        { id: 'g', type: 'generate-image', config: { prompt: 'a cat', outputDir: dir } },
        '{}',
        {
          patch: (s) => ({
            ...s,
            agents: {
              kun: {
                ...s.agents.kun,
                imageGeneration: {
                  ...s.agents.kun.imageGeneration,
                  enabled: true,
                  providerId: '',
                  baseUrl: 'https://img.test/v1',
                  apiKey: 'sk-img',
                  model: 'img-model',
                  defaultResolution: '2K'
                }
              }
            }
          })
        }
      )
      expect(result.status).toBe('success')
      const out = parseOut(result) as { imagePath: string; mimeType: string }
      expect(out.mimeType).toBe('image/png')
      expect(out.imagePath.endsWith('.png')).toBe(true)
      expect(existsSync(out.imagePath)).toBe(true)
      expect(imageGenerateMock).toHaveBeenCalledWith(expect.objectContaining({ size: '2048x2048' }))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 15_000)

  it('errors when image generation is not configured', async () => {
    const result = await testNode({ id: 'g', type: 'generate-image', config: { prompt: 'a cat' } }, '{}')
    expect(result.status).toBe('error')
    expect(result.error.toLowerCase()).toContain('not configured')
  }, 15_000)
})

describe('parameter-extractor', () => {
  it('extracts typed fields from text using the model reply', async () => {
    cover('parameter-extractor')
    const result = await testNode(
      {
        id: 'pe',
        type: 'parameter-extractor',
        config: {
          source: '{{text}}',
          fields: [FIELD({ key: 'city', label: 'City', type: 'text' }), FIELD({ key: 'temp', label: 'Temp', type: 'number' })],
          model: 'test-model'
        }
      },
      'It is 12 degrees in Paris.',
      { runtimeRequest: aiRuntimeRequest('```json\n{"city":"Paris","temp":"12"}\n```') }
    )
    expect(result.status).toBe('success')
    expect(parseOut(result)).toEqual({ city: 'Paris', temp: 12 })
  }, 15_000)

  it('fails the node when the model run errors', async () => {
    const rr = vi.fn(async (_s: AppSettingsV1, path: string) =>
      path === '/v1/threads' ? { ok: false, status: 500, body: JSON.stringify({ message: 'down' }) } : okEmpty
    )
    const result = await testNode(
      {
        id: 'pe',
        type: 'parameter-extractor',
        config: { source: '{{text}}', fields: [FIELD({ key: 'city', label: 'City' })], model: 'test-model' }
      },
      'Paris',
      { runtimeRequest: rr }
    )
    expect(result.status).toBe('error')
    expect(result.error).toContain('down')
  }, 15_000)
})

describe('question-classifier', () => {
  it('routes to the category the model picks by number', async () => {
    cover('question-classifier')
    const result = await testNode(
      {
        id: 'qc',
        type: 'question-classifier',
        config: {
          source: '{{text}}',
          categories: [
            { id: 'cat-feature', label: 'Feature' },
            { id: 'cat-bug', label: 'Bug' }
          ],
          model: 'test-model'
        }
      },
      'the app crashes on launch',
      { runtimeRequest: aiRuntimeRequest('2') }
    )
    expect(result.status).toBe('success')
    expect(result.message).toBe('→ Bug')
  }, 15_000)

  it('defaults to the first category when the reply is out of range', async () => {
    const result = await testNode(
      {
        id: 'qc',
        type: 'question-classifier',
        config: {
          source: '{{text}}',
          categories: [
            { id: 'cat-feature', label: 'Feature' },
            { id: 'cat-bug', label: 'Bug' }
          ],
          model: 'test-model'
        }
      },
      'anything',
      { runtimeRequest: aiRuntimeRequest('9') }
    )
    expect(result.message).toBe('→ Feature')
  }, 15_000)

  it('short-circuits with no model call when there are no categories', async () => {
    const rr = aiRuntimeRequest('1')
    const result = await testNode(
      { id: 'qc', type: 'question-classifier', config: { source: '{{text}}', categories: [], model: 'test-model' } },
      'anything',
      { runtimeRequest: rr }
    )
    expect(result.message).toBe('no categories')
    expect(rr).not.toHaveBeenCalled()
  }, 15_000)
})

// ===========================================================================
// Branching / logic
// ===========================================================================

describe('condition', () => {
  it('reports true/false for the chosen branch', async () => {
    cover('condition')
    const hit = await testNode(
      { id: 'c', type: 'condition', config: { leftExpr: 'json.v', operator: 'contains', rightValue: 'ell' } },
      '{"v":"hello"}'
    )
    expect(hit.message).toBe('true')
    const miss = await testNode(
      { id: 'c', type: 'condition', config: { leftExpr: 'json.v', operator: 'contains', rightValue: 'zzz' } },
      '{"v":"hello"}'
    )
    expect(miss.message).toBe('false')
  }, 15_000)

  it('evaluates every operator correctly', async () => {
    const cases: { op: string; left: unknown; right: string; expect: boolean }[] = [
      { op: 'equals', left: 'a', right: 'a', expect: true },
      { op: 'notEquals', left: 'a', right: 'b', expect: true },
      { op: 'startsWith', left: 'hello', right: 'he', expect: true },
      { op: 'endsWith', left: 'hello', right: 'lo', expect: true },
      { op: 'notContains', left: 'hello', right: 'zz', expect: true },
      { op: 'isEmpty', left: '', right: '', expect: true },
      { op: 'isNotEmpty', left: 'x', right: '', expect: true },
      { op: 'gt', left: 5, right: '3', expect: true },
      { op: 'gte', left: 3, right: '3', expect: true },
      { op: 'lt', left: 2, right: '3', expect: true },
      { op: 'lte', left: 3, right: '3', expect: true }
    ]
    for (const c of cases) {
      const result = await testNode(
        { id: 'c', type: 'condition', config: { leftExpr: 'json.v', operator: c.op, rightValue: c.right } },
        JSON.stringify({ v: c.left })
      )
      expect(`${c.op}=${result.message}`).toBe(`${c.op}=${c.expect ? 'true' : 'false'}`)
    }
  }, 30_000)

  it('honors caseSensitive and falls back to payload.text when leftExpr is empty', async () => {
    // Empty leftExpr → compares against payload.text (here the raw mock string).
    const insensitive = await testNode(
      { id: 'c', type: 'condition', config: { leftExpr: '', operator: 'equals', rightValue: 'hello', caseSensitive: false } },
      'HELLO'
    )
    expect(insensitive.message).toBe('true')
    const sensitive = await testNode(
      { id: 'c', type: 'condition', config: { leftExpr: '', operator: 'equals', rightValue: 'hello', caseSensitive: true } },
      'HELLO'
    )
    expect(sensitive.message).toBe('false')
  }, 15_000)
})
