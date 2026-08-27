import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../../src/adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../../src/adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../../src/adapters/in-memory-thread-store.js'
import { LocalToolHost, echoTool, type LocalTool } from '../../src/adapters/tool/local-tool-host.js'
import { InMemoryArtifactStore } from '../../src/artifacts/artifact-store.js'
import { createImmutablePrefix } from '../../src/cache/immutable-prefix.js'
import { DEFAULT_GRAPH_RUNTIME_CONFIG } from '../../src/config/kun-config.js'
import { emptyUsageSnapshot } from '../../src/contracts/usage.js'
import { createThreadRecord } from '../../src/domain/thread.js'
import type { ApprovalRequest } from '../../src/domain/approval.js'
import { InflightTracker } from '../../src/loop/inflight-tracker.js'
import { SteeringQueue } from '../../src/loop/steering-queue.js'
import { ContextCompactor } from '../../src/loop/context-compactor.js'
import {
  AgentLoop,
  buildRuntimeContextInstruction,
  isStalePlanContext,
  resolvePlanModeToolSpecs,
  shouldInjectInitialRuntimeContext,
  svgArtifactCompletionState,
  turnHasUnverifiedSourceChanges
} from '../../src/loop/agent-loop.js'
import { SequentialIdGenerator } from '../../src/ports/id-generator.js'
import type { ModelClient, ModelRequest, ModelStreamChunk, ModelToolSpec } from '../../src/ports/model-client.js'
import type { UserInputGate, UserInputRequest, UserInputResolution } from '../../src/ports/user-input-gate.js'
import { GraphRuntimeComposition } from '../../src/server/graph-runtime-factory.js'
import { RuntimeEventRecorder } from '../../src/services/runtime-event-recorder.js'
import { TurnService } from '../../src/services/turn-service.js'
import { UsageService } from '../../src/services/usage-service.js'

export class AllowApprovalGate {
  request(_approval: ApprovalRequest): Promise<'allow' | 'deny'> {
    return Promise.resolve('allow')
  }

  decide(): boolean {
    return false
  }

  reserveDecision(): boolean {
    return false
  }

  commitDecision(): boolean {
    return false
  }

  rollbackDecision(): boolean {
    return false
  }

  expire(): boolean {
    return false
  }

  pending(): ApprovalRequest[] {
    return []
  }

  get(): ApprovalRequest | undefined {
    return undefined
  }
}

export class NoopUserInputGate implements UserInputGate {
  request(_input: UserInputRequest): Promise<UserInputResolution> {
    return Promise.resolve({ status: 'cancelled' })
  }

  get(): UserInputRequest | undefined {
    return undefined
  }

  claimResolution() {
    return undefined
  }

  resolve(): 'missing' {
    return 'missing'
  }

  pending(): UserInputRequest[] {
    return []
  }

  reset(): void {}
}

export class AbortAwareModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'abort-aware-model'
  readonly requests: ModelRequest[] = []
  abortObserved = false
  private readonly streamStartedListeners: Array<() => void> = []

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    for (const listener of this.streamStartedListeners.splice(0)) listener()
    if (!request.abortSignal.aborted) {
      await new Promise<void>((resolve) => {
        request.abortSignal.addEventListener('abort', () => resolve(), { once: true })
      })
    }
    this.abortObserved = request.abortSignal.aborted
    for (const chunk of [] as ModelStreamChunk[]) yield chunk
  }

  waitForStreamStart(): Promise<void> {
    if (this.requests.length > 0) return Promise.resolve()
    return new Promise((resolve) => this.streamStartedListeners.push(resolve))
  }
}

export class RepeatingToolModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'repeating-tool-model'
  private calls = 0

  async *stream(): AsyncIterable<ModelStreamChunk> {
    this.calls += 1
    yield {
      kind: 'tool_call_complete',
      callId: `call_${this.calls}`,
      toolName: 'echo',
      arguments: { text: 'again' }
    }
    yield { kind: 'completed', stopReason: 'tool_calls' }
  }
}

export class AlternatingGraphLeadToolModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'alternating-graph-lead-tool-model'
  readonly requests: ModelRequest[] = []

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    const sequence = this.requests.length
    const controlStep = sequence % 2 === 1
    yield {
      kind: 'tool_call_complete',
      callId: `graph_lead_call_${sequence}`,
      toolName: controlStep ? 'graph_control_run' : 'graph_supervise_node',
      arguments: {
        action: controlStep ? 'inspect' : 'overview',
        sequence
      }
    }
    yield { kind: 'completed', stopReason: 'tool_calls' }
  }
}

export class HangingGraphLeadModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'hanging-graph-lead-model'
  readonly requests: ModelRequest[] = []
  private markStarted: (() => void) | undefined
  private readonly started = new Promise<void>((resolve) => {
    this.markStarted = resolve
  })

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    this.markStarted?.()
    if (!request.abortSignal.aborted) {
      await new Promise<void>((resolve) => {
        request.abortSignal.addEventListener('abort', () => resolve(), { once: true })
      })
    }
    for (const chunk of [] as ModelStreamChunk[]) yield chunk
  }

  waitForStart(): Promise<void> {
    return this.started
  }
}

export class CapturingCompleteModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'capturing-complete-model'
  readonly requests: ModelRequest[] = []

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    yield { kind: 'assistant_text_delta', text: 'Done.' }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

export class RecoverableGraphStreamModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'recoverable-graph-stream-model'
  readonly requests: ModelRequest[] = []

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    if (this.requests.length === 1) {
      yield { kind: 'assistant_text_delta', text: 'Partial Graph supervision update.' }
      yield {
        kind: 'error',
        message: 'model stream read failed: terminated',
        code: 'stream_read_error',
        failure: { category: 'network', failoverAllowed: true }
      }
      return
    }
    yield { kind: 'assistant_text_delta', text: 'Recovered Graph final response.' }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

export class ScriptedGraphModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'scripted-graph-model'
  readonly requests: ModelRequest[] = []

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    if (this.requests.length === 1) {
      yield {
        kind: 'assistant_text_delta',
        text: 'Graph validation failed, so the run was not started.'
      }
      yield { kind: 'completed', stopReason: 'stop' }
      return
    }
    if (this.requests.length === 2) {
      yield {
        kind: 'tool_call_complete',
        callId: 'graph_define_call',
        toolName: 'graph_define_plan',
        arguments: { plan: { tasks: [] } }
      }
      yield { kind: 'completed', stopReason: 'tool_calls' }
      return
    }
    yield { kind: 'assistant_text_delta', text: 'GraphRun started.' }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

export class ScriptedInvalidGraphModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'scripted-invalid-graph-model'
  readonly requests: ModelRequest[] = []

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    if (this.requests.length <= 2) {
      yield {
        kind: 'tool_call_complete',
        callId: `graph_define_call_${this.requests.length}`,
        toolName: 'graph_define_plan',
        arguments: this.requests.length === 1
          ? { plan: {} }
          : { plan: { valid: true } }
      }
      yield { kind: 'completed', stopReason: 'tool_calls' }
      return
    }
    yield { kind: 'assistant_text_delta', text: 'GraphRun started after correction.' }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

export class TruncatedRawGraphPlanModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'truncated-raw-graph-plan-model'
  readonly requests: ModelRequest[] = []

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    if (this.requests.length <= 2) {
      yield {
        kind: 'tool_call_complete',
        callId: `graph_define_raw_recovery_${this.requests.length}`,
        toolName: 'graph_define_plan',
        arguments: this.requests.length === 1
          ? { __raw: '{"plan":{"title":"truncated-private-marker","tasks":[' }
          : {
              plan: {
                title: 'Implement the requested Graph change',
                tasks: [{
                  key: 'implement',
                  kind: 'work',
                  title: 'Implement and verify the change',
                  objective: 'Implement the requested change and verify its behavior.',
                  dependsOn: [],
                  dataFrom: [],
                  acceptanceCriteria: ['The requested behavior is implemented and verified.'],
                  readScopes: ['.'],
                  writeScopes: ['src']
                }],
                completionTaskKeys: ['implement']
              }
            }
      }
      yield { kind: 'completed', stopReason: 'tool_calls' }
      return
    }
    yield { kind: 'assistant_text_delta', text: 'The durable GraphRun is now active.' }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

export class FinalResponseGateModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'final-response-gate-model'
  readonly requests: ModelRequest[] = []
  private releaseFirstResponse: (() => void) | undefined
  private markFirstStarted: (() => void) | undefined
  private readonly firstResponseStarted = new Promise<void>((resolve) => {
    this.markFirstStarted = resolve
  })
  private readonly firstResponseReleased = new Promise<void>((resolve) => {
    this.releaseFirstResponse = resolve
  })

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    if (this.requests.length === 1) {
      this.markFirstStarted?.()
      await this.firstResponseReleased
    }
    yield { kind: 'assistant_text_delta', text: `response ${this.requests.length}` }
    yield { kind: 'completed', stopReason: 'stop' }
  }

  waitForFirstResponse(): Promise<void> {
    return this.firstResponseStarted
  }

  release(): void {
    this.releaseFirstResponse?.()
  }
}

export class RoutedFailureModel implements ModelClient {
  readonly provider = 'compat-multi'
  readonly model = 'gpt-5.3-codex-spark'
  readonly config = {
    model: this.model,
    baseUrl: 'https://chatgpt.example/codex',
    endpointFormat: 'custom_endpoint'
  }
  request?: ModelRequest

  configFor(providerId?: string) {
    if (providerId !== 'deepseek') throw new Error(`unknown model provider: ${providerId}`)
    return {
      model: 'deepseek-v4-pro',
      baseUrl: 'https://api.deepseek.com',
      endpointFormat: 'chat_completions'
    }
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.request = request
    yield* [] as ModelStreamChunk[]
    throw new Error('upstream transport failed')
  }
}

export type SvgModelAction = 'stop' | 'edit' | 'validate'

export class ScriptedSvgModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'scripted-svg-model'
  readonly requests: ModelRequest[] = []
  private index = 0

  constructor(private readonly actions: readonly SvgModelAction[]) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    const action = this.actions[this.index] ?? 'stop'
    this.index += 1
    if (action !== 'stop') {
      yield {
        kind: 'tool_call_complete',
        callId: `${action}_${this.index}`,
        toolName: action === 'edit' ? 'design_svg_edit' : 'design_svg_validate',
        arguments: { attempt: this.index }
      }
      yield { kind: 'completed', stopReason: 'tool_calls' }
      return
    }
    yield { kind: 'assistant_text_delta', text: 'Done.' }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

export function svgGateTool(
  name: 'design_svg_edit' | 'design_svg_validate' | 'write',
  result: { output: unknown; isError?: boolean }
): LocalTool {
  return LocalToolHost.defineTool({
    name,
    description: name,
    inputSchema: { type: 'object', additionalProperties: true },
    toolKind: name === 'design_svg_validate' ? 'tool_call' : 'file_change',
    policy: 'auto',
    shouldAdvertise: (context) => context.guiDesignArtifact?.kind === 'svg',
    execute: async () => result
  })
}

export async function svgLoopHarness(input: {
  model: ModelClient
  tools: LocalTool[]
  skillRuntime?: ConstructorParameters<typeof AgentLoop>[0]['skillRuntime']
}) {
  const sessionStore = new InMemorySessionStore()
  const threadStore = new InMemoryThreadStore()
  const eventBus = new InMemoryEventBus()
  const inflight = new InflightTracker()
  const steering = new SteeringQueue()
  const ids = new SequentialIdGenerator()
  const nowIso = () => '2026-07-10T00:00:00.000Z'
  const events = new RuntimeEventRecorder({
    eventBus, sessionStore, allocateSeq: (id) => eventBus.allocateSeq(id), nowIso
  })
  const turns = new TurnService({
    threadStore, sessionStore, events, inflight, steering, compactor: new ContextCompactor(), ids, nowIso
  })
  const loop = new AgentLoop({
    threadStore,
    sessionStore,
    approvalGate: new AllowApprovalGate(),
    userInputGate: new NoopUserInputGate(),
    model: input.model,
    toolHost: new LocalToolHost({ tools: input.tools }),
    usage: new UsageService(),
    events,
    turns,
    inflight,
    steering,
    compactor: new ContextCompactor(),
    prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
    ids,
    nowIso,
    ...(input.skillRuntime ? { skillRuntime: input.skillRuntime } : {})
  })
  const threadId = 'thr_svg_gate'
  await threadStore.upsert(createThreadRecord({
    id: threadId,
    title: 'SVG gate',
    workspace: '/tmp/workspace',
    model: input.model.model,
    mode: 'plan'
  }))
  const started = await turns.startTurn({
    threadId,
    request: {
      prompt: 'make the reserved svg',
      model: input.model.model,
      guiDesignCanvas: true,
      guiDesignMode: true,
      guiDesignArtifact: {
        kind: 'svg', artifactId: 'motion', relativePath: '.kun-design/doc/motion/v1.svg'
      }
    }
  })
  return { loop, sessionStore, threadId, turnId: started.turnId }
}
