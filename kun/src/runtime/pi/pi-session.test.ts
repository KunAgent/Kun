import { describe, expect, it } from 'vitest'
import type { JsonlTransport } from '../../session/jsonl-transport.js'
import type { HarnessProcess } from '../../session/harness-process.js'
import type {
  HarnessApprovalRequest,
  HarnessSessionStartInput,
  HarnessTurnInput,
  HarnessTurnSink,
  HarnessUserInputRequest
} from '../../session/harness-session.js'
import type { DelegatedSessionPreparation } from '../delegated-session-binding.js'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'
import { PiClient } from './pi-client.js'
import { PiSession, type PiBridgePermissionMode } from './pi-session.js'

// ---- fakes ---------------------------------------------------------------------

function fakeTransport() {
  const frames: ((value: unknown, raw: string) => void)[] = []
  const writes: unknown[] = []
  const transport = {
    closed: false,
    onFrame: (h: (value: unknown, raw: string) => void) => {
      frames.push(h)
      return () => undefined
    },
    onClose: () => () => undefined,
    write: (value: unknown) => {
      writes.push(value)
      return Promise.resolve()
    }
  } as unknown as JsonlTransport
  return {
    transport,
    writes,
    emit: (value: unknown) =>
      frames.forEach((h) => h(value, JSON.stringify(value)))
  }
}

function fakeProcess(
  exit?: Promise<{ code: number | null; signal: string | null }>
): HarnessProcess {
  return {
    stdin: undefined,
    stdout: undefined,
    exit: exit ?? new Promise(() => undefined),
    stderrTail: () => '',
    sanitizedStderrTail: () => '',
    stop: () => Promise.resolve()
  } as unknown as HarnessProcess
}

function respondToCommand(
  writes: unknown[],
  emit: (v: unknown) => void,
  command: string,
  data?: Record<string, unknown>
): void {
  const req = [...writes]
    .reverse()
    .find(
      (w): w is { id: string; type: string } =>
        typeof (w as { id?: unknown }).id === 'string' &&
        (w as { type?: unknown }).type === command
    )
  if (!req) throw new Error(`no pending ${command} write`)
  emit({ id: req.id, type: 'response', command, success: true, data })
}

function sessionInput(
  overrides: Partial<HarnessSessionStartInput> = {}
): HarnessSessionStartInput {
  const preparation: DelegatedSessionPreparation = {
    threadId: 'kun-thread-1',
    generation: 1,
    route: {
      providerKind: 'pi-rpc',
      providerId: 'pi',
      model: 'deepseek-chat',
      credentialIdentity: 'native',
      workspace: '/repo',
      capabilityFingerprint: 'fp',
      continuationMode: 'native'
    },
    priorHistoryDigest: '',
    resumed: false
  }
  return {
    threadId: 'kun-thread-1',
    turnId: 'kun-turn-1',
    workspacePath: '/repo',
    harnessId: 'pi',
    items: [],
    preparation,
    signal: new AbortController().signal,
    ...overrides
  }
}

function turnInput(overrides: Partial<HarnessTurnInput> = {}): HarnessTurnInput {
  return {
    instructionBlocks: ['sys'],
    userText: 'hello',
    images: [],
    attachmentPaths: [],
    fileReferences: [],
    workspacePath: '/repo',
    kunPermissionMode: 'ask-for-approval',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    ...overrides
  }
}

function makeSink() {
  const drafts: RuntimeEventDraft[] = []
  const approvals: HarnessApprovalRequest[] = []
  const userInputs: HarnessUserInputRequest[] = []
  const diagnostics: string[] = []
  let approvalDecision: 'accept' | 'accept-session' | 'decline' | 'cancel' = 'accept'
  const sink: HarnessTurnSink = {
    emit: (d) => {
      drafts.push(...d)
      return Promise.resolve()
    },
    requestApproval: (request) => {
      approvals.push(request)
      return Promise.resolve({ decision: approvalDecision })
    },
    requestUserInput: (request) => {
      userInputs.push(request)
      return Promise.resolve({ cancelled: false, answers: { value: 'answer' } })
    },
    diagnostic: (s) => {
      diagnostics.push(s)
    }
  }
  return {
    sink,
    drafts,
    approvals,
    userInputs,
    diagnostics,
    setApprovalDecision: (d: typeof approvalDecision) => {
      approvalDecision = d
    }
  }
}

function setup(
  opts: {
    exit?: Promise<{ code: number | null; signal: string | null }>
    resumed?: boolean
    permissionWrites?: PiBridgePermissionMode[]
  } = {}
) {
  const { transport, writes, emit } = fakeTransport()
  const proc = fakeProcess(opts.exit)
  const client = new PiClient(proc, { transport })
  const permissionWrites: PiBridgePermissionMode[] = []
  const session = new PiSession(
    client,
    '/sessions/s1.jsonl',
    sessionInput({
      preparation: {
        ...sessionInput().preparation,
        resumed: opts.resumed ?? false,
        ...(opts.resumed ? { nativeSessionId: '/sessions/s1.jsonl' } : {})
      }
    }),
    (mode) => permissionWrites.push(mode)
  )
  return { client, proc, writes, emit, session, permissionWrites }
}

async function startRun(
  session: PiSession,
  sink: HarnessTurnSink,
  writes: unknown[],
  emit: (v: unknown) => void,
  input: Partial<HarnessTurnInput> = {},
  signal = new AbortController().signal
) {
  const run = session.runTurn(turnInput(input), sink, signal)
  await new Promise((r) => setImmediate(r))
  respondToCommand(writes, emit, 'prompt', { disposition: 'started' })
  await new Promise((r) => setImmediate(r))
  return run
}

// ---- tests -----------------------------------------------------------------------

describe('PiSession', () => {
  it('reports replayedHistory=false for resumed sessions', () => {
    expect(setup({ resumed: true }).session.replayedHistory).toBe(false)
    expect(setup().session.replayedHistory).toBe(true)
  })

  it('sends prompt (slash-escaped) and resolves on agent_settled', async () => {
    const { writes, emit, session, permissionWrites } = setup()
    const { sink } = makeSink()
    const run = startRun(session, sink, writes, emit, {
      instructionBlocks: [],
      userText: '/compact me'
    })
    const req = writes.at(-1) as { type: string; message: string }
    expect(req.type).toBe('prompt')
    expect(req.message.startsWith(' ')).toBe(true)
    expect(permissionWrites).toEqual(['ask'])
    emit({ type: 'agent_start' })
    emit({ type: 'agent_end', messages: [] })
    emit({ type: 'agent_settled' })
    expect(await run).toEqual({ status: 'completed' })
  })

  it('resolves immediately when disposition is handled', async () => {
    const { writes, emit, session } = setup()
    const { sink } = makeSink()
    const run = session.runTurn(turnInput(), sink, new AbortController().signal)
    await new Promise((r) => setImmediate(r))
    respondToCommand(writes, emit, 'prompt', { disposition: 'handled' })
    expect(await run).toEqual({ status: 'completed' })
  })

  it('streams text/thinking deltas into timeline drafts', async () => {
    const { writes, emit, session } = setup()
    const { sink, drafts } = makeSink()
    const run = startRun(session, sink, writes, emit)
    emit({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hel' }
    })
    emit({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'lo' }
    })
    emit({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', contentIndex: 1, delta: 'hmm' }
    })
    await new Promise((r) => setImmediate(r))
    expect(drafts.map((d) => d.kind)).toEqual([
      'assistant_text_delta',
      'assistant_text_delta',
      'assistant_reasoning_delta'
    ])
    expect((drafts[1] as { deltaOffset: number }).deltaOffset).toBe(3)
    emit({ type: 'agent_settled' })
    await run
  })

  it('maps tool_execution start/end into tool_call items', async () => {
    const { writes, emit, session } = setup()
    const { sink, drafts } = makeSink()
    const run = startRun(session, sink, writes, emit)
    emit({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'bash',
      args: { command: 'ls' }
    })
    emit({
      type: 'tool_execution_end',
      toolCallId: 'c1',
      result: { content: [{ type: 'text', text: 'ok' }] },
      isError: false
    })
    await new Promise((r) => setImmediate(r))
    expect(drafts.map((d) => d.kind)).toEqual([
      'tool_call_started',
      'tool_call_finished'
    ])
    const call = drafts[0] as { item: { toolName: string; toolKind: string } }
    expect(call.item.toolName).toBe('bash')
    expect(call.item.toolKind).toBe('command_execution')
    emit({ type: 'agent_settled' })
    await run
  })

  it('routes kun:approval asks through the Kun gate and answers allow', async () => {
    const { writes, emit, session } = setup()
    const { sink, approvals } = makeSink()
    const run = startRun(session, sink, writes, emit)
    emit({
      type: 'extension_ui_request',
      id: 'ui-9',
      method: 'input',
      title: 'kun:approval',
      placeholder: JSON.stringify({
        toolName: 'bash',
        toolCallId: 'c9',
        input: { command: 'rm -rf dist' }
      })
    })
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    expect(approvals).toHaveLength(1)
    expect(approvals[0]?.kind).toBe('command')
    expect(approvals[0]?.summary).toContain('rm -rf dist')
    const reply = writes.at(-1) as { type: string; id: string; value?: string }
    expect(reply).toEqual({
      type: 'extension_ui_response',
      id: 'ui-9',
      value: 'allow'
    })
    emit({ type: 'agent_settled' })
    await run
  })

  it('answers deny when the Kun gate declines', async () => {
    const { writes, emit, session } = setup()
    const { sink, setApprovalDecision } = makeSink()
    setApprovalDecision('decline')
    const run = startRun(session, sink, writes, emit)
    emit({
      type: 'extension_ui_request',
      id: 'ui-10',
      method: 'input',
      title: 'kun:approval',
      placeholder: JSON.stringify({ toolName: 'write', input: { path: '/x' } })
    })
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    const reply = writes.at(-1) as { value?: string }
    expect(reply.value).toBe('deny')
    emit({ type: 'agent_settled' })
    await run
  })

  it('answers cancelled when the Kun gate cancels', async () => {
    const { writes, emit, session } = setup()
    const { sink, setApprovalDecision } = makeSink()
    setApprovalDecision('cancel')
    const run = startRun(session, sink, writes, emit)
    emit({
      type: 'extension_ui_request',
      id: 'ui-12',
      method: 'input',
      title: 'kun:approval',
      placeholder: JSON.stringify({ toolName: 'bash', input: {} })
    })
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    expect(writes.at(-1)).toEqual({
      type: 'extension_ui_response',
      id: 'ui-12',
      cancelled: true
    })
    emit({ type: 'agent_settled' })
    await run
  })

  it('maps generic extension dialogs onto the user-input gate', async () => {
    const { writes, emit, session } = setup()
    const { sink, userInputs } = makeSink()
    const run = startRun(session, sink, writes, emit)
    emit({
      type: 'extension_ui_request',
      id: 'ui-11',
      method: 'select',
      title: 'Pick one',
      options: ['a', 'b']
    })
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    expect(userInputs).toHaveLength(1)
    expect(userInputs[0]?.kind).toBe('select')
    expect(userInputs[0]?.options?.map((o) => o.id)).toEqual(['a', 'b'])
    emit({ type: 'agent_settled' })
    await run
  })

  it('aborts via the abort command when the signal fires', async () => {
    const { writes, emit, session } = setup()
    const { sink } = makeSink()
    const controller = new AbortController()
    const run = startRun(session, sink, writes, emit, {}, controller.signal)
    controller.abort()
    await new Promise((r) => setImmediate(r))
    const abortReq = writes.at(-1) as { type: string }
    expect(abortReq.type).toBe('abort')
    respondToCommand(writes, emit, 'abort', {})
    emit({ type: 'agent_settled' })
    const result = await run
    expect(['cancelled', 'completed']).toContain(result.status)
  })

  it('fails the turn when a message reports a provider error', async () => {
    const { writes, emit, session } = setup()
    const { sink } = makeSink()
    const run = startRun(session, sink, writes, emit)
    emit({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: 'quota exceeded'
      }
    })
    emit({ type: 'agent_settled' })
    expect(await run).toEqual({
      status: 'failed',
      code: 'agent_error',
      message: 'quota exceeded'
    })
  })

  it('fails the turn when the process exits mid-turn', async () => {
    let resolveExit!: (v: { code: number; signal: null }) => void
    const exit = new Promise<{ code: number; signal: null }>((r) => {
      resolveExit = r
    })
    const { writes, emit, session } = setup({ exit })
    const { sink } = makeSink()
    const run = startRun(session, sink, writes, emit)
    resolveExit({ code: 1, signal: null })
    const result = await run
    expect(result.status).toBe('failed')
    expect(result.code).toBe('harness_crashed')
  })

  it('writes bypass mode for full-access turns', async () => {
    const { writes, emit, session, permissionWrites } = setup()
    const { sink } = makeSink()
    const run = startRun(session, sink, writes, emit, {
      kunPermissionMode: 'full-access'
    })
    expect(permissionWrites).toEqual(['bypass'])
    emit({ type: 'agent_settled' })
    await run
  })

  it('writes read-only mode when the sandbox is read-only', async () => {
    const { writes, emit, session, permissionWrites } = setup()
    const { sink } = makeSink()
    const run = startRun(session, sink, writes, emit, {
      kunPermissionMode: 'full-access',
      sandboxMode: 'read-only'
    })
    expect(permissionWrites).toEqual(['read-only'])
    emit({ type: 'agent_settled' })
    await run
  })
})
