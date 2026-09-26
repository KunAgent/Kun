import { createHash } from 'node:crypto'
import type { ArtifactStore } from '../../artifacts/artifact-store.js'
import {
  GRAPH_CONTRACT_VERSION,
  GraphWorkerResultV1Schema,
  type GraphArtifactReferenceV1,
  type GraphNodeAttemptV1,
  type GraphRunV1
} from '../../contracts/index.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { LocalTool } from './local-tool-host.js'
import { LocalToolHost } from './local-tool-host.js'
import {
  GraphControlService,
  type FileGraphPlanningDraftStore,
  GraphMailbox,
  GraphWorkerSessionRegistry,
  canonicalWorkerArtifactRefs,
  graphPhysicalPathsEqual,
  type GraphRunStore,
  type ProjectAgentRegistry
} from '../../graph/index.js'
import {
  GRAPH_LEAD_TOOL_NAMES,
  GRAPH_WORKER_TOOL_NAMES
} from '../../graph/graph-tool-boundary.js'
import { buildGraphCreateRunTool } from './graph-create-run-tool.js'
import {
  buildGraphDefinePlanTool,
  GRAPH_DEFINE_PLAN_INPUT_JSON_SCHEMA,
  GraphDefinePlanInputSchema
} from './graph-define-plan-tool.js'
import type { GraphPlanHarnessAdmission } from './graph-plan-admission.js'
import { buildGraphLeadSupervisionTool } from './graph-lead-supervision-tool.js'
import { buildGraphLeadReviewTool } from './graph-lead-review-tool.js'
import {
  buildGraphLeadPatchTool,
  GRAPH_LEAD_PATCH_INPUT_JSON_SCHEMA,
  GraphLeadPatchInputSchema
} from './graph-lead-patch-tool.js'
import { buildGraphReportToParentTool } from './graph-report-to-parent-tool.js'
import { graphControlSnapshot } from './graph-control-snapshot.js'
import type { SessionStore } from '../../ports/session-store.js'
import type { ThreadStore } from '../../ports/thread-store.js'

export {
  GRAPH_CREATE_RUN_INPUT_JSON_SCHEMA,
  GraphCreateRunInputSchema,
  GraphCreateRunLegacyInputSchema,
  GraphCreateRunPlanInputSchema
} from './graph-create-run-tool.js'

export function buildGraphModeLocalTools(options: {
  control: GraphControlService
  store: GraphRunStore
  mailbox: GraphMailbox
  registry: ProjectAgentRegistry
  artifactStore: ArtifactStore
  workerSessions: GraphWorkerSessionRegistry
  drafts: FileGraphPlanningDraftStore
  events: Pick<import('../../services/runtime-event-recorder.js').RuntimeEventRecorder, 'record'>
  threads?: Pick<ThreadStore, 'get'>
  sessions?: Pick<SessionStore, 'loadItems'>
  steerChildTurn?: () => ((input: {
    threadId: string
    turnId: string
    text: string
    displayText?: string
    messageSource?: 'graph_runtime'
  }) => Promise<void>) | undefined
  childActivity?: (
    parentThreadId: string,
    childThreadId: string
  ) => Promise<{
    status: 'queued' | 'running' | 'completed' | 'failed' | 'aborted'
    activity?: {
      phase: 'starting' | 'thinking' | 'responding' | 'tool' | 'retrying' | 'compacting' | 'waiting'
      label: string
      toolName?: string
      startedAt: string
      updatedAt: string
    }
    updatedAt: string
  } | undefined>
  config?: () => import('../../config/kun-config.js').GraphRuntimeConfig
  /** Late-bound harness services for plan-phase admission (P1-25). */
  harnesses?: () => GraphPlanHarnessAdmission | undefined
  enabled: () => boolean
  signalSupervision?: (input: {
    runId: string
    reason: 'help' | 'user_steering' | 'submitted' | 'worker_report'
    nodeIds: string[]
    digest: string
  }) => Promise<void> | void
  nowIso?: () => string
  nextId?: (prefix: string) => string
}): LocalTool[] {
  const nowIso = options.nowIso ?? (() => new Date().toISOString())
  let next = 0
  const nextId = options.nextId ?? ((prefix: string) => `${prefix}_${Date.now()}_${++next}`)
  const controlSnapshot = (run: GraphRunV1) =>
    graphControlSnapshot(run, options.config?.())
  const graphLeadOnly = (context: ToolHostContext) =>
    options.enabled() &&
    !options.workerSessions.has(context.threadId) &&
    (context.orchestration === 'graph' || context.messageSource === 'graph_runtime')
  const graphCreatorOnly = (_context: ToolHostContext) => false
  const graphPlannerOnly = (context: ToolHostContext) =>
    options.enabled() &&
    !options.workerSessions.has(context.threadId) &&
    context.orchestration === 'graph'
  const reportToParentOnly = (context: ToolHostContext) =>
    options.enabled() && options.workerSessions.has(context.threadId)
  // Legacy handlers stay readable for persisted history, but new Graph
  // children receive only the minimal host-owned reporting capability.
  const graphWorkerOnly = (_context: ToolHostContext) => false

  return [
    buildGraphDefinePlanTool({
      control: options.control,
      drafts: options.drafts,
      registry: options.registry,
      events: options.events,
      shouldAdvertise: graphPlannerOnly,
      nowIso,
      nextId,
      config: options.config,
      harnesses: options.harnesses
    }),
    buildGraphCreateRunTool({
      control: options.control,
      registry: options.registry,
      shouldAdvertise: graphCreatorOnly,
      nowIso,
      nextId,
      config: options.config
    }),
    buildGraphLeadSupervisionTool({
      control: options.control,
      mailbox: options.mailbox,
      store: options.store,
      registry: options.registry,
      threads: options.threads,
      sessions: options.sessions,
      steerChildTurn: options.steerChildTurn,
      childActivity: options.childActivity,
      shouldAdvertise: graphLeadOnly,
      nowIso,
      nextId
    }),
    LocalToolHost.defineTool({
      name: GRAPH_LEAD_TOOL_NAMES[2],
      description:
        'Inspect or control one durable GraphRun. Actions: inspect, pause, resume, cancel, or retry_node. ' +
        'Inspect returns a bounded decision snapshot, not the full journal. Use graph_supervise_node guide ' +
        'for attempt-specific guidance. Every mutation is host-validated and idempotent; sequence and revision ' +
        'preconditions are owned by the host.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['inspect', 'pause', 'resume', 'cancel', 'retry_node']
          },
          runId: { type: 'string' },
          nodeId: { type: 'string' },
          text: { type: 'string' }
        },
        required: ['action', 'runId'],
        additionalProperties: false
      },
      policy: 'auto',
      toolKind: 'tool_call',
      sideEffect: 'unknown',
      shouldAdvertise: graphLeadOnly,
      execute: async (args, context) => {
        try {
          const action = stringArg(args.action)
          const runId = stringArg(args.runId)
          const authorized = await authorizedLead(options.store, options.registry, runId, context)
          if (action === 'inspect') return { output: controlSnapshot(authorized) }
          const commandId = nextId('graph_command')
          const command = {
            commandId,
            idempotencyKey:
              `graph-control:${runId}:${action}:${stringArg(args.nodeId) || 'run'}:${commandId}`
          }
          if (action === 'pause') {
            return { output: controlSnapshot(await options.control.pause(runId, command)) }
          }
          if (action === 'resume') {
            return { output: controlSnapshot(await options.control.resume(runId, command)) }
          }
          if (action === 'cancel') return {
            output: controlSnapshot(
              await options.control.cancel(runId, {
                ...command,
                ...(stringArg(args.text) ? { reason: stringArg(args.text) } : {})
              })
            )
          }
          if (action === 'retry_node') {
            const nodeId = stringArg(args.nodeId)
            if (!nodeId) throw new Error('nodeId is required for retry_node')
            return {
              output: controlSnapshot(
                await options.control.retryNode(runId, nodeId, command)
              )
            }
          }
          throw new Error(`unsupported Graph control action: ${action}`)
        } catch (error) {
          return { output: { error: errorMessage(error) }, isError: true }
        }
      }
    }),
    buildGraphLeadPatchTool({
      control: options.control,
      store: options.store,
      registry: options.registry,
      shouldAdvertise: graphLeadOnly,
      nowIso,
      nextId,
      config: options.config
    }),
    buildGraphLeadReviewTool({
      control: options.control,
      store: options.store,
      registry: options.registry,
      shouldAdvertise: graphLeadOnly,
      nowIso,
      nextId
    }),
    buildGraphReportToParentTool({
      store: options.store,
      mailbox: options.mailbox,
      workerSessions: options.workerSessions,
      shouldAdvertise: reportToParentOnly,
      signalSupervision: options.signalSupervision,
      nextId
    }),
    LocalToolHost.defineTool({
      name: GRAPH_WORKER_TOOL_NAMES[0],
      description:
        'Report bounded progress for the Graph worker attempt associated with this child session.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: { type: 'string' },
          summary: { type: 'string' },
          percent: { type: 'number' },
          phase: { type: 'string' }
        },
        required: ['runId', 'summary'],
        additionalProperties: false
      },
      policy: 'auto',
      toolKind: 'tool_call',
      sideEffect: 'unknown',
      shouldAdvertise: graphWorkerOnly,
      execute: async (args, context) => {
        try {
          const located = await authorizedWorker(options.store, stringArg(args.runId), context)
          const run = (await options.store.append(located.run.id, {
            expectedSeq: located.run.lastEventSeq,
            graphRevision: located.run.currentRevision,
            commandId: nextId('graph_worker'),
            idempotencyKey: `progress:${located.attempt.id}:${hash(JSON.stringify(args)).slice(0, 16)}`,
            event: {
              type: 'progress_reported',
              payload: {
                progress: {
                  version: GRAPH_CONTRACT_VERSION,
                  nodeId: located.nodeId,
                  attemptId: located.attempt.id,
                  ...(numberArg(args.percent) !== undefined
                    ? { percent: numberArg(args.percent) }
                    : {}),
                  summary: stringArg(args.summary).slice(0, 4_096),
                  ...(stringArg(args.phase)
                    ? { phase: stringArg(args.phase).slice(0, 128) }
                    : {}),
                  createdAt: nowIso()
                }
              }
            }
          })).state
          return { output: { accepted: true, runSeq: run.lastEventSeq } }
        } catch (error) {
          return { output: { error: errorMessage(error) }, isError: true }
        }
      }
    }),
    LocalToolHost.defineTool({
      name: GRAPH_WORKER_TOOL_NAMES[1],
      description:
        'Send a typed bounded Graph mailbox message. The host verifies worker identity, graph edges, recipients, artifacts, quotas, expiry, and deduplication.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: { type: 'string' },
          recipientNodeIds: { type: 'array', items: { type: 'string' } },
          toLead: { type: 'boolean' },
          type: {
            type: 'string',
            enum: ['handoff', 'finding', 'question', 'answer', 'warning', 'help']
          },
          priority: { type: 'string', enum: ['low', 'normal', 'high', 'blocking'] },
          summary: { type: 'string' },
          replyRequired: { type: 'boolean' },
          artifactIds: { type: 'array', items: { type: 'string' } }
        },
        required: ['runId', 'type', 'summary'],
        additionalProperties: false
      },
      policy: 'auto',
      toolKind: 'tool_call',
      sideEffect: 'unknown',
      shouldAdvertise: graphWorkerOnly,
      execute: async (args, context) => {
        try {
          const located = await authorizedWorker(options.store, stringArg(args.runId), context)
          const recipients = [
            ...stringArray(args.recipientNodeIds).map((nodeId) => ({
              kind: 'worker' as const,
              nodeId
            })),
            ...(args.toLead === true || stringArg(args.type) === 'help'
              ? [{ kind: 'lead' as const }]
              : [])
          ]
          if (!recipients.length) throw new Error('at least one recipient is required')
          const messageId = nextId('graph_message')
          const artifactIds = new Set(stringArray(args.artifactIds))
          const artifactRefs = located.run.artifacts.filter((artifact) =>
            artifactIds.has(artifact.artifactId))
          if (artifactRefs.length !== artifactIds.size) {
            throw new Error('one or more message artifacts are not authorized for this GraphRun')
          }
          const sent = await options.mailbox.send({
            id: messageId,
            runId: located.run.id,
            sender: {
              kind: 'worker',
              nodeId: located.nodeId,
              attemptId: located.attempt.id
            },
            recipients,
            type: stringArg(args.type) as 'handoff' | 'finding' | 'question' | 'answer' | 'warning' | 'help',
            priority: (stringArg(args.priority) || 'normal') as 'low' | 'normal' | 'high' | 'blocking',
            summary: stringArg(args.summary).slice(0, 4_096),
            artifactRefs,
            replyRequired: args.replyRequired === true
          }, {
            commandId: nextId('graph_worker'),
            idempotencyKey: `message:${located.attempt.id}:${hash(JSON.stringify(args)).slice(0, 16)}`
          })
          if (stringArg(args.type) === 'help') {
            await options.signalSupervision?.({
              runId: located.run.id,
              reason: 'help',
              nodeIds: [located.nodeId],
              digest: stringArg(args.summary)
            })
          }
          return { output: { message: sent.message, runSeq: sent.run.lastEventSeq } }
        } catch (error) {
          return { output: { error: errorMessage(error) }, isError: true }
        }
      }
    }),
    LocalToolHost.defineTool({
      name: GRAPH_WORKER_TOOL_NAMES[2],
      description:
        'Receive Graph mailbox messages addressed to this worker and optionally acknowledge messages already handled.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: { type: 'string' },
          acknowledgeMessageIds: { type: 'array', items: { type: 'string' } }
        },
        required: ['runId'],
        additionalProperties: false
      },
      policy: 'auto',
      toolKind: 'tool_call',
      sideEffect: 'read-only',
      shouldAdvertise: graphWorkerOnly,
      execute: async (args, context) => {
        try {
          const located = await authorizedWorker(options.store, stringArg(args.runId), context)
          let run = located.run
          const recipient = { kind: 'worker' as const, nodeId: located.nodeId }
          for (const messageId of stringArray(args.acknowledgeMessageIds)) {
            run = await options.mailbox.acknowledge(run.id, messageId, recipient, {
              commandId: nextId('graph_worker'),
              idempotencyKey: `message-ack:${located.attempt.id}:${messageId}`
            })
          }
          const received = await options.mailbox.receive(
            run.id,
            recipient,
            `worker_receive_${located.attempt.id}`
          )
          return {
            output: {
              messages: received.messages.map((message) => ({
                id: message.id,
                sender: message.sender,
                type: message.type,
                priority: message.priority,
                summary: message.summary,
                artifactRefs: message.artifactRefs,
                replyRequired: message.replyRequired,
                createdAt: message.createdAt,
                expiresAt: message.expiresAt
              })),
              runSeq: received.run.lastEventSeq
            }
          }
        } catch (error) {
          return { output: { error: errorMessage(error) }, isError: true }
        }
      }
    }),
    LocalToolHost.defineTool({
      name: GRAPH_WORKER_TOOL_NAMES[3],
      description:
        'Publish bounded worker output to the content-addressed ArtifactStore and GraphRun. ' +
        'Use this for evidence or outputs too large for the structured result.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: { type: 'string' },
          content: { type: 'string' },
          mimeType: { type: 'string' },
          summary: { type: 'string' },
          artifactNames: { type: 'array', items: { type: 'string' } },
          visibility: { type: 'string', enum: ['run', 'dependency', 'lead', 'user'] }
        },
        required: ['runId', 'content', 'mimeType', 'summary'],
        additionalProperties: false
      },
      policy: 'auto',
      toolKind: 'tool_call',
      sideEffect: 'unknown',
      shouldAdvertise: graphWorkerOnly,
      execute: async (args, context) => {
        try {
          const located = await authorizedWorker(options.store, stringArg(args.runId), context)
          const content = stringArg(args.content)
          const contentBytes = Buffer.byteLength(content, 'utf8')
          if (located.run.budget.artifactBytes + contentBytes >
              located.run.budget.limits.maxArtifactBytes) {
            throw new Error('Graph artifact budget would be exceeded')
          }
          const artifactNames = stringArray(args.artifactNames)
          const allowedNames = new Set(located.run.plans.at(-1)!.edges
            .flatMap((edge) =>
              edge.kind === 'data' && edge.from === located.nodeId
                ? [edge.artifactName]
                : []))
          const invalidName = artifactNames.find((name) => !allowedNames.has(name))
          if (invalidName) throw new Error(`undeclared Graph data artifact name: ${invalidName}`)
          const stored = await options.artifactStore.put({
            content,
            mimeType: stringArg(args.mimeType).slice(0, 256),
            source: 'other',
            origin: `graph-worker:${located.attempt.id}`,
            maxInlineChars: 2_048
          })
          const artifact: GraphArtifactReferenceV1 = {
            version: GRAPH_CONTRACT_VERSION,
            artifactId: stored.meta.id,
            contentHash: createHash('sha256').update(content).digest('hex'),
            mimeType: stored.meta.mimeType ?? stringArg(args.mimeType),
            byteLength: stored.meta.byteSize,
            summary: stringArg(args.summary).slice(0, 4_096),
            ...(artifactNames.length ? { logicalNames: artifactNames } : {}),
            producerNodeId: located.nodeId,
            producerAttemptId: located.attempt.id,
            visibility: (stringArg(args.visibility) || 'dependency') as GraphArtifactReferenceV1['visibility'],
            retention: 'run',
            createdAt: stored.meta.createdAt
          }
          let run = (await options.store.append(located.run.id, {
            expectedSeq: located.run.lastEventSeq,
            graphRevision: located.run.currentRevision,
            commandId: nextId('graph_worker'),
            idempotencyKey: `artifact:${located.attempt.id}:${artifact.contentHash}`,
            event: {
              type: 'artifact_published',
              payload: { artifact, consumerNodeIds: [] }
            }
          })).state
          run = (await options.store.append(run.id, {
            expectedSeq: run.lastEventSeq,
            graphRevision: run.currentRevision,
            commandId: nextId('graph_worker'),
            idempotencyKey: `artifact-budget:${located.attempt.id}:${artifact.contentHash}`,
            event: {
              type: 'budget_updated',
              payload: {
                ledger: {
                  ...run.budget,
                  artifactBytes: run.budget.artifactBytes + artifact.byteLength
                },
                reason: 'worker artifact published'
              }
            }
          })).state
          return { output: { artifact, runSeq: run.lastEventSeq } }
        } catch (error) {
          return { output: { error: errorMessage(error) }, isError: true }
        }
      }
    }),
    LocalToolHost.defineTool({
      name: GRAPH_WORKER_TOOL_NAMES[4],
      description:
        'Submit the structured Graph worker result for the attempt associated with this child session. ' +
        'The scheduler still owns validation, review, acceptance, retry, and completion.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: { type: 'string' },
          result: { type: 'object' }
        },
        required: ['runId', 'result'],
        additionalProperties: false
      },
      policy: 'auto',
      toolKind: 'tool_call',
      sideEffect: 'unknown',
      shouldAdvertise: graphWorkerOnly,
      execute: async (args, context) => {
        try {
          const located = await authorizedWorker(options.store, stringArg(args.runId), context)
          const parsed = GraphWorkerResultV1Schema.parse(args.result)
          const { verifiedChecks: _untrustedVerifiedChecks, ...workerReported } = parsed
          const result = {
            ...workerReported,
            reportedChecks: parsed.reportedChecks ?? parsed.checks ?? [],
            verifiedChecks: [],
            artifactRefs: canonicalWorkerArtifactRefs(
              located.run,
              located.nodeId,
              located.attempt.id,
              parsed.artifactRefs
            )
          }
          const run = (await options.store.append(located.run.id, {
            expectedSeq: located.run.lastEventSeq,
            graphRevision: located.run.currentRevision,
            commandId: nextId('graph_worker'),
            idempotencyKey: `worker-result:${located.attempt.id}`,
            event: {
              type: 'result_submitted',
              payload: {
                nodeId: located.nodeId,
                attemptId: located.attempt.id,
                result,
                validation: {
                  version: GRAPH_CONTRACT_VERSION,
                  valid: true,
                  issues: [],
                  normalizedNodeCount: 1,
                  normalizedEdgeCount: 0
                },
                tokenUsage: 0,
                elapsedMs: 0
              }
            }
          })).state
          await options.signalSupervision?.({
            runId: run.id,
            reason: 'submitted',
            nodeIds: [located.nodeId],
            digest: result.summary
          })
          return { output: { accepted: true, runSeq: run.lastEventSeq } }
        } catch (error) {
          return { output: { error: errorMessage(error) }, isError: true }
        }
      }
    })
  ]
}

export {
  GRAPH_DEFINE_PLAN_INPUT_JSON_SCHEMA,
  GraphDefinePlanInputSchema,
  GRAPH_LEAD_PATCH_INPUT_JSON_SCHEMA,
  GraphLeadPatchInputSchema
}

async function authorizedLead(
  store: GraphRunStore,
  registry: ProjectAgentRegistry,
  runId: string,
  context: ToolHostContext
): Promise<GraphRunV1> {
  const run = await store.get(runId)
  if (!run) throw new Error(`GraphRun not found: ${runId}`)
  if (run.threadId !== context.threadId || run.sourceTurnId !== context.turnId) {
    throw new Error('current Lead turn does not own this GraphRun')
  }
  const identity = await registry.identify(context.workspace)
  const planIdentity = await registry.identify(run.plans.at(-1)!.workspaceRoot)
  if (
    identity.projectId !== run.projectId ||
    identity.projectId !== planIdentity.projectId ||
    !graphPhysicalPathsEqual(
      identity.canonicalWorkspaceRoot,
      planIdentity.canonicalWorkspaceRoot
    )
  ) {
    throw new Error('current workspace does not own this GraphRun')
  }
  return run
}

async function authorizedWorker(
  store: GraphRunStore,
  runId: string,
  context: ToolHostContext
): Promise<{ run: GraphRunV1; nodeId: string; attempt: GraphNodeAttemptV1 }> {
  // Visibility is narrowed before execution; this durable lookup is the
  // authorization backstop and does not trust the model-supplied node id.
  const run = await store.get(runId)
  if (!run) throw new Error(`GraphRun not found: ${runId}`)
  for (const [nodeId, node] of Object.entries(run.nodes)) {
    const attempt = node.attempts.find((entry) => entry.childThreadId === context.threadId)
    if (!attempt) continue
    if (!['running', 'waiting', 'submitted'].includes(attempt.status)) {
      throw new Error(`Graph worker attempt is not active: ${attempt.status}`)
    }
    return { run, nodeId, attempt }
  }
  throw new Error('current child session is not authorized for this GraphRun')
}

function stringArg(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberArg(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : []
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_048)
}
