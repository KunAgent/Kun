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
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
    const testDirectory = dirname(fileURLToPath(import.meta.url))
    const coverageSources = [
      'workflow-runtime.nodes.test.ts',
      'workflow-runtime.nodes.control-data.test.ts',
      'workflow-runtime.nodes.io-loop-custom.test.ts'
    ].map((file) => readFileSync(join(testDirectory, file), 'utf8'))
    const covered = new Set<WorkflowNodeKind>(
      coverageSources.flatMap((source) =>
        [...source.matchAll(/\bcover\('([^']+)'\)/g)]
          .map((match) => match[1] as WorkflowNodeKind))
    )
    const missing = WORKFLOW_NODE_KINDS.filter((kind) => !covered.has(kind))
    expect(missing).toEqual([])
    // Guard against a stray kind being marked covered that no longer exists.
    const extra = [...covered].filter((kind) => !WORKFLOW_NODE_KINDS.includes(kind))
    expect(extra).toEqual([])
  })
})
