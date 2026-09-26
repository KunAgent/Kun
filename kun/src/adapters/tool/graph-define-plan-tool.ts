import { z } from 'zod'
import {
  GraphPlanningDraftViewV1Schema,
  type GraphPlanningDraftV1,
  type GraphPlanningIssueV1
} from '../../contracts/graph.js'
import {
  DEFAULT_GRAPH_RUNTIME_CONFIG,
  type GraphRuntimeConfig
} from '../../config/kun-config.js'
import {
  compileGraphPlanIntentV2,
  GraphPlanIntentV2Schema,
  GraphPlanValidationError,
  GraphPlanningDraftConflictError,
  type FileGraphPlanningDraftStore,
  type GraphControlService,
  type ProjectAgentRegistry
} from '../../graph/index.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import { isHostShutdownTurnSuspension } from '../../services/turn-service.js'
import {
  isUnresolvedRawToolArgumentsEnvelope,
  normalizeRawToolArgumentsEnvelope
} from '../../domain/tool-argument-envelope.js'
import { graphCreateBudgetDefaults } from './graph-create-run-tool.js'
import {
  checkGraphPlanHarnesses,
  type GraphPlanHarnessAdmission
} from './graph-plan-admission.js'
import { restoreMissingTaskTitles } from './graph-plan-candidate-repair.js'
import {
  MINIMAL_VALID_PLAN_EXAMPLE,
  PlanningExecutionAbortedError,
  assertPlanningExecutionActive,
  cancelCreatedRun,
  errorMessage,
  hashCandidate,
  hashIncompleteToolArguments,
  hostPlanningIssue,
  planningError,
  planningEventForStatus,
  planningRunSummary,
  taskSummaries,
  toPlanningIssue
} from './graph-define-plan-support.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'

export const GRAPH_DEFINE_PLAN_TOOL_NAME = 'graph_define_plan'

export const GraphDefinePlanInputSchema = z.object({
  plan: GraphPlanIntentV2Schema.describe(
    'A small task graph. Use only task keys, purpose, dependencies, acceptance criteria, and repository-relative scopes; the host supplies all execution mechanics.'
  )
}).strict()

export const GRAPH_DEFINE_PLAN_INPUT_JSON_SCHEMA = (() => {
  const schema = z.toJSONSchema(GraphDefinePlanInputSchema, {
    io: 'input',
    target: 'draft-07',
    reused: 'inline'
  }) as Record<string, unknown>
  delete schema.$schema
  return schema
})()


export function buildGraphDefinePlanTool(options: {
  control: GraphControlService
  drafts: FileGraphPlanningDraftStore
  registry: ProjectAgentRegistry
  events: Pick<RuntimeEventRecorder, 'record'>
  shouldAdvertise: (context: ToolHostContext) => boolean
  nowIso: () => string
  nextId: (prefix: string) => string
  config?: () => GraphRuntimeConfig
  /** Late-bound harness services for per-node admission (P1-25). */
  harnesses?: () => GraphPlanHarnessAdmission | undefined
}): LocalTool {
  return LocalToolHost.defineTool({
    name: GRAPH_DEFINE_PLAN_TOOL_NAME,
    description: [
      'Validate and commit the durable planning draft that already belongs to this Graph turn.',
      'First inspect the repository with read-only tools. Then submit focused tasks using only the advertised fields.',
      'dependsOn creates a control dependency; dataFrom names an accepted predecessor result consumed by this task.',
      'Every scope is repository-relative. Use "." for the repository root and an empty writeScopes array for read-only work.',
      'Ordinary work/review/integration tasks never contain loop. Only kind "loop_gate" contains the required bounded loop object.',
      'The host owns run identity, phases, strategy, budgets, model/provider routing, retries, timeouts, reviews, revisions, workspace, and timestamps.',
      'Call this as a structured tool with only a top-level plan object. Never use __raw, a JSON string, a Markdown code fence, or ordinary prose for the arguments.',
      `Minimal valid call: ${JSON.stringify(MINIMAL_VALID_PLAN_EXAMPLE)}`,
      'If validation returns issues, change the exact paths once. Never repeat unchanged invalid arguments and never claim a GraphRun exists until this tool returns committed.'
    ].join(' '),
    inputSchema: GRAPH_DEFINE_PLAN_INPUT_JSON_SCHEMA,
    policy: 'auto',
    toolKind: 'tool_call',
    sideEffect: 'unknown',
    shouldAdvertise: options.shouldAdvertise,
    execute: async (args, context) => {
      let draft: GraphPlanningDraftV1 | null = null
      let createdRunId: string | undefined
      try {
        assertPlanningExecutionActive(context)
        draft = await options.drafts.findBySourceTurn(context.turnId)
        if (!draft || draft.threadId !== context.threadId) {
          return planningError(
            'graph_planning_draft_missing',
            'This Graph turn has no durable planning draft.',
            [],
            false
          )
        }
        if (draft.status === 'committed' && draft.committedRunId) {
          let run = await options.control.get(draft.committedRunId)
          if (run.status === 'ready') {
            run = await options.control.start(run.id, {
              commandId: options.nextId('graph_plan_start'),
              idempotencyKey: `graph-plan-start:${draft.sourceTurnId}`
            })
          }
          return {
            output: {
              status: 'committed',
              draft,
              run: planningRunSummary(run)
            }
          }
        }
        if (draft.status === 'cancelled' || draft.status === 'host_error') {
          return planningError(
            'graph_planning_draft_inactive',
            `The planning draft is ${draft.status}.`,
            draft.issues,
            false
          )
        }

        const normalizedArgs = normalizeRawToolArgumentsEnvelope(args)
        const unresolvedRaw = isUnresolvedRawToolArgumentsEnvelope(normalizedArgs)
          ? normalizedArgs.__raw
          : undefined
        const submittedCandidate = 'plan' in normalizedArgs
          ? normalizedArgs.plan
          : undefined
        const previousCandidate = await options.drafts.readCandidate(draft.id)
        const candidate = restoreMissingTaskTitles(
          submittedCandidate,
          previousCandidate
        )
        const effectiveArgs = { ...normalizedArgs, plan: candidate }
        const candidateHash = typeof unresolvedRaw === 'string'
          ? hashIncompleteToolArguments(unresolvedRaw)
          : hashCandidate(candidate)
        if (draft.candidateHash === candidateHash && draft.issues.length > 0) {
          draft = await transitionDraft(options, draft, {
            status: 'needs_correction',
            candidateHash,
            issues: draft.issues,
            repairCount: draft.repairCount
          })
          return planningError(
            'unchanged_invalid_plan',
            'The submitted plan is identical to the previous invalid plan. The draft is waiting for user correction.',
            draft.issues,
            false,
            draft
          )
        }

        if (typeof unresolvedRaw !== 'string') {
          await options.drafts.writeCandidate(draft.id, candidate)
        }
        assertPlanningExecutionActive(context)
        draft = await transitionDraft(options, draft, {
          status: 'validating',
          candidateHash,
          issues: []
        })
        if (typeof unresolvedRaw === 'string') {
          return recordIncompleteToolArguments(
            options,
            draft,
            candidateHash,
            Buffer.byteLength(unresolvedRaw, 'utf8')
          )
        }
        const parsed = GraphDefinePlanInputSchema.safeParse(effectiveArgs)
        if (!parsed.success) {
          return recordInvalidCandidate(options, draft, candidateHash, parsed.error.issues)
        }

        const identity = await options.registry.identify(context.workspace)
        const config = options.config?.() ?? DEFAULT_GRAPH_RUNTIME_CONFIG
        let plan
        try {
          plan = compileGraphPlanIntentV2({
            intent: parsed.data.plan,
            goal: draft.goal,
            workspaceRoot: identity.canonicalWorkspaceRoot,
            nowIso: options.nowIso(),
            budgetDefaults: graphCreateBudgetDefaults(config),
            config
          })
        } catch (error) {
          if (error instanceof z.ZodError) {
            return recordInvalidCandidate(options, draft, candidateHash, error.issues)
          }
          throw error
        }

        const harnessAdmission = options.harnesses?.()
        if (harnessAdmission) {
          const harnessIssues = await checkGraphPlanHarnesses({
            plan,
            admission: harnessAdmission,
            isolation: config.writeIsolation
          })
          if (harnessIssues.length > 0) {
            return recordInvalidPlanningIssues(
              options,
              draft,
              candidateHash,
              harnessIssues
            )
          }
        }

        await options.drafts.writeCommitPlan(draft.id, plan)
        assertPlanningExecutionActive(context)
        draft = await transitionDraft(options, draft, {
          status: 'committing',
          candidateHash,
          issues: []
        })
        assertPlanningExecutionActive(context)
        const created = await options.control.create({
          runId: draft.reservedRunId,
          threadId: draft.threadId,
          projectId: draft.projectId,
          sourceTurnId: draft.sourceTurnId,
          plan,
          commandId: options.nextId('graph_plan_commit'),
          idempotencyKey: `graph-plan-commit:${draft.sourceTurnId}`,
          // The draft commit is the linearization point. Keep the run paused
          // until that CAS wins so Stop can never miss a newly active run.
          start: false
        })
        createdRunId = created.run.id
        const latestBeforeCommit = await options.drafts.require(draft.id)
        if (
          latestBeforeCommit.status === 'cancelled' ||
          latestBeforeCommit.status === 'host_error'
        ) {
          await cancelCreatedRun(options, createdRunId, draft.sourceTurnId)
          return planningError(
            'graph_planning_aborted',
            'Graph planning was cancelled before the run could be committed.',
            latestBeforeCommit.issues,
            false,
            latestBeforeCommit
          )
        }
        if (context.abortSignal.aborted) {
          return planningError(
            'graph_planning_interrupted',
            'Graph planning was interrupted while its recoverable commit was being prepared.',
            latestBeforeCommit.issues,
            false,
            latestBeforeCommit
          )
        }
        if (
          latestBeforeCommit.status === 'committed' &&
          latestBeforeCommit.committedRunId === createdRunId
        ) {
          const run = await options.control.get(createdRunId)
          return {
            output: {
              status: 'committed',
              draft: latestBeforeCommit,
              run: planningRunSummary(run)
            }
          }
        }
        if (
          latestBeforeCommit.status !== 'committing' ||
          latestBeforeCommit.revision !== draft.revision
        ) {
          throw new GraphPlanningDraftConflictError(
            `draft ${draft.id} changed while GraphRun ${createdRunId} was being prepared`
          )
        }
        draft = await transitionDraft(options, draft, {
          status: 'committed',
          candidateHash,
          issues: [],
          committedRunId: createdRunId
        })
        if (
          context.abortSignal.aborted &&
          !isHostShutdownTurnSuspension(context.abortSignal)
        ) {
          return planningError(
            'graph_planning_aborted',
            'Graph planning was cancelled before the committed run could start.',
            draft.issues,
            false,
            draft
          )
        }
        const run = await options.control.start(createdRunId, {
          commandId: options.nextId('graph_plan_start'),
          idempotencyKey: `graph-plan-start:${draft.sourceTurnId}`
        })
        if (context.abortSignal.aborted) {
          return planningError(
            'graph_planning_aborted',
            'Graph planning was cancelled while the committed run was starting.',
            draft.issues,
            false,
            draft
          )
        }
        return {
          output: {
              status: 'committed',
              draft,
              run: planningRunSummary(run),
              validation: created.validation,
            nextAction:
              'Inspect the running Graph, supervise submitted worker results, and explicitly accept or request repair before delivering the final answer.'
          }
        }
      } catch (error) {
        let failure = error
        let latestDraft = draft
          ? await options.drafts.get(draft.id).catch(() => null)
          : await options.drafts.findBySourceTurn(context.turnId).catch(() => null)
        const durableRunId =
          latestDraft?.committedRunId ??
          latestDraft?.reservedRunId ??
          createdRunId
        let durableRun = durableRunId
          ? await options.control.get(durableRunId).catch(() => null)
          : null
        if (
          durableRun &&
          (
            latestDraft?.status === 'cancelled' ||
            latestDraft?.status === 'host_error' ||
            error instanceof PlanningExecutionAbortedError
          )
        ) {
          await cancelCreatedRun(
            options,
            durableRun.id,
            latestDraft?.sourceTurnId ?? context.turnId
          ).catch(() => undefined)
          durableRun = await options.control.get(durableRun.id).catch(() => durableRun)
        }
        if (durableRun?.status === 'cancelled') {
          return planningError(
            'graph_planning_aborted',
            'Graph planning was cancelled before the run could start.',
            latestDraft?.issues ?? [],
            false,
            latestDraft ?? draft ?? undefined
          )
        }
        if (
          latestDraft?.status === 'committing' &&
          durableRun &&
          !context.abortSignal.aborted
        ) {
          try {
            latestDraft = await transitionDraft(options, latestDraft, {
              status: 'committed',
              ...(latestDraft.candidateHash
                ? { candidateHash: latestDraft.candidateHash }
                : {}),
              issues: [],
              committedRunId: durableRun.id
            })
          } catch (commitError) {
            failure = commitError
            latestDraft = await options.drafts.get(latestDraft.id).catch(() => latestDraft)
          }
        }
        if (
          latestDraft?.status === 'committed' &&
          durableRun &&
          !context.abortSignal.aborted
        ) {
          if (durableRun.status === 'ready') {
            const runBeforeStart = durableRun
            try {
              durableRun = await options.control.start(durableRun.id, {
                commandId: options.nextId('graph_plan_start'),
                idempotencyKey: `graph-plan-start:${latestDraft.sourceTurnId}`
              })
            } catch (startError) {
              failure = startError
              durableRun =
                await options.control.get(runBeforeStart.id).catch(() => null) ??
                runBeforeStart
            }
          }
          if (durableRun.status === 'cancelled') {
            return planningError(
              'graph_planning_aborted',
              'Graph planning was cancelled while the committed run was starting.',
              latestDraft.issues,
              false,
              latestDraft
            )
          }
          if (durableRun.status !== 'ready') {
            return {
              output: {
                status: 'committed',
                draft: latestDraft,
                run: planningRunSummary(durableRun)
              }
            }
          }
        }
        if (context.abortSignal.aborted) {
          return planningError(
            isHostShutdownTurnSuspension(context.abortSignal)
              ? 'graph_planning_interrupted'
              : 'graph_planning_aborted',
            'Graph planning execution stopped before this tool call could finish.',
            latestDraft?.issues ?? [],
            false,
            latestDraft ?? draft ?? undefined
          )
        }
        if (
          error instanceof PlanningExecutionAbortedError ||
          latestDraft?.status === 'cancelled'
        ) {
          return planningError(
            'graph_planning_aborted',
            'Graph planning was cancelled before the run could start.',
            latestDraft?.issues ?? [],
            false,
            latestDraft ?? draft ?? undefined
          )
        }
        if (error instanceof GraphPlanValidationError && draft) {
          return recordInvalidCandidate(
            options,
            draft,
            draft.candidateHash ?? hashCandidate(args),
            error.result.issues
          )
        }
        if (error instanceof GraphPlanningDraftConflictError) {
          return planningError(
            'graph_planning_revision_conflict',
            error.message,
            [],
            true
          )
        }
        const hostIssue = hostPlanningIssue()
        if (
          latestDraft &&
          latestDraft.status !== 'committed' &&
          latestDraft.status !== 'host_error'
        ) {
          draft = await transitionDraft(options, latestDraft, {
            status: 'host_error',
            issues: [hostIssue]
          }).catch(() => latestDraft)
        }
        return planningError(
          'graph_planning_host_error',
          'Graph planning could not persist or commit the draft because the host encountered an error.',
          [hostIssue],
          false,
          draft ?? latestDraft ?? undefined
        )
      }
    }
  })
}

async function recordInvalidCandidate(
  options: Parameters<typeof buildGraphDefinePlanTool>[0],
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

async function recordIncompleteToolArguments(
  options: Parameters<typeof buildGraphDefinePlanTool>[0],
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

async function recordInvalidPlanningIssues(
  options: Parameters<typeof buildGraphDefinePlanTool>[0],
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

async function transitionDraft(
  options: Pick<
    Parameters<typeof buildGraphDefinePlanTool>[0],
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
    Parameters<typeof buildGraphDefinePlanTool>[0],
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
