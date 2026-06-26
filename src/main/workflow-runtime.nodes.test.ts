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
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WORKFLOW_NODE_KINDS,
  defaultClawSettings,
  defaultDesignSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWriteSettings,
  defaultTerminalSettings,
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

// The generate-image node lazily imports the kun image client. Replace it with a
// stub so the test never hits a real provider (and never pulls native deps in).
vi.mock('../../kun/src/adapters/tool/image-gen-tool-provider.js', () => ({
  createImageGenClient: () => ({
    generate: async () => ({ data: Buffer.from('PNG-BYTES'), mimeType: 'image/png' })
  })
}))

const NOW = '2026-06-19T00:00:00.000Z'
const PYTHON_OK = spawnSync('python3', ['-c', 'pass']).status === 0

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
    provider: defaultModelProviderSettings(),
    agents: { kun: { ...defaultKunRuntimeSettings(), model: 'test-model', apiKey: 'test-key' } },
    workspaceRoot: '/tmp/workflow-workspace',
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: { enabled: true, retentionDays: 7 },
    checkpointCleanup: { enabled: false, intervalDays: 3 },
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

afterEach(() => {
  vi.unstubAllGlobals()
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
      const result = await runtime.runWorkflowByRef('WS', { dir: '/tmp/custom-dir' })
      expect(result.ok).toBe(true)
      expect(threadWorkspace(rr)).toBe('/tmp/custom-dir')
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
                  model: 'img-model'
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

describe('switch', () => {
  it('matches the first satisfied rule', async () => {
    cover('switch')
    const result = await testNode(
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
      '{"v":"B"}'
    )
    expect(result.message).toBe('case 2')
  }, 15_000)

  it('falls back when nothing matches and a fallback is enabled', async () => {
    const result = await testNode(
      {
        id: 'sw',
        type: 'switch',
        config: { rules: [{ leftExpr: 'json.v', operator: 'equals', rightValue: 'A', caseSensitive: false }], fallback: true }
      },
      '{"v":"Z"}'
    )
    expect(result.message).toBe('fallback')
  }, 15_000)

  it('reports no match when nothing matches and there is no fallback', async () => {
    const result = await testNode(
      {
        id: 'sw',
        type: 'switch',
        config: { rules: [{ leftExpr: 'json.v', operator: 'equals', rightValue: 'A', caseSensitive: false }], fallback: false }
      },
      '{"v":"Z"}'
    )
    expect(result.message).toBe('no match')
  }, 15_000)

  it('respects caseSensitive when matching a rule', async () => {
    const rule = (caseSensitive: boolean): NodeSpec => ({
      id: 'sw',
      type: 'switch',
      config: { rules: [{ leftExpr: 'json.v', operator: 'equals', rightValue: 'B', caseSensitive }], fallback: false }
    })
    expect((await testNode(rule(false), '{"v":"b"}')).message).toBe('case 1')
    expect((await testNode(rule(true), '{"v":"b"}')).message).toBe('no match')
  }, 15_000)
})

describe('filter', () => {
  it('passes or blocks based on the condition', async () => {
    cover('filter')
    const pass = await testNode(
      { id: 'f', type: 'filter', config: { leftExpr: 'json.v', operator: 'equals', rightValue: 'B' } },
      '{"v":"B"}'
    )
    expect(pass.message).toBe('pass')
    const blocked = await testNode(
      { id: 'f', type: 'filter', config: { leftExpr: 'json.v', operator: 'equals', rightValue: 'C' } },
      '{"v":"B"}'
    )
    expect(blocked.message).toBe('blocked')
  }, 15_000)
})

describe('human-approval', () => {
  it('auto-approves in single-node test mode', async () => {
    cover('human-approval')
    const result = await testNode(
      { id: 'h', type: 'human-approval', config: { title: 'Confirm', instruction: 'ok?', timeoutMs: 0, onTimeout: 'rejected' } },
      '{"x":1}'
    )
    expect(result.status).toBe('success')
    expect(result.message).toBe('approved (test)')
  }, 15_000)

  it('routes to the rejected branch when the approval times out', async () => {
    const store = createStore(
      buildSettings([
        wf({
          id: 'ha',
          nodes: [
            { id: 'm', type: 'manual-trigger', config: {} },
            { id: 'a', type: 'human-approval', config: { title: 'x', instruction: '', timeoutMs: 50, onTimeout: 'rejected' } },
            { id: 'yes', type: 'set-fields', config: { fields: [{ key: 'p', value: 'approved' }], keepIncoming: false } },
            { id: 'no', type: 'set-fields', config: { fields: [{ key: 'p', value: 'rejected' }], keepIncoming: false } }
          ],
          connections: [
            { id: 'e1', source: 'm', target: 'a' },
            { id: 'e2', source: 'a', sourceHandle: 'approved', target: 'yes' },
            { id: 'e3', source: 'a', sourceHandle: 'rejected', target: 'no' }
          ]
        })
      ])
    )
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: defaultRuntimeRequest() as never, logError: vi.fn() })
    const run = await runToEnd(runtime, store, 'ha')
    expect(run.status).toBe('success')
    expect(run.nodeResults.find((r) => r.nodeId === 'no')?.status).toBe('success')
    expect(run.nodeResults.find((r) => r.nodeId === 'yes')).toBeUndefined()
    runtime.stop()
  }, 15_000)

  it('pauses, then routes to the approved branch injecting _approved on a real decision', async () => {
    const store = createStore(
      buildSettings([
        wf({
          id: 'ha-ok',
          nodes: [
            { id: 'm', type: 'manual-trigger', config: {} },
            { id: 'a', type: 'human-approval', config: { title: 'Confirm', instruction: 'ship it?', timeoutMs: 0, onTimeout: 'rejected' } },
            { id: 'out', type: 'output', config: { mode: 'auto' } }
          ],
          connections: [
            { id: 'e1', source: 'm', target: 'a' },
            { id: 'e2', source: 'a', sourceHandle: 'approved', target: 'out' }
          ]
        })
      ])
    )
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: defaultRuntimeRequest() as never, logError: vi.fn() })
    const started = await runtime.runWorkflow('ha-ok')
    if (!started.ok || !started.runId) throw new Error(`runWorkflow failed: ${started.message}`)
    const runId = started.runId
    // The node pauses until a decision arrives; it surfaces via status().
    await waitFor(async () => (await runtime.status()).pendingApprovals.length > 0, 10_000)
    const pending = (await runtime.status()).pendingApprovals[0]
    expect(pending.title).toBe('Confirm')
    expect(runtime.resolveApproval(pending.token, 'approved')).toBe(true)
    await waitFor(async () => {
      const run = store.read().workflow.workflows[0].runs.find((e) => e.id === runId)
      return Boolean(run && run.status !== 'running')
    }, 10_000)
    const run = store.read().workflow.workflows[0].runs.find((e) => e.id === runId)!
    expect(run.status).toBe('success')
    // The approved payload carries _approved: true into the downstream node.
    const out = run.nodeResults.find((r) => r.nodeId === 'out')!
    expect(JSON.parse(out.outputJson)).toEqual({ _approved: true })
    runtime.stop()
  }, 20_000)
})

// ===========================================================================
// Data shaping
// ===========================================================================

describe('set-fields', () => {
  it('replaces the payload and interpolates field values (payload scope)', async () => {
    cover('set-fields')
    const result = await testNode(
      {
        id: 's',
        type: 'set-fields',
        config: { fields: [{ key: 'greeting', value: 'hi {{json.name}}' }, { key: 'fixed', value: 'x' }], keepIncoming: false }
      },
      '{"name":"World"}'
    )
    expect(parseOut(result)).toEqual({ greeting: 'hi World', fixed: 'x' })
  }, 15_000)

  it('keeps the incoming fields when keepIncoming is set', async () => {
    const result = await testNode(
      { id: 's', type: 'set-fields', config: { fields: [{ key: 'b', value: '2' }], keepIncoming: true } },
      '{"a":"1"}'
    )
    expect(parseOut(result)).toEqual({ a: '1', b: '2' })
  }, 15_000)

  it('writes run-scoped vars and passes the payload through (run scope)', async () => {
    const result = await testNode(
      { id: 's', type: 'set-fields', config: { scope: 'run', fields: [{ key: 'token', value: 'abc' }] } },
      '{"keep":"me"}'
    )
    expect(result.message).toContain('run var')
    expect(parseOut(result)).toEqual({ keep: 'me' })
  }, 15_000)

  it('exposes a run-scoped var to a downstream node as {{$run.key}}', async () => {
    const store = createStore(
      buildSettings([
        wf({
          id: 'rv',
          nodes: [
            { id: 'm', type: 'manual-trigger', config: {} },
            { id: 's', type: 'set-fields', config: { scope: 'run', fields: [{ key: 'token', value: 'abc' }] } },
            { id: 't', type: 'template', config: { template: 'tok={{$run.token}}', outputMode: 'text' } }
          ],
          connections: [
            { id: 'e1', source: 'm', target: 's' },
            { id: 'e2', source: 's', target: 't' }
          ]
        })
      ])
    )
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: defaultRuntimeRequest() as never, logError: vi.fn() })
    const run = await runToEnd(runtime, store, 'rv')
    expect(run.status).toBe('success')
    const tpl = run.nodeResults.find((r) => r.nodeId === 't')!
    expect((JSON.parse(tpl.outputJson) as { text: string }).text).toBe('tok=abc')
    runtime.stop()
  }, 15_000)
})

describe('code', () => {
  it('evaluates JavaScript against the payload', async () => {
    cover('code')
    const result = await testNode(
      { id: 'c', type: 'code', config: { code: 'return { doubled: Number($json.n) * 2 }' } },
      '{"n":5}'
    )
    expect(parseOut(result)).toEqual({ doubled: 10 })
  }, 15_000)

  it('errors (and times out) on an infinite loop', async () => {
    const result = await testNode({ id: 'c', type: 'code', config: { code: 'while (true) {}' } }, '{}')
    expect(result.status).toBe('error')
    expect(result.error.toLowerCase()).toContain('code')
  }, 15_000)

  it('runs a bash script with stdin/env input and parses stdout', async () => {
    const result = await testNode(
      { id: 'c', type: 'code', config: { language: 'bash', code: 'echo "{\\"lang\\": \\"bash\\", \\"got\\": $WORKFLOW_JSON}"' } },
      '{"n":"5"}'
    )
    expect(result.status).toBe('success')
    const out = parseOut(result) as { lang: string; got: { n: string } }
    expect(out.lang).toBe('bash')
    expect(out.got.n).toBe('5')
  }, 15_000)

  it('errors when a bash script exits non-zero', async () => {
    const result = await testNode({ id: 'c', type: 'code', config: { language: 'bash', code: 'echo oops >&2; exit 3' } }, '{}')
    expect(result.status).toBe('error')
    expect(result.error).toContain('exited with code 3')
  }, 15_000)

  it('wraps non-JSON bash stdout as { text }', async () => {
    const result = await testNode({ id: 'c', type: 'code', config: { language: 'bash', code: 'echo hello there' } }, '{}')
    expect(result.status).toBe('success')
    expect(parseOut(result)).toEqual({ text: 'hello there' })
  }, 15_000)

  it.runIf(PYTHON_OK)('runs a python script and parses its stdout', async () => {
    const result = await testNode(
      { id: 'c', type: 'code', config: { language: 'python', code: 'import json,os; print(json.dumps({"py": True, "n": json.loads(os.environ["WORKFLOW_JSON"])["n"]}))' } },
      '{"n":7}'
    )
    expect(result.status).toBe('success')
    expect(parseOut(result)).toEqual({ py: true, n: 7 })
  }, 15_000)
})

describe('sort', () => {
  it('orders an array by a numeric field ascending and descending', async () => {
    cover('sort')
    const asc = await testNode({ id: 'srt', type: 'sort', config: { field: 'v', order: 'asc', numeric: true } }, '[{"v":3},{"v":1},{"v":2}]')
    expect(parseOut(asc)).toEqual([{ v: 1 }, { v: 2 }, { v: 3 }])
    const desc = await testNode({ id: 'srt', type: 'sort', config: { field: 'v', order: 'desc', numeric: true } }, '[{"v":3},{"v":1},{"v":2}]')
    expect(parseOut(desc)).toEqual([{ v: 3 }, { v: 2 }, { v: 1 }])
  }, 15_000)

  it('sorts strings lexically when numeric is off', async () => {
    const result = await testNode({ id: 'srt', type: 'sort', config: { field: '', order: 'asc', numeric: false } }, '["banana","apple","cherry"]')
    expect(parseOut(result)).toEqual(['apple', 'banana', 'cherry'])
  }, 15_000)
})

describe('limit', () => {
  it('keeps the first N items', async () => {
    cover('limit')
    const result = await testNode({ id: 'lim', type: 'limit', config: { count: 2, from: 'first' } }, '[1,2,3,4,5]')
    expect(parseOut(result)).toEqual([1, 2])
  }, 15_000)

  it('keeps the last N items', async () => {
    const result = await testNode({ id: 'lim', type: 'limit', config: { count: 2, from: 'last' } }, '[1,2,3,4,5]')
    expect(parseOut(result)).toEqual([4, 5])
  }, 15_000)
})

describe('aggregate', () => {
  it('sums a field', async () => {
    cover('aggregate')
    const result = await testNode({ id: 'ag', type: 'aggregate', config: { mode: 'sum', field: 'price' } }, '[{"price":10},{"price":5},{"price":7}]')
    expect(parseOut(result)).toEqual({ sum: 22 })
  }, 15_000)

  it('counts items', async () => {
    const result = await testNode({ id: 'ag', type: 'aggregate', config: { mode: 'count' } }, '[1,2,3]')
    expect(parseOut(result)).toEqual({ count: 3 })
  }, 15_000)

  it('joins a field with a separator', async () => {
    const result = await testNode({ id: 'ag', type: 'aggregate', config: { mode: 'join', field: 'name', separator: ', ' } }, '[{"name":"a"},{"name":"b"}]')
    expect(parseOut(result)).toEqual({ text: 'a, b' })
  }, 15_000)

  it('collects a field into an array', async () => {
    const result = await testNode({ id: 'ag', type: 'aggregate', config: { mode: 'collect', field: 'id' } }, '[{"id":1},{"id":2}]')
    expect(parseOut(result)).toEqual({ values: [1, 2] })
  }, 15_000)
})

describe('merge', () => {
  it('merges inputs into one object (object mode)', async () => {
    cover('merge')
    const result = await testNode({ id: 'mg', type: 'merge', config: { mode: 'object' } }, '{"a":1,"b":2}')
    expect(parseOut(result)).toEqual({ a: 1, b: 2 })
  }, 15_000)

  it('collects inputs into an array (array mode)', async () => {
    const result = await testNode({ id: 'mg', type: 'merge', config: { mode: 'array' } }, '{"a":1}')
    expect(parseOut(result)).toEqual([{ a: 1 }])
  }, 15_000)

  // The single-input cases above only prove the node runs; merge's real job is
  // combining MULTIPLE upstream inputs, which needs a real two-branch graph.
  const twoBranchMerge = (id: string, mode: 'object' | 'array'): WorkflowV1 =>
    wf({
      id,
      nodes: [
        { id: 'm', type: 'manual-trigger', config: {} },
        { id: 'a', type: 'set-fields', config: { fields: [{ key: 'x', value: '1' }], keepIncoming: false } },
        { id: 'b', type: 'set-fields', config: { fields: [{ key: 'y', value: '2' }], keepIncoming: false } },
        { id: 'mg', type: 'merge', config: { mode } }
      ],
      connections: [
        { id: 'e1', source: 'm', target: 'a' },
        { id: 'e2', source: 'm', target: 'b' },
        { id: 'e3', source: 'a', target: 'mg' },
        { id: 'e4', source: 'b', target: 'mg' }
      ]
    })

  it('accumulates two branches into one object (object mode, multi-input)', async () => {
    const store = createStore(buildSettings([twoBranchMerge('mg-obj', 'object')]))
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: defaultRuntimeRequest() as never, logError: vi.fn() })
    const run = await runToEnd(runtime, store, 'mg-obj')
    expect(run.status).toBe('success')
    const merge = run.nodeResults.find((r) => r.nodeId === 'mg')!
    expect(JSON.parse(merge.outputJson)).toEqual({ x: '1', y: '2' })
    expect(merge.message).toBe('merged 2')
    runtime.stop()
  }, 15_000)

  it('collects two branches into an array (array mode, multi-input)', async () => {
    const store = createStore(buildSettings([twoBranchMerge('mg-arr', 'array')]))
    const runtime = createWorkflowRuntime({ store: store as never, runtimeRequest: defaultRuntimeRequest() as never, logError: vi.fn() })
    const run = await runToEnd(runtime, store, 'mg-arr')
    expect(run.status).toBe('success')
    const merge = run.nodeResults.find((r) => r.nodeId === 'mg')!
    const out = JSON.parse(merge.outputJson) as unknown[]
    expect(out).toHaveLength(2)
    expect(out).toEqual(expect.arrayContaining([{ x: '1' }, { y: '2' }]))
    expect(merge.message).toBe('merged 2')
    runtime.stop()
  }, 15_000)
})

describe('template', () => {
  it('renders a text template from the payload', async () => {
    cover('template')
    const result = await testNode({ id: 't', type: 'template', config: { template: 'Hello {{json.name}}!', outputMode: 'text' } }, '{"name":"World"}')
    expect((parseOut(result) as { text: string }).text).toBe('Hello World!')
  }, 15_000)

  it('parses a rendered JSON template (json mode)', async () => {
    const result = await testNode({ id: 't', type: 'template', config: { template: '{"x": {{json.n}}}', outputMode: 'json' } }, '{"n":5}')
    expect(parseOut(result)).toEqual({ x: 5 })
    expect(result.message).toBe('formatted')
  }, 15_000)

  it('falls back to text when a json template is not valid JSON', async () => {
    const result = await testNode({ id: 't', type: 'template', config: { template: 'not json {{json.n}}', outputMode: 'json' } }, '{"n":5}')
    expect((parseOut(result) as { text: string }).text).toBe('not json 5')
    expect(result.message).toContain('text fallback')
  }, 15_000)
})

describe('json', () => {
  it('parses the text payload into structured JSON', async () => {
    cover('json')
    const result = await testNode({ id: 'j', type: 'json', config: { mode: 'parse', strict: false } }, '{"a":1,"b":"x"}')
    expect(parseOut(result)).toEqual({ a: 1, b: 'x' })
  }, 15_000)

  it('stringifies the json payload to text', async () => {
    const result = await testNode({ id: 'j', type: 'json', config: { mode: 'stringify' } }, '{"a":1}')
    expect((parseOut(result) as { text: string }).text).toBe('{"a":1}')
  }, 15_000)

  it('errors on invalid JSON in strict mode', async () => {
    const result = await testNode({ id: 'j', type: 'json', config: { mode: 'parse', strict: true } }, 'definitely not json')
    expect(result.status).toBe('error')
    expect(result.error).toContain('JSON parse failed')
  }, 15_000)

  it('falls back to wrapping the text when parse is non-strict', async () => {
    const result = await testNode({ id: 'j', type: 'json', config: { mode: 'parse', strict: false } }, 'plain text')
    expect(parseOut(result)).toEqual({ text: 'plain text' })
    expect(result.message).toContain('fallback')
  }, 15_000)
})

describe('output', () => {
  it('passes the payload through (auto mode)', async () => {
    cover('output')
    const result = await testNode({ id: 'o', type: 'output', config: { mode: 'auto' } }, '{"a":1}')
    expect(parseOut(result)).toEqual({ a: 1 })
  }, 15_000)

  it('renders a text template (text mode)', async () => {
    const result = await testNode({ id: 'o', type: 'output', config: { mode: 'text', textTemplate: 'value={{json.a}}' } }, '{"a":42}')
    expect((parseOut(result) as { text: string }).text).toBe('value=42')
  }, 15_000)

  it('drills into a json path (json mode)', async () => {
    const result = await testNode({ id: 'o', type: 'output', config: { mode: 'json', jsonPath: 'user.name' } }, '{"user":{"name":"Kun"}}')
    expect(parseOut(result)).toBe('Kun')
  }, 15_000)

  it('coerces a missing json path to null (json mode)', async () => {
    const result = await testNode({ id: 'o', type: 'output', config: { mode: 'json', jsonPath: 'user.missing.deep' } }, '{"user":{"name":"Kun"}}')
    expect(result.status).toBe('success')
    // The node coerces the missing value to null; safeJson(null) serializes to ''.
    expect(result.outputJson).toBe('')
  }, 15_000)
})

describe('http-request', () => {
  it('performs the request and parses the JSON response', async () => {
    cover('http-request')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"value":42}', { status: 200, statusText: 'OK' })))
    const result = await testNode({ id: 'h', type: 'http-request', config: { method: 'GET', url: 'https://example.com/data', parseJson: true } }, '{}')
    expect(result.status).toBe('success')
    expect(parseOut(result)).toEqual({ value: 42 })
    expect(result.message).toContain('200')
  }, 15_000)

  it('keeps the raw body when parseJson is off', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('plain', { status: 200, statusText: 'OK' })))
    const result = await testNode({ id: 'h', type: 'http-request', config: { method: 'GET', url: 'https://example.com', parseJson: false } }, '{}')
    expect(parseOut(result)).toEqual({ status: 200, body: 'plain' })
  }, 15_000)

  it('errors on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500, statusText: 'Server Error' })))
    const result = await testNode({ id: 'h', type: 'http-request', config: { method: 'GET', url: 'https://example.com' } }, '{}')
    expect(result.status).toBe('error')
    expect(result.error).toContain('500')
  }, 15_000)

  it('rejects a non-http(s) URL', async () => {
    const result = await testNode({ id: 'h', type: 'http-request', config: { method: 'GET', url: 'file:///etc/passwd' } }, '{}')
    expect(result.status).toBe('error')
    expect(result.error.toLowerCase()).toContain('http')
  }, 15_000)

  it('interpolates the URL, headers, and body for a POST request', async () => {
    const captured: { url?: string; init?: { headers?: Record<string, string>; body?: string } } = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { headers?: Record<string, string>; body?: string }) => {
        captured.url = url
        captured.init = init
        return new Response('{"ok":true}', { status: 200, statusText: 'OK' })
      })
    )
    const result = await testNode(
      {
        id: 'h',
        type: 'http-request',
        config: {
          method: 'POST',
          url: 'https://example.com/items/{{json.id}}',
          headers: [{ key: 'X-Token', value: '{{json.tok}}' }],
          body: '{"echo":"{{json.id}}"}',
          parseJson: true
        }
      },
      '{"id":"42","tok":"sekret"}'
    )
    expect(result.status).toBe('success')
    expect(captured.url).toBe('https://example.com/items/42')
    expect(captured.init?.headers?.['X-Token']).toBe('sekret')
    expect(JSON.parse(captured.init?.body ?? '{}')).toEqual({ echo: '42' })
  }, 15_000)

  it('errors when the request exceeds its timeout', async () => {
    // fetch never resolves; it rejects only when the runtime's AbortController fires.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => {
              const error = new Error('aborted')
              error.name = 'AbortError'
              reject(error)
            })
          })
      )
    )
    const result = await testNode(
      { id: 'h', type: 'http-request', config: { method: 'GET', url: 'https://example.com/slow', timeoutMs: 1000 } },
      '{}'
    )
    expect(result.status).toBe('error')
    expect(result.error.toLowerCase()).toContain('timed out')
  }, 15_000)
})

describe('delay', () => {
  it('waits and passes the payload through', async () => {
    cover('delay')
    const result = await testNode({ id: 'd', type: 'delay', config: { delayMs: 5 } }, '{"a":1}')
    expect(result.status).toBe('success')
    expect(result.message).toBe('Waited 5ms')
    expect(parseOut(result)).toEqual({ a: 1 })
  }, 15_000)
})

// ===========================================================================
// Composition: subworkflow / loop / custom
// ===========================================================================

describe('subworkflow', () => {
  it('runs another workflow and returns its output', async () => {
    cover('subworkflow')
    const child = wf({
      id: 'child',
      name: 'Child',
      nodes: [
        { id: 'cm', type: 'manual-trigger', config: {} },
        { id: 'cs', type: 'set-fields', config: { fields: [{ key: 'childOut', value: 'yes' }], keepIncoming: false } }
      ],
      connections: [{ id: 'ce1', source: 'cm', target: 'cs' }]
    })
    const result = await testNode({ id: 'sub', type: 'subworkflow', config: { workflowId: 'child' } }, '{}', {
      extraWorkflows: [child]
    })
    expect(result.status).toBe('success')
    expect(parseOut(result)).toEqual({ childOut: 'yes' })
  }, 15_000)

  it('errors when the target workflow is missing', async () => {
    const result = await testNode({ id: 'sub', type: 'subworkflow', config: { workflowId: 'nope' } }, '{}')
    expect(result.status).toBe('error')
    expect(result.error.toLowerCase()).toContain('not found')
  }, 15_000)
})

describe('loop', () => {
  const incBody = (): WorkflowV1 =>
    wf({
      id: 'body',
      name: 'Body',
      nodes: [
        { id: 'bm', type: 'manual-trigger', config: {} },
        { id: 'bc', type: 'code', config: { code: 'return { n: (Number($json.n) || 0) + 1 }' } }
      ],
      connections: [{ id: 'be1', source: 'bm', target: 'bc' }]
    })

  it('loops the body until the stop condition holds (condition mode)', async () => {
    cover('loop')
    const result = await testNode(
      {
        id: 'lp',
        type: 'loop',
        config: { workflowId: 'body', maxIterations: 10, leftExpr: 'json.n', operator: 'gte', rightValue: '3' }
      },
      '{"n":0}',
      { extraWorkflows: [incBody()] }
    )
    expect(result.status).toBe('success')
    const out = parseOut(result) as { n: number; _iterations: number; _done: boolean }
    expect(out.n).toBe(3)
    expect(out._iterations).toBe(3)
    expect(out._done).toBe(true)
  }, 15_000)

  it('maps each array item through the body (foreach, sequential)', async () => {
    const body = wf({
      id: 'fe-body',
      name: 'FeBody',
      nodes: [
        { id: 'bm', type: 'manual-trigger', config: {} },
        { id: 'bs', type: 'set-fields', config: { fields: [{ key: 'out', value: '{{$loop.item}}!' }], keepIncoming: false } }
      ],
      connections: [{ id: 'be1', source: 'bm', target: 'bs' }]
    })
    const result = await testNode(
      { id: 'lp', type: 'loop', config: { workflowId: 'fe-body', mode: 'foreach', execution: 'sequential', maxIterations: 10 } },
      '["a","b","c"]',
      { extraWorkflows: [body] }
    )
    expect(result.status).toBe('success')
    expect(parseOut(result)).toEqual([{ out: 'a!' }, { out: 'b!' }, { out: 'c!' }])
  }, 15_000)

  it('maps array items in parallel and preserves order (foreach, parallel)', async () => {
    const body = wf({
      id: 'fe-par',
      name: 'FePar',
      nodes: [
        { id: 'bm', type: 'manual-trigger', config: {} },
        { id: 'bs', type: 'set-fields', config: { fields: [{ key: 'out', value: '{{$loop.item}}-{{$loop.index}}' }], keepIncoming: false } }
      ],
      connections: [{ id: 'be1', source: 'bm', target: 'bs' }]
    })
    const result = await testNode(
      {
        id: 'lp',
        type: 'loop',
        config: { workflowId: 'fe-par', mode: 'foreach', execution: 'parallel', concurrency: 3, maxIterations: 10 }
      },
      '["a","b","c"]',
      { extraWorkflows: [body] }
    )
    expect(result.status).toBe('success')
    // Order must be preserved even though iterations ran concurrently.
    expect(parseOut(result)).toEqual([{ out: 'a-0' }, { out: 'b-1' }, { out: 'c-2' }])
    expect(result.message).toContain('(parallel)')
  }, 15_000)

  it('aborts the run when a foreach item fails without continueOnError', async () => {
    const body = wf({
      id: 'fe-failfast',
      name: 'FeFailFast',
      nodes: [
        { id: 'bm', type: 'manual-trigger', config: {} },
        { id: 'bc', type: 'code', config: { code: "if ($json === 'bad') throw new Error('boom'); return { ok: $json }" } }
      ],
      connections: [{ id: 'be1', source: 'bm', target: 'bc' }]
    })
    const result = await testNode(
      { id: 'lp', type: 'loop', config: { workflowId: 'fe-failfast', mode: 'foreach', execution: 'sequential', maxIterations: 10 } },
      '["a","bad","c"]',
      { extraWorkflows: [body] }
    )
    expect(result.status).toBe('error')
    expect(result.error).toContain('boom')
  }, 15_000)

  it('stops at maxIterations when the condition never holds (_done false)', async () => {
    const result = await testNode(
      {
        id: 'lp',
        type: 'loop',
        config: { workflowId: 'body', maxIterations: 3, leftExpr: 'json.n', operator: 'gte', rightValue: '999' }
      },
      '{"n":0}',
      { extraWorkflows: [incBody()] }
    )
    expect(result.status).toBe('success')
    const out = parseOut(result) as { n: number; _iterations: number; _done: boolean }
    expect(out._iterations).toBe(3)
    expect(out._done).toBe(false)
    expect(result.message).toBe('looped 3 (max)')
  }, 15_000)

  it('collects per-item errors when continueOnError is set (foreach)', async () => {
    const body = wf({
      id: 'fe-err',
      name: 'FeErr',
      nodes: [
        { id: 'bm', type: 'manual-trigger', config: {} },
        { id: 'bc', type: 'code', config: { code: "if ($json === 'bad') throw new Error('boom'); return { ok: $json }" } }
      ],
      connections: [{ id: 'be1', source: 'bm', target: 'bc' }]
    })
    const result = await testNode(
      {
        id: 'lp',
        type: 'loop',
        config: { workflowId: 'fe-err', mode: 'foreach', execution: 'sequential', continueOnError: true, maxIterations: 10 }
      },
      '["a","bad","c"]',
      { extraWorkflows: [body] }
    )
    expect(result.status).toBe('success')
    const out = parseOut(result) as { ok?: string; error?: string }[]
    expect(out[0]).toEqual({ ok: 'a' })
    expect(out[1].error).toContain('boom')
    expect(out[2]).toEqual({ ok: 'c' })
    expect(result.message).toContain('2/3')
  }, 15_000)
})

describe('custom', () => {
  it('runs a custom module with its injected $fields', async () => {
    cover('custom')
    const module: WorkflowCustomModuleV1 = {
      id: 'mod-greet',
      name: 'Greet',
      description: '',
      icon: '',
      language: 'javascript',
      fields: [{ key: 'who', label: 'Who', type: 'text', defaultValue: 'world', options: [], placeholder: '' }],
      code: 'return { greeting: "hi " + $fields.who }'
    }
    const result = await testNode({ id: 'c', type: 'custom', config: { moduleId: 'mod-greet', values: { who: 'Kun' } } }, '{}', {
      modules: [module]
    })
    expect(result.status).toBe('success')
    expect(parseOut(result)).toEqual({ greeting: 'hi Kun' })
  }, 15_000)

  it('errors when the module was deleted', async () => {
    const result = await testNode({ id: 'c', type: 'custom', config: { moduleId: 'gone', values: {} } }, '{}')
    expect(result.status).toBe('error')
    expect(result.error.toLowerCase()).toContain('module not found')
  }, 15_000)
})

// ===========================================================================
// Completeness guard
// ===========================================================================

describe('node-type coverage', () => {
  it('has a test for every WorkflowNodeKind', () => {
    const missing = WORKFLOW_NODE_KINDS.filter((kind) => !COVERED.has(kind))
    expect(missing).toEqual([])
    // Guard against a stray kind being marked covered that no longer exists.
    const extra = [...COVERED].filter((kind) => !WORKFLOW_NODE_KINDS.includes(kind))
    expect(extra).toEqual([])
  })
})
