import { z } from 'zod'
import type { ArtifactStore } from '../../artifacts/artifact-store.js'
import {
  GRAPH_CONTRACT_VERSION,
  GraphBudgetV1InputSchema,
  GraphPlanV1Schema,
  type GraphPlanV1
} from '../../contracts/index.js'
import {
  DEFAULT_GRAPH_RUNTIME_CONFIG,
  type GraphRuntimeConfig
} from '../../config/kun-config.js'
import {
  compileGraphIntent,
  GraphIntentSchema,
  GraphPlanValidationError,
  type GraphControlService,
  type ProjectAgentRegistry
} from '../../graph/index.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import type { GraphPlanHarnessAdmission } from './graph-plan-admission.js'
import { resolveGraphPlanRoles } from './graph-plan-roles.js'

const MAX_GRAPH_CREATE_RUN_ISSUES = 64

const GraphCreateBudgetInputSchema = GraphBudgetV1InputSchema
  .partial()
  .describe(
    'Optional narrower Graph limits. Omit this object or individual fields unless the user or project intentionally requires a narrower value; the host supplies all omitted mechanical defaults.'
  )

export const GraphCreateRunPlanInputSchema = GraphPlanV1Schema.omit({
  version: true,
  revision: true,
  workspaceRoot: true,
  autoStart: true,
  createdBy: true,
  createdAt: true,
  budget: true
}).extend({
  budget: GraphCreateBudgetInputSchema.optional()
}).describe(
  'Model-authored Graph plan. The host supplies version, revision, workspaceRoot, autoStart, createdBy, and createdAt.'
)

export const GraphCreateRunInputSchema = z.object({
  intent: GraphIntentSchema.describe(
    'Focused task intent. Declare meaningful tasks and only real dependencies; the host compiles durable Graph fields.'
  ),
  start: z.boolean().default(true).describe(
    'Start the GraphRun immediately after validation. Defaults to true.'
  )
}).strict()

export const GraphCreateRunLegacyInputSchema = z.object({
  plan: GraphCreateRunPlanInputSchema,
  start: z.boolean().default(true).describe(
    'Start the GraphRun immediately after validation. Defaults to true.'
  )
}).strict()

export const GRAPH_CREATE_RUN_INPUT_JSON_SCHEMA = (() => {
  const schema = z.toJSONSchema(GraphCreateRunInputSchema, {
    io: 'input',
    // Model providers accept JSON Schema, where exclusive bounds are numeric.
    // OpenAPI 3.0 emits the legacy boolean form (`exclusiveMinimum: true`),
    // which the OpenAI Responses API rejects before the model can run.
    target: 'draft-07',
    reused: 'inline'
  }) as Record<string, unknown>
  // Function-tool parameter objects are embedded schemas, not standalone
  // documents. Keep the dialect marker out of every provider wire format.
  delete schema.$schema
  return schema
})()

export function buildGraphCreateRunTool(options: {
  control: GraphControlService
  registry: ProjectAgentRegistry
  shouldAdvertise: (context: ToolHostContext) => boolean
  nowIso: () => string
  nextId: (prefix: string) => string
  config?: () => GraphRuntimeConfig
  /** Late-bound harness services; carries the agent roster for task roles. */
  harnesses?: () => GraphPlanHarnessAdmission | undefined
}): LocalTool {
  return LocalToolHost.defineTool({
    name: 'graph_create_run',
    description:
      'Create and start a durable GraphRun from a lightweight task intent. Choose auto, fanout_join, pipeline, bounded_loop, state_machine, or hybrid from the real dependency structure. ' +
      'Provide focused tasks, explicit dependencies only when a successor consumes a predecessor outcome, acceptance criteria, and repository-relative scopes; the host compiles phases, nodes, edges, completion/review defaults, identity, provenance, revision, timestamps, and budgets. ' +
      'Omit the budget or any individual budget field unless the user or project explicitly asks for a narrower limit; the host supplies all omitted defaults, including seven days per run, 24 hours per node, and the warning ratio. ' +
      'Use normalized repository-relative read/write scopes, never absolute workspace paths. ' +
      'For non-trivial work, create focused independently verifiable nodes and expose a broad safe ready frontier: split independent concerns, subsystems, scopes, and validation tracks into siblings, and add an edge only when its successor truly requires that accepted outcome or result packet. Do not put a whole multi-concern feature into one executor. ' +
      'Independent tasks run concurrently; dependsOn and dataFrom create serial handoffs. Executors may proactively report progress, findings, questions, risks, and early results, but every node still waits for explicit source Lead review before its accepted result reaches successors. ' +
      'Create exactly one successful GraphRun for a Graph-mode user turn; retry only when a structured tool result explicitly says the failure is retryable. The host validates all authority and graph invariants.',
    inputSchema: GRAPH_CREATE_RUN_INPUT_JSON_SCHEMA,
    policy: 'auto',
    toolKind: 'tool_call',
    sideEffect: 'unknown',
    shouldAdvertise: options.shouldAdvertise,
    execute: async (args, context) => {
      const parsedIntent = GraphCreateRunInputSchema.safeParse(args)
      const parsedLegacy = GraphCreateRunLegacyInputSchema.safeParse(args)
      if (!parsedIntent.success && !parsedLegacy.success) {
        const legacyShape = typeof args === 'object' && args !== null && 'plan' in args
        return graphCreateRunError({
          code: 'graph_create_run_schema_invalid',
          error: 'Graph creation arguments do not match the advertised schema.',
          issues: legacyShape ? parsedLegacy.error.issues : parsedIntent.error.issues,
          guidance:
            'Correct the listed fields against the graph_create_run schema (lightweight intent) and retry without invented host fields.',
          retryable: true
        })
      }
      try {
        const identity = await options.registry.identify(context.workspace)
        const runtimeConfig = options.config?.() ?? DEFAULT_GRAPH_RUNTIME_CONFIG
        const budgetDefaults = graphCreateBudgetDefaults(runtimeConfig)
        const legacy = parsedLegacy.success ? parsedLegacy.data : undefined
        const start = parsedIntent.success ? parsedIntent.data.start : legacy!.start
        const modelBudget = parsedIntent.success
          ? parsedIntent.data.intent.budget ?? {}
          : legacy!.plan.budget ?? {}
        const roles = parsedIntent.success
          ? await resolveGraphPlanRoles({
              tasks: parsedIntent.data.intent.tasks,
              roster: options.harnesses?.()?.roster,
              workspace: context.workspace,
              ...(context.agentSurface ? { surface: context.agentSurface } : {}),
              tasksPath: ['intent', 'tasks']
            })
          : undefined
        if (roles?.issues.length) {
          return graphCreateRunError({
            code: 'graph_create_run_validation_failed',
            error: 'A task profile cannot run as a Graph executor.',
            issues: roles.issues.map((issue) => ({ code: issue.code, path: issue.path, message: issue.message })),
            guidance: roles.issues[0]!.repairHint,
            retryable: true
          })
        }
        const plan = parsedIntent.success
          ? compileGraphIntent({
              intent: parsedIntent.data.intent,
              workspaceRoot: identity.canonicalWorkspaceRoot,
              start,
              nowIso: options.nowIso(),
              budgetDefaults,
              config: runtimeConfig,
              ...(roles ? { roles: roles.roles } : {})
            })
          : GraphPlanV1Schema.parse({
              ...legacy!.plan,
              budget: {
                ...budgetDefaults,
                ...modelBudget
              },
              version: GRAPH_CONTRACT_VERSION,
              revision: 1,
              workspaceRoot: identity.canonicalWorkspaceRoot,
              autoStart: start,
              createdBy: 'lead',
              createdAt: options.nowIso()
            })
        const runId = options.control.allocateId('graph_run')
        const result = await options.control.create({
          runId,
          threadId: context.threadId,
          projectId: identity.projectId,
          sourceTurnId: context.turnId,
          plan,
          commandId: options.nextId('graph_command'),
          idempotencyKey: `graph-create:${context.turnId}`,
          start
        })
        const executionShape = initialExecutionShape(plan, runtimeConfig)
        return {
          output: {
            run: result.run,
            validation: result.validation,
            executionShape,
            appliedBudgetDefaultFields: Object.keys(budgetDefaults).filter((field) =>
              modelBudget[field as keyof typeof modelBudget] === undefined),
            appliedWallTimeDefaults: {
              run: modelBudget.maxWallTimeMs === undefined
                ? budgetDefaults.maxWallTimeMs
                : null,
              node: modelBudget.maxNodeWallTimeMs === undefined
                ? budgetDefaults.maxNodeWallTimeMs
                : null
            },
            nextAction:
              'The Lead remains responsible after dispatch. Use executionShape to confirm the graph exposes the intended safe concurrency, inspect active executors with graph_supervise_node, wait and recheck at a risk-appropriate cadence, guide drift, and explicitly pass or revise every completed node with graph_review_node before any successor receives its result.'
          }
        }
      } catch (error) {
        if (error instanceof GraphPlanValidationError) {
          return graphCreateRunError({
            code: 'graph_create_run_validation_failed',
            error: 'Graph plan validation failed.',
            issues: error.result.issues,
            guidance:
              'Correct the listed graph invariants and retry graph_create_run with the advertised schema.',
            retryable: true
          })
        }
        return graphCreateRunError({
          code: 'graph_create_run_failed',
          error: errorMessage(error),
          guidance:
            'Graph creation failed outside model-correctable validation. Do not retry the same call.',
          retryable: false
        })
      }
    }
  })
}

function initialExecutionShape(plan: GraphPlanV1, config: GraphRuntimeConfig) {
  const dependencyTargets = new Set(plan.edges
    .filter((edge) => edge.kind !== 'message')
    .map((edge) => edge.to))
  const initialExecutableNodeIds = plan.nodes
    .filter((node) => node.kind !== 'loop_gate' && !dependencyTargets.has(node.id))
    .sort((left, right) =>
      right.priority - left.priority || left.id.localeCompare(right.id))
    .map((node) => node.id)
  const effectivePerRunConcurrency = Math.min(
    plan.budget.maxConcurrentNodes,
    config.scheduler.maxConcurrentNodesPerRun,
    config.scheduler.maxConcurrentNodes
  )
  const maximumImmediateDispatchCount = Math.min(
    initialExecutableNodeIds.length,
    effectivePerRunConcurrency
  )
  const executableNodeCount = plan.nodes.filter((node) => node.kind !== 'loop_gate').length
  return {
    strategy: plan.strategy?.kind ?? inferLegacyStrategy(plan),
    initialExecutableNodeIds,
    initialExecutableNodeCount: initialExecutableNodeIds.length,
    effectivePerRunConcurrency,
    maximumImmediateDispatchCount,
    ...(executableNodeCount >= 3 && maximumImmediateDispatchCount <= 1
      ? {
          diagnostic:
            'This non-trivial graph currently exposes only one immediate worker. Preserve real dependencies, but split independent concerns into sibling ready nodes in future Graph plans so configured concurrency can be used.'
        }
      : {})
  }
}

function inferLegacyStrategy(plan: GraphPlanV1) {
  if (plan.nodes.some((node) => node.kind === 'loop_gate')) return 'bounded_loop'
  const schedulingEdges = plan.edges.filter((edge) => edge.kind !== 'message')
  if (plan.nodes.length <= 1) return 'pipeline'
  if (!schedulingEdges.length) return 'fanout_join'
  const incoming = new Map(plan.nodes.map((node) => [node.id, [] as string[]]))
  for (const edge of schedulingEdges) incoming.get(edge.to)?.push(edge.from)
  const linear = plan.nodes.every((node, index) => {
    const sources = incoming.get(node.id) ?? []
    return index === 0
      ? sources.length === 0
      : sources.length === 1 && sources[0] === plan.nodes[index - 1]!.id
  })
  return linear ? 'pipeline' : 'hybrid'
}

export function graphCreateBudgetDefaults(config: GraphRuntimeConfig) {
  return {
    maxNodes: config.scheduler.maxNodes,
    maxEdges: config.scheduler.maxEdges,
    maxConcurrentNodes: config.scheduler.maxConcurrentNodesPerRun,
    maxAttemptsPerNode: config.scheduler.maxAttemptsPerNode,
    maxRevisions: config.scheduler.maxRevisions,
    maxLoopIterations: config.scheduler.maxLoopIterations,
    maxWallTimeMs: config.scheduler.maxRunWallTimeMs,
    maxNodeWallTimeMs: config.scheduler.maxNodeWallTimeMs,
    maxMessages: config.mailbox.maxMessagesPerRun,
    maxArtifactBytes: config.scheduler.maxArtifactBytes,
    warningRatio: config.scheduler.budgetWarningRatio
  }
}

type GraphCreateRunIssueLike = {
  path: readonly PropertyKey[]
  code: string
  message: string
}

function graphCreateRunError(input: {
  code:
    | 'graph_create_run_schema_invalid'
    | 'graph_create_run_validation_failed'
    | 'graph_create_run_failed'
  error: string
  issues?: readonly GraphCreateRunIssueLike[]
  guidance: string
  retryable: boolean
}): { output: Record<string, unknown>; isError: true } {
  const issues = input.issues?.slice(0, MAX_GRAPH_CREATE_RUN_ISSUES).map((issue) => ({
    path: issue.path
      .filter((part): part is string | number =>
        typeof part === 'string' || typeof part === 'number')
      .slice(0, 32),
    code: issue.code.slice(0, 128),
    message: issue.message.slice(0, 2_048)
  }))
  return {
    output: {
      code: input.code,
      error: input.error.slice(0, 2_048),
      ...(issues?.length ? { issues } : {}),
      guidance: input.guidance.slice(0, 2_048),
      retryable: input.retryable
    },
    isError: true
  }
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_048)
}
