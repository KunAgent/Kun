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
