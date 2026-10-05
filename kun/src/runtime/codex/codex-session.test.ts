import { describe, expect, it } from 'vitest'
import { JsonRpcPeer } from '../../session/jsonrpc-peer.js'
import type { JsonlTransport } from '../../session/jsonl-transport.js'
import type { HarnessProcess } from '../../session/harness-process.js'
import type {
  HarnessApprovalRequest,
  HarnessSessionStartInput,
  HarnessTurnInput,
  HarnessTurnSink
} from '../../session/harness-session.js'
import { HarnessTransportError } from '../../session/harness-session.js'
import type { DelegatedSessionPreparation } from '../delegated-session-binding.js'
import { CodexAgent } from './codex-agent.js'
import { CodexClient } from './codex-client.js'
import { CodexSession, type CodexRequestRouter } from './codex-session.js'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'

// ---- fakes -------------------------------------------------------------------

function fakePeer() {
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
  const peer = new JsonRpcPeer(transport)
  return {
    peer,
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

function newClient(
  exit?: Promise<{ code: number | null; signal: string | null }>
) {
  const { peer, writes, emit } = fakePeer()
  const proc = fakeProcess(exit)
  const client = new CodexClient({ process: proc, peer })
  return { client, proc, writes, emit }
}

function respondToLast(
  writes: unknown[],
  emit: (v: unknown) => void,
  result: unknown
) {
  const frame = writes.at(-1) as { id: number }
  emit({ id: frame.id, result })
}

function sessionInput(
  overrides: Partial<HarnessSessionStartInput> = {}
): HarnessSessionStartInput {
  const preparation: DelegatedSessionPreparation = {
    threadId: 'kun-thread-1',
    generation: 1,
    route: {
      providerKind: 'codex-app-server',
      providerId: 'codex',
      model: 'gpt-5',
      credentialIdentity: 'scrypt-v1:test',
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
    harnessId: 'codex',
    model: 'gpt-5',
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
    model: 'gpt-5',
    kunPermissionMode: 'default',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    ...overrides
  }
}

function makeSink() {
  const drafts: RuntimeEventDraft[] = []
  const approvals: HarnessApprovalRequest[] = []
  const diagnostics: string[] = []
  let approvalDecision: 'accept' | 'accept-session' | 'decline' | 'cancel' =
    'accept'
  let userInputResponse: {
    answers?: Record<string, unknown>
    cancelled?: boolean
  } = { answers: { q1: 'picked' } }
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
      userInputRequests.push(request)
      return Promise.resolve(userInputResponse)
    },
    diagnostic: (s) => diagnostics.push(s)
  }
  const userInputRequests: Parameters<
    HarnessTurnSink['requestUserInput']
  >[0][] = []
  return {
    sink,
    drafts,
    approvals,
    diagnostics,
    userInputRequests,
    setApprovalDecision: (d: typeof approvalDecision) => {
      approvalDecision = d
    },
    setUserInputResponse: (r: typeof userInputResponse) => {
      userInputResponse = r
    }
  }
}

function makeRouter(): {
  router: CodexRequestRouter
  handlers: Map<string, (m: string, p: unknown) => unknown>
} {
  const handlers = new Map<string, (m: string, p: unknown) => unknown>()
  const router: CodexRequestRouter = {
    register: (key, handler) => {
      handlers.set(key, handler)
      return () => {
        handlers.delete(key)
      }
    }
  }
  return { router, handlers }
}

async function startTurn(
  session: CodexSession,
  sink: HarnessTurnSink,
  emit: (v: unknown) => void,
  writes: unknown[],
  signal = new AbortController().signal
) {
  const run = session.runTurn(turnInput(), sink, signal)
  // Ack the turn/start request so activeCodexTurnId is set.
  respondToLast(writes, emit, {
    turn: { id: 'cx-turn-1', status: 'inProgress', items: [] }
  })
  await new Promise((r) => setImmediate(r))
  return run
}

const COMPLETED_TURN = {
  threadId: 'cx-thread-1',
  turn: { id: 'cx-turn-1', status: 'completed', items: [] }
}

// ---- CodexSession ------------------------------------------------------------

describe('CodexSession', () => {
  function setup(
    opts: {
      exit?: Promise<{ code: number | null; signal: string | null }>
      resumed?: boolean
    } = {}
  ) {
    const { client, proc, writes, emit } = newClient(opts.exit)
    const { router, handlers } = makeRouter()
    // Without a CodexAgent, wire inbound requests to registered turn
    // handlers directly (agent tests cover the agent-level router).
    client.onRequest((method, params) => {
      const threadId = (params as { threadId?: string })?.threadId
      const handler = handlers.get(`${threadId}:*`)
      if (!handler) {
        throw new HarnessTransportError(
          'harness_protocol_error',
          `unhandled ${method}`
        )
      }
      return handler(method, params)
    })
    const input = sessionInput({
      preparation: {
        ...sessionInput().preparation,
        resumed: opts.resumed ?? false,
        ...(opts.resumed ? { nativeSessionId: 'cx-thread-1' } : {})
      }
    })
    const session = new CodexSession(client, 'cx-thread-1', input, router)
    return { client, proc, writes, emit, handlers, session }
  }

  it('reports replayedHistory=false for resumed threads', () => {
    expect(setup({ resumed: true }).session.replayedHistory).toBe(false)
    expect(setup().session.replayedHistory).toBe(true)
  })

  it('sends turn/start with Kun ceiling and resolves on turn/completed', async () => {
    const { writes, emit, session } = setup()
    const { sink } = makeSink()
    const run = startTurn(session, sink, emit, writes)
    const startReq = writes.at(-1) as {
      method: string
      params: Record<string, unknown>
    }
    expect(startReq.method).toBe('turn/start')
    expect(startReq.params.threadId).toBe('cx-thread-1')
    expect(startReq.params.approvalPolicy).toBe('untrusted')
    expect(startReq.params.sandboxPolicy).toEqual({
      type: 'workspaceWrite',
      writableRoots: ['/repo']
    })
    emit({ method: 'turn/completed', params: COMPLETED_TURN })
    expect(await run).toEqual({ status: 'completed' })
  })

  it('maps assistant deltas into timeline drafts', async () => {
    const { writes, emit, session } = setup()
    const { sink, drafts } = makeSink()
    const run = startTurn(session, sink, emit, writes)
    emit({
      method: 'item/agentMessage/delta',
      params: { threadId: 'cx-thread-1', itemId: 'it1', delta: 'Hello ' }
    })
    emit({
      method: 'item/agentMessage/delta',
      params: { threadId: 'cx-thread-1', itemId: 'it1', delta: 'world' }
    })
    await new Promise((r) => setImmediate(r))
    expect(drafts).toHaveLength(2)
    expect(drafts[0]?.kind).toBe('assistant_text_delta')
    expect((drafts[1] as { deltaOffset: number }).deltaOffset).toBe(6)
    emit({ method: 'turn/completed', params: COMPLETED_TURN })
    expect(await run).toEqual({ status: 'completed' })
  })

  it('filters notifications from other codex threads', async () => {
    const { writes, emit, session } = setup()
    const { sink, drafts } = makeSink()
    const run = startTurn(session, sink, emit, writes)
    emit({
      method: 'item/agentMessage/delta',
      params: { threadId: 'cx-thread-OTHER', itemId: 'it9', delta: 'nope' }
    })
    await new Promise((r) => setImmediate(r))
    expect(drafts).toHaveLength(0)
    emit({ method: 'turn/completed', params: COMPLETED_TURN })
    await run
  })

  it('maps failed turn status to a failed result', async () => {
    const { writes, emit, session } = setup()
    const { sink } = makeSink()
    const run = startTurn(session, sink, emit, writes)
    emit({
      method: 'turn/completed',
      params: {
        threadId: 'cx-thread-1',
        turn: {
          id: 'cx-turn-1',
          status: 'failed',
          items: [],
          error: { message: 'boom' }
        }
      }
    })
    expect(await run).toEqual({
      status: 'failed',
      code: 'agent_error',
      message: 'boom'
    })
  })

  it('routes command-execution approvals through the Kun gate', async () => {
    const { writes, emit, session } = setup()
    const { sink, approvals, setApprovalDecision } = makeSink()
    setApprovalDecision('accept-session')
    const run = startTurn(session, sink, emit, writes)
    emit({
      id: 'srv-1',
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'cx-thread-1',
        turnId: 'cx-turn-1',
        itemId: 'it1',
        command: 'rm -rf build',
        reason: 'cleanup'
      }
    })
    await new Promise((r) => setImmediate(r))
    expect(approvals).toHaveLength(1)
    expect(approvals[0]?.kind).toBe('command')
    const reply = writes.at(-1) as { id: string; result: unknown }
    expect(reply.id).toBe('srv-1')
    expect(reply.result).toEqual({ decision: 'acceptForSession' })
    emit({ method: 'turn/completed', params: COMPLETED_TURN })
    await run
  })

  it('passes codex questions verbatim to the user-input gate', async () => {
    const { writes, emit, session } = setup()
    const { sink, userInputRequests, setUserInputResponse } = makeSink()
    setUserInputResponse({ answers: { q1: 'yes' } })
    const run = startTurn(session, sink, emit, writes)
    emit({
      id: 'srv-2',
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'cx-thread-1',
        turnId: 'cx-turn-1',
        itemId: 'it2',
        questions: [
          {
            id: 'q1',
            header: 'Pick',
            question: 'Continue?',
            options: [{ label: 'yes', description: 'go' }]
          }
        ]
      }
    })
    await new Promise((r) => setImmediate(r))
    expect(userInputRequests).toHaveLength(1)
    expect(userInputRequests[0]?.questions?.[0]?.id).toBe('q1')
    const reply = writes.at(-1) as { id: string; result: unknown }
    expect(reply.result).toEqual({ answers: { q1: { answers: ['yes'] } } })
    emit({ method: 'turn/completed', params: COMPLETED_TURN })
    await run
  })

  it('interrupts via turn/interrupt when the abort signal fires', async () => {
    const { writes, emit, session } = setup()
    const { sink } = makeSink()
    const controller = new AbortController()
    const run = startTurn(
      session,
      sink,
      emit,
      writes,
      controller.signal
    )
    controller.abort()
    await new Promise((r) => setImmediate(r))
    const interruptReq = writes.at(-1) as {
      method: string
      params: Record<string, unknown>
    }
    expect(interruptReq.method).toBe('turn/interrupt')
    expect(interruptReq.params).toMatchObject({
      threadId: 'cx-thread-1',
      turnId: 'cx-turn-1'
    })
    emit({
      method: 'turn/completed',
      params: {
        threadId: 'cx-thread-1',
        turn: { id: 'cx-turn-1', status: 'interrupted', items: [] }
      }
    })
    expect(await run).toEqual({ status: 'cancelled' })
  })

  it('fails the turn when the process exits mid-turn', async () => {
    let resolveExit!: (v: { code: number; signal: null }) => void
    const exit = new Promise<{ code: number; signal: null }>((r) => {
      resolveExit = r
    })
    const { writes, emit, session } = setup({ exit })
    const { sink } = makeSink()
    const run = startTurn(session, sink, emit, writes)
    resolveExit({ code: 1, signal: null })
    const result = await run
    expect(result.status).toBe('failed')
    expect(result.code).toBe('harness_crashed')
  })
})

// ---- CodexAgent ---------------------------------------------------------------

describe('CodexAgent', () => {
  const connectInput = {
    definition: {} as never,
    command: 'codex',
    args: [],
    env: {},
    secretEnv: {},
    credentialEnv: {},
    stripEnv: [],
    cwd: '/repo',
    signal: new AbortController().signal
  }

  function agentWith(
    client: CodexClient,
    proc: HarnessProcess
  ): Promise<CodexAgent> {
    return CodexAgent.connect(connectInput, { client, process: proc })
  }

  it('starts sessions via thread/start', async () => {
    const { client, proc, writes, emit } = newClient()
    const agent = await agentWith(client, proc)
    const promise = agent.startSession(sessionInput())
    respondToLast(writes, emit, { thread: { id: 'cx-thread-9' } })
    const session = await promise
    expect(session.providerSessionId).toBe('cx-thread-9')
    const req = writes.at(-1) as { method: string; params: unknown }
    expect(req.method).toBe('thread/start')
    expect((req.params as { approvalsReviewer: string }).approvalsReviewer).toBe(
      'user'
    )
    expect(req.params).toMatchObject({ sandbox: 'read-only', approvalPolicy: 'untrusted' })
  })

  it('resumes via thread/resume and marks replayedHistory=false', async () => {
    const { client, proc, writes, emit } = newClient()
    const agent = await agentWith(client, proc)
    const promise = agent.resumeSession(
      sessionInput({
        preparation: {
          ...sessionInput().preparation,
          resumed: true,
          nativeSessionId: 'cx-thread-old'
        }
      })
    )
    respondToLast(writes, emit, { thread: { id: 'cx-thread-old' } })
    const session = await promise
    expect(session.providerSessionId).toBe('cx-thread-old')
    expect(session.replayedHistory).toBe(false)
    const req = writes.at(-1) as { method: string; params: unknown }
    expect(req.method).toBe('thread/resume')
    expect(req.params).toMatchObject({ sandbox: 'read-only', approvalPolicy: 'untrusted' })
  })

  it('surfaces resume failures as harness_not_ready for portable rebase', async () => {
    const { client, proc, writes, emit } = newClient()
    const agent = await agentWith(client, proc)
    const promise = agent.resumeSession(
      sessionInput({
        preparation: {
          ...sessionInput().preparation,
          resumed: true,
          nativeSessionId: 'cx-dead'
        }
      })
    )
    const frame = writes.at(-1) as { id: number }
    emit({ id: frame.id, error: { code: -32000, message: 'no such thread' } })
    await expect(promise).rejects.toMatchObject({
      name: 'HarnessTransportError',
      code: 'harness_not_ready'
    })
  })

  it('refuses inbound requests for unknown threads', async () => {
    const { client, proc, emit, writes } = newClient()
    await agentWith(client, proc)
    emit({
      id: 'srv-9',
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'nobody', turnId: 'x', itemId: 'i' }
    })
    await new Promise((r) => setImmediate(r))
    const reply = writes.at(-1) as { id: string; error?: { code: number } }
    expect(reply.id).toBe('srv-9')
    expect(reply.error).toBeDefined()
  })
})
