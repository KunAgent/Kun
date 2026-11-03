import {
  GraphPlanningDraftViewV1Schema,
  type GraphPlanningDraftV1,
  type GraphPlanningIssueV1
} from '../../contracts/graph.js'
import type { GraphRuntimeConfig } from '../../config/kun-config.js'
import type {
  FileGraphPlanningDraftStore,
  GraphControlService,
  ProjectAgentRegistry
} from '../../graph/index.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import type { GraphPlanHarnessAdmission } from './graph-plan-admission.js'
import {
  MINIMAL_VALID_PLAN_EXAMPLE,
  errorMessage,
  planningError,
  planningEventForStatus,
  taskSummaries,
  toPlanningIssue
} from './graph-define-plan-support.js'

export type GraphDefinePlanToolOptions = {
  control: GraphControlService
  drafts: FileGraphPlanningDraftStore
  registry: ProjectAgentRegistry
  events: Pick<RuntimeEventRecorder, 'record'>
  shouldAdvertise: (context: ToolHostContext) => boolean
  nowIso: () => string
  nextId: (prefix: string) => string
  config?: () => GraphRuntimeConfig
  /** Late-bound harness services for per-node admission. */
  harnesses?: () => GraphPlanHarnessAdmission | undefined
}

export async function recordInvalidCandidate(
  options: GraphDefinePlanToolOptions,
  draft: GraphPlanningDraftV1,
  candidateHash: string,
  rawIssues: readonly {
    code?: unknown
    path?: readonly PropertyKey[]
    message?: unknown
  }[]
): Promise<{ output: Record<string, unknown>; isError: true }> {
  const issues = rawIssues.slice(0, 64).map((issue) =>
    toPlanningIssue(issue, issue.path ?? []))
  return recordInvalidPlanningIssues(options, draft, candidateHash, issues)
}

export async function recordIncompleteToolArguments(
  options: GraphDefinePlanToolOptions,
  draft: GraphPlanningDraftV1,
  candidateHash: string,
  rawBytes: number
): Promise<{ output: Record<string, unknown>; isError: true }> {
  const issue: GraphPlanningIssueV1 = {
    code: 'incomplete_tool_arguments',
    path: ['plan'],
    message: [
      `The graph_define_plan arguments were not a complete structured JSON object (${rawBytes} UTF-8 bytes).`,
      'This usually means the model output limit truncated the arguments or the complete plan was wrapped as a string.'
    ].join(' '),
    repairHint: [
      'Call graph_define_plan once more with a smaller direct { plan: ... } object.',
      'Shorten titles, objectives, and acceptance criteria; remove repeated background; and never use __raw, a JSON string, a Markdown code fence, or ordinary prose.'
    ].join(' '),
    validExample: MINIMAL_VALID_PLAN_EXAMPLE
  }
  return recordInvalidPlanningIssues(options, draft, candidateHash, [issue], {
    first: 'Graph plan arguments are incomplete. Retry once with a smaller structured plan.',
    subsequent:
      'The corrected Graph plan arguments are still incomplete. The draft is waiting for user correction.'
  })
}

export async function recordInvalidPlanningIssues(
  options: GraphDefinePlanToolOptions,
  draft: GraphPlanningDraftV1,
  candidateHash: string,
  issues: readonly GraphPlanningIssueV1[],
  messages: {
    first: string
    subsequent: string
  } = {
    first: 'The plan is invalid. Change every listed path and submit one corrected plan.',
    subsequent: 'The corrected plan is still invalid. The draft is waiting for user correction.'
  }
): Promise<{ output: Record<string, unknown>; isError: true }> {
  const firstRepair = draft.repairCount === 0
  const next = await transitionDraft(options, draft, {
    status: firstRepair ? 'repairing' : 'needs_correction',
    candidateHash,
    issues: [...issues],
    repairCount: firstRepair ? 1 : draft.repairCount
  })
  return planningError(
    firstRepair ? 'graph_plan_invalid' : 'graph_plan_needs_correction',
    firstRepair ? messages.first : messages.subsequent,
    issues,
    firstRepair,
    next
  )
}

export async function transitionDraft(
  options: Pick<
    GraphDefinePlanToolOptions,
    'drafts' | 'events'
  >,
  draft: GraphPlanningDraftV1,
  patch: Omit<
    Parameters<FileGraphPlanningDraftStore['update']>[1],
    'expectedRevision'
  >
): Promise<GraphPlanningDraftV1> {
  const next = await options.drafts.update(draft.id, {
    ...patch,
    expectedRevision: draft.revision
  })
  await emitPlanningEvent(options, next).catch((error) => {
    console.warn(
      `[kun] Graph planning event delivery failed after durable revision ` +
      `${next.id}@${next.revision}: ${errorMessage(error)}`
    )
  })
  return next
}

export async function emitPlanningEvent(
  options: Pick<
    GraphDefinePlanToolOptions,
    'drafts' | 'events'
  >,
  draft: GraphPlanningDraftV1,
  event = planningEventForStatus(draft.status)
): Promise<void> {
  const candidate = await options.drafts.readCandidate(draft.id)
  const tasks = taskSummaries(candidate)
  const view = GraphPlanningDraftViewV1Schema.parse({ draft, tasks })
  await options.events.record({
    kind: 'graph_planning',
    threadId: draft.threadId,
    turnId: draft.sourceTurnId,
    planning: {
      version: 1,
      event,
      draftId: draft.id,
      reservedRunId: draft.reservedRunId,
      sourceTurnId: draft.sourceTurnId,
      revision: draft.revision,
      state: draft.status,
      issues: draft.issues,
      tasks: view.tasks,
      ...(draft.committedRunId ? { committedRunId: draft.committedRunId } : {})
    }
  })
}
