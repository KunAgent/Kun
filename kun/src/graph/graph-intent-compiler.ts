import { HarnessGatewayBindingSchema } from '../contracts/harness-gateway-binding.js'
import { z } from 'zod'
import type { GraphRuntimeConfig } from '../config/kun-config.js'
import {
  GRAPH_CONTRACT_VERSION,
  GraphBudgetV1InputSchema,
  GraphExecutionStrategyKindSchema,
  GraphIdentifierSchema,
  GraphPlanV1Schema,
  GraphRelativePathSchema,
  type GraphExecutionStrategyKind,
  type GraphPlanV1
} from '../contracts/graph.js'
import { ModelReasoningEffort } from '../contracts/capabilities.js'
import { HarnessCredentialModeSchema, HarnessIdSchema } from '../contracts/harness.js'

export const GraphIntentStrategySchema = z.union([
  z.literal('auto'),
  GraphExecutionStrategyKindSchema
])
export type GraphIntentStrategy = z.infer<typeof GraphIntentStrategySchema>

const GraphPlanIntentV2DataInputSchema = z.object({
  taskKey: GraphIdentifierSchema,
  name: z.string().trim().min(1).max(256)
}).strict()

const GraphPlanIntentV2TaskBaseShape = {
  key: GraphIdentifierSchema,
  title: z.string().trim().min(1).max(256),
  objective: z.string().trim().min(1).max(32_768),
  dependsOn: z.array(GraphIdentifierSchema).max(1_000),
  dataFrom: z.array(GraphPlanIntentV2DataInputSchema).max(1_000),
  acceptanceCriteria: z.array(
    z.string().trim().min(1).max(2_048)
  ).min(1).max(128),
  readScopes: z.array(GraphRelativePathSchema).max(1_000),
  writeScopes: z.array(GraphRelativePathSchema).max(1_000),
  harnessId: HarnessIdSchema.optional(),
  credentialMode: HarnessCredentialModeSchema.optional(),
  gatewayBinding: HarnessGatewayBindingSchema.optional()
} as const

export const GraphPlanIntentV2OrdinaryTaskSchema = z.object({
  ...GraphPlanIntentV2TaskBaseShape,
  kind: z.enum(['work', 'review', 'integration'])
}).strict()

export const GraphPlanIntentV2LoopTaskSchema = z.object({
  ...GraphPlanIntentV2TaskBaseShape,
  kind: z.literal('loop_gate'),
  loop: z.object({
    conditionTaskKey: GraphIdentifierSchema,
    continueTaskKey: GraphIdentifierSchema,
    exitTaskKey: GraphIdentifierSchema,
    exhaustionTaskKey: GraphIdentifierSchema.optional(),
    continueOn: z.array(z.enum([
      'accepted',
      'repair_required',
      'failed',
      'skipped'
    ])).min(1).max(4),
    maxIterations: z.number().int().positive().max(128)
  }).strict()
}).strict()

export const GraphPlanIntentV2TaskSchema = z.discriminatedUnion('kind', [
  GraphPlanIntentV2OrdinaryTaskSchema,
  GraphPlanIntentV2LoopTaskSchema
])

export const GraphPlanIntentV2Schema = z.object({
  title: z.string().trim().min(1).max(256).optional(),
  tasks: z.array(GraphPlanIntentV2TaskSchema).min(1).max(10_000),
  completionTaskKeys: z.array(GraphIdentifierSchema).min(1).max(1_000).optional()
}).strict().superRefine((intent, ctx) => {
  const keys = new Set<string>()
  for (const [index, task] of intent.tasks.entries()) {
    if (keys.has(task.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tasks', index, 'key'],
        message: `duplicate task key ${task.key}`
      })
    }
    keys.add(task.key)
  }
  for (const [index, task] of intent.tasks.entries()) {
    for (const [dependencyIndex, dependencyKey] of task.dependsOn.entries()) {
      validateReference(ctx, keys, task.key, dependencyKey, [
        'tasks', index, 'dependsOn', dependencyIndex
      ])
    }
    for (const [dataIndex, data] of task.dataFrom.entries()) {
      validateReference(ctx, keys, task.key, data.taskKey, [
        'tasks', index, 'dataFrom', dataIndex, 'taskKey'
      ])
    }
    if (task.kind === 'loop_gate') {
      for (const [field, target] of [
        ['conditionTaskKey', task.loop.conditionTaskKey],
        ['continueTaskKey', task.loop.continueTaskKey],
        ['exitTaskKey', task.loop.exitTaskKey],
        ['exhaustionTaskKey', task.loop.exhaustionTaskKey]
      ] as const) {
        if (target && !keys.has(target)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['tasks', index, 'loop', field],
            message: `loop target ${target} does not exist`
          })
        }
      }
    }
  }
  for (const [index, key] of (intent.completionTaskKeys ?? []).entries()) {
    if (!keys.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['completionTaskKeys', index],
        message: `completion task ${key} does not exist`
      })
    }
  }
})
export type GraphPlanIntentV2 = z.infer<typeof GraphPlanIntentV2Schema>

const GraphIntentDataInputSchema = z.object({
  taskId: GraphIdentifierSchema,
  name: z.string().trim().min(1).max(256)
}).strict()

const GraphIntentLoopSchema = z.object({
  conditionTaskId: GraphIdentifierSchema,
  continueTaskId: GraphIdentifierSchema,
  exitTaskId: GraphIdentifierSchema,
  exhaustionTaskId: GraphIdentifierSchema.optional(),
  continueOn: z.array(z.enum([
    'accepted',
    'repair_required',
    'failed',
    'skipped'
  ])).min(1).max(4).default(['repair_required', 'failed']),
  maxIterations: z.number().int().positive().max(128)
}).strict()

export const GraphIntentTaskSchema = z.object({
  id: GraphIdentifierSchema,
  title: z.string().trim().min(1).max(256),
  objective: z.string().trim().min(1).max(32_768),
  kind: z.enum(['work', 'review', 'integration', 'loop_gate']).default('work'),
  stage: z.string().trim().min(1).max(128).optional(),
  dependsOn: z.array(GraphIdentifierSchema).max(1_000).default([]),
  dataFrom: z.array(GraphIntentDataInputSchema).max(1_000).default([]),
  acceptanceCriteria: z.array(
    z.string().trim().min(1).max(2_048)
  ).min(1).max(128).optional(),
  checks: z.array(z.string().trim().min(1).max(512)).max(128).default([]),
  readScopes: z.array(GraphRelativePathSchema).max(1_000).default(['.']),
  writeScopes: z.array(GraphRelativePathSchema).max(1_000).default([]),
  priority: z.number().int().min(-1_000).max(1_000).default(0),
  required: z.boolean().default(true),
  riskClass: z.enum(['low', 'medium', 'high', 'critical']).default('low'),
  maxAttempts: z.number().int().positive().max(20).optional(),
  timeoutMs: z.number().int().positive().optional(),
  model: z.string().trim().min(1).max(256).optional(),
  providerId: z.string().trim().min(1).max(128).optional(),
  harnessId: HarnessIdSchema.optional(),
  credentialMode: HarnessCredentialModeSchema.optional(),
    gatewayBinding: HarnessGatewayBindingSchema.optional(),
  reasoningEffort: ModelReasoningEffort.optional(),
  loop: GraphIntentLoopSchema.optional()
}).strict().superRefine((task, ctx) => {
  if (task.kind === 'loop_gate' && !task.loop) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['loop'],
      message: 'loop_gate tasks require a bounded loop declaration'
    })
  }
  if (task.kind !== 'loop_gate' && task.loop) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['loop'],
      message: 'only loop_gate tasks may declare a loop'
    })
  }
})
export type GraphIntentTask = z.infer<typeof GraphIntentTaskSchema>

export const GraphIntentSchema = z.object({
  title: z.string().trim().min(1).max(256),
  goal: z.string().trim().min(1).max(32_768),
  strategy: GraphIntentStrategySchema.default('auto'),
  rationale: z.string().trim().min(1).max(2_048).optional(),
  tasks: z.array(GraphIntentTaskSchema).min(1).max(10_000),
  completionTaskIds: z.array(GraphIdentifierSchema).min(1).max(1_000).optional(),
  budget: GraphBudgetV1InputSchema.partial().optional()
}).strict().superRefine((intent, ctx) => {
  const taskIds = new Set<string>()
  for (const [index, task] of intent.tasks.entries()) {
    if (taskIds.has(task.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tasks', index, 'id'],
        message: `duplicate task id ${task.id}`
      })
    }
    taskIds.add(task.id)
  }
  for (const [index, task] of intent.tasks.entries()) {
    for (const [dependencyIndex, dependencyId] of task.dependsOn.entries()) {
      validateReference(ctx, taskIds, task.id, dependencyId, [
        'tasks', index, 'dependsOn', dependencyIndex
      ])
    }
    for (const [dataIndex, data] of task.dataFrom.entries()) {
      validateReference(ctx, taskIds, task.id, data.taskId, [
        'tasks', index, 'dataFrom', dataIndex, 'taskId'
      ])
    }
    if (task.loop) {
      for (const [field, target] of [
        ['conditionTaskId', task.loop.conditionTaskId],
        ['continueTaskId', task.loop.continueTaskId],
        ['exitTaskId', task.loop.exitTaskId],
        ['exhaustionTaskId', task.loop.exhaustionTaskId]
      ] as const) {
        if (target && !taskIds.has(target)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['tasks', index, 'loop', field],
            message: `loop target ${target} does not exist`
          })
        }
      }
    }
  }
  for (const [index, taskId] of (intent.completionTaskIds ?? []).entries()) {
    if (!taskIds.has(taskId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['completionTaskIds', index],
        message: `completion task ${taskId} does not exist`
      })
    }
  }
  if (
    intent.strategy === 'bounded_loop' &&
    !intent.tasks.some((task) => task.kind === 'loop_gate')
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['strategy'],
      message: 'bounded_loop strategy requires at least one loop_gate task'
    })
  }
})
export type GraphIntent = z.infer<typeof GraphIntentSchema>

export function compileGraphPlanIntentV2(input: {
  intent: GraphPlanIntentV2
  goal: string
  workspaceRoot: string
  nowIso: string
  budgetDefaults: GraphPlanV1['budget']
  config: GraphRuntimeConfig
}): GraphPlanV1 {
  const intent = GraphIntentSchema.parse({
    title: input.intent.title ?? input.goal.slice(0, 256),
    goal: input.goal,
    strategy: 'auto',
    tasks: input.intent.tasks.map((task) => ({
      id: task.key,
      title: task.title,
      objective: task.objective,
      kind: task.kind,
      dependsOn: task.dependsOn,
      dataFrom: task.dataFrom.map((data) => ({
        taskId: data.taskKey,
        name: data.name
      })),
      acceptanceCriteria: task.acceptanceCriteria,
      checks: task.writeScopes.length ? ['git diff --check'] : [],
      readScopes: task.readScopes,
      writeScopes: task.writeScopes,
      ...(task.harnessId ? { harnessId: task.harnessId } : {}),
      ...(task.credentialMode ? { credentialMode: task.credentialMode } : {}),
      ...(task.gatewayBinding ? { gatewayBinding: task.gatewayBinding } : {}),
      ...(task.kind === 'loop_gate'
        ? {
            loop: {
              conditionTaskId: task.loop.conditionTaskKey,
              continueTaskId: task.loop.continueTaskKey,
              exitTaskId: task.loop.exitTaskKey,
              ...(task.loop.exhaustionTaskKey
                ? { exhaustionTaskId: task.loop.exhaustionTaskKey }
                : {}),
              continueOn: task.loop.continueOn,
              maxIterations: task.loop.maxIterations
            }
          }
        : {})
    })),
    ...(input.intent.completionTaskKeys
      ? { completionTaskIds: input.intent.completionTaskKeys }
      : {})
  })
  return compileGraphIntent({
    intent,
    workspaceRoot: input.workspaceRoot,
    start: true,
    nowIso: input.nowIso,
    budgetDefaults: input.budgetDefaults,
    config: input.config
  })
}

export function compileGraphIntent(input: {
  intent: GraphIntent
  workspaceRoot: string
  start: boolean
  nowIso: string
  budgetDefaults: GraphPlanV1['budget']
  config: GraphRuntimeConfig
}): GraphPlanV1 {
  const strategy = resolveGraphIntentStrategy(input.intent)
  const phaseIds = new Map<string, string>()
  const phases: GraphPlanV1['phases'] = []
  for (const task of input.intent.tasks) {
    const stage = task.stage ?? defaultStage(strategy)
    if (phaseIds.has(stage)) continue
    const phaseId = uniquePhaseId(stage, phaseIds)
    phaseIds.set(stage, phaseId)
    phases.push({
      id: phaseId,
      title: stage,
      order: phases.length,
      collapsedByDefault: false
    })
  }
  const nodes: GraphPlanV1['nodes'] = input.intent.tasks.map((task) => ({
    id: task.id,
    phaseId: phaseIds.get(task.stage ?? defaultStage(strategy))!,
    kind: task.kind,
    title: task.title,
    objective: task.objective,
    priority: task.priority,
    // Loop gates are scheduler-owned control nodes. They never produce an
    // accepted worker result, so treating one as required would make its
    // normal terminal `skipped` state prevent GraphRun completion.
    required: task.kind === 'loop_gate' ? false : task.required,
    riskClass: task.riskClass,
    ...(task.model || task.providerId || task.harnessId || task.credentialMode || task.gatewayBinding ||
        task.reasoningEffort
      ? {
          assignment: {
            kind: 'ephemeral' as const,
            name: `${task.kind}-${task.id}`,
            description: task.title,
            systemPrompt: [
              `You are a focused executor for ${task.title}.`,
              task.objective,
              'Complete only this assignment and proactively report material findings to the Lead.'
            ].join('\n\n'),
            ...(task.model ? { model: task.model } : {}),
            ...(task.providerId ? { providerId: task.providerId } : {}),
            ...(task.harnessId ? { harnessId: task.harnessId } : {}),
            ...(task.credentialMode ? { credentialMode: task.credentialMode } : {}),
      ...(task.gatewayBinding ? { gatewayBinding: task.gatewayBinding } : {}),
            ...(task.reasoningEffort ? { reasoningEffort: task.reasoningEffort } : {}),
            toolPolicy: task.writeScopes.length ? 'inherit' as const : 'readOnly' as const,
            blockedTools: [],
            blockedSkills: [],
            blockedMcpServers: []
          }
        }
      : {}),
    completion: {
      requiredResultFields: ['summary' as const],
      acceptanceCriteria: task.acceptanceCriteria ?? [
        `${task.title} satisfies its stated objective with concrete evidence`
      ],
      review: {
        kinds: ['lead' as const],
        requireAll: true,
        deterministicChecks: task.checks
      }
    },
    readScopes: task.readScopes,
    writeScopes: task.writeScopes,
    ...(task.timeoutMs ? { timeoutMs: task.timeoutMs } : {}),
    ...(task.maxAttempts ? { maxAttempts: task.maxAttempts } : {}),
    ...(task.loop
      ? {
          loopGate: {
            maxIterations: task.loop.maxIterations,
            condition: {
              sourceNodeId: task.loop.conditionTaskId,
              outcomeIn: task.loop.continueOn
            },
            continueTargetNodeId: task.loop.continueTaskId,
            exitTargetNodeId: task.loop.exitTaskId,
            ...(task.loop.exhaustionTaskId
              ? { exhaustionTargetNodeId: task.loop.exhaustionTaskId }
              : {})
          }
        }
      : {}),
    metadata: {
      compiledFromIntent: true,
      executionStrategy: strategy
    }
  }))
  const edges = compileIntentEdges(input.intent, strategy)
  const completionNodeIds = input.intent.completionTaskIds ??
    sinkNodeIds(input.intent.tasks, edges)
  const plan = GraphPlanV1Schema.parse({
    version: GRAPH_CONTRACT_VERSION,
    revision: 1,
    title: input.intent.title,
    goal: input.intent.goal,
    workspaceRoot: input.workspaceRoot,
    phases,
    nodes,
    edges,
    budget: {
      ...input.budgetDefaults,
      ...(input.intent.budget ?? {})
    },
    autoStart: input.start,
    completionNodeIds,
    strategy: {
      kind: strategy,
      selectedBy: input.intent.strategy === 'auto' ? 'host' : 'lead',
      ...(input.intent.rationale ? { rationale: input.intent.rationale } : {})
    },
    createdBy: 'lead',
    createdAt: input.nowIso
  })
  if (
    plan.nodes.length > input.config.scheduler.maxNodes ||
    plan.edges.length > input.config.scheduler.maxEdges
  ) {
    throw new Error('compiled Graph intent exceeds host node or edge limits')
  }
  return plan
}

export function resolveGraphIntentStrategy(
  intent: Pick<GraphIntent, 'strategy' | 'tasks'>
): GraphExecutionStrategyKind {
  if (intent.strategy !== 'auto') return intent.strategy
  if (intent.tasks.some((task) => task.kind === 'loop_gate')) return 'bounded_loop'
  if (intent.tasks.length <= 1) return 'pipeline'
  const dependencies = intent.tasks.map((task) => [
    ...task.dependsOn,
    ...task.dataFrom.map((data) => data.taskId)
  ])
  if (dependencies.every((entries) => entries.length === 0)) return 'fanout_join'
  const linear = dependencies.every((entries, index) =>
    index === 0
      ? entries.length === 0
      : entries.length === 1 && entries[0] === intent.tasks[index - 1]!.id
  )
  return linear ? 'pipeline' : 'hybrid'
}

function compileIntentEdges(
  intent: GraphIntent,
  strategy: GraphExecutionStrategyKind
): GraphPlanV1['edges'] {
  const edges: GraphPlanV1['edges'] = []
  type ControlOutcome = Extract<
    GraphPlanV1['edges'][number],
    { kind: 'control' }
  >['requiredOutcomes'][number]
  const addControl = (
    from: string,
    to: string,
    label?: string,
    requiredOutcomes: ControlOutcome[] = ['accepted']
  ) => {
    const existing = edges.find((edge) =>
      edge.kind === 'control' && edge.from === from && edge.to === to)
    if (existing?.kind === 'control') {
      existing.requiredOutcomes = [
        ...new Set([...existing.requiredOutcomes, ...requiredOutcomes])
      ]
      return
    }
    // Preserve the legacy de-duplication for ordinary accepted dependencies,
    // while still allowing a LoopGate condition edge beside a data edge so it
    // can observe repair/failed control outcomes.
    if (
      requiredOutcomes.length === 1 &&
      requiredOutcomes[0] === 'accepted' &&
      edges.some((edge) => edge.kind !== 'message' && edge.from === from && edge.to === to)
    ) return
    edges.push({
      id: `edge_${edges.length + 1}`,
      kind: 'control',
      from,
      to,
      requiredOutcomes,
      ...(label ? { label } : {})
    })
  }
  for (const [index, task] of intent.tasks.entries()) {
    for (const data of task.dataFrom) {
      if (edges.some((edge) =>
        edge.kind === 'data' &&
        edge.from === data.taskId &&
        edge.to === task.id &&
        edge.artifactName === data.name
      )) continue
      edges.push({
        id: `edge_${edges.length + 1}`,
        kind: 'data',
        from: data.taskId,
        to: task.id,
        artifactName: data.name,
        required: true
      })
    }
    for (const dependencyId of task.dependsOn) {
      addControl(dependencyId, task.id)
    }
    if (
      strategy === 'pipeline' &&
      index > 0 &&
      task.dependsOn.length === 0 &&
      task.dataFrom.length === 0
    ) {
      addControl(intent.tasks[index - 1]!.id, task.id, 'pipeline')
    }
    if (task.loop) {
      // `continueOn` chooses the branch; it must not decide whether the gate
      // itself is reachable. Admit every non-cancellation terminal outcome so
      // the gate can choose either continuation or exit.
      addControl(
        task.loop.conditionTaskId,
        task.id,
        'bounded loop condition',
        ['accepted', 'repair_required', 'failed', 'skipped']
      )
      addControl(task.id, task.loop.continueTaskId, 'bounded loop continuation')
      addControl(task.id, task.loop.exitTaskId, 'bounded loop exit')
      if (task.loop.exhaustionTaskId) {
        addControl(task.id, task.loop.exhaustionTaskId, 'bounded loop exhaustion')
      }
    }
  }
  return edges
}

function sinkNodeIds(
  tasks: readonly GraphIntentTask[],
  edges: GraphPlanV1['edges']
): string[] {
  const outgoing = new Set(edges
    .filter((edge) => edge.kind !== 'message')
    .map((edge) => edge.from))
  const sinks = tasks
    .filter((task) => task.kind !== 'loop_gate' && !outgoing.has(task.id))
    .map((task) => task.id)
  return sinks.length ? sinks : [tasks.at(-1)!.id]
}

function validateReference(
  ctx: z.RefinementCtx,
  taskIds: ReadonlySet<string>,
  ownerId: string,
  targetId: string,
  path: Array<string | number>
): void {
  if (targetId === ownerId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: `task ${ownerId} cannot depend on itself`
    })
  } else if (!taskIds.has(targetId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: `dependency task ${targetId} does not exist`
    })
  }
}

function defaultStage(strategy: GraphExecutionStrategyKind): string {
  switch (strategy) {
    case 'fanout_join': return 'Parallel work'
    case 'pipeline': return 'Pipeline'
    case 'bounded_loop': return 'Bounded loop'
    case 'state_machine': return 'State transitions'
    case 'hybrid': return 'Hybrid execution'
  }
}

function uniquePhaseId(stage: string, existing: ReadonlyMap<string, string>): string {
  const base = `phase_${stage.toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96) || 'execution'}`
  const used = new Set(existing.values())
  if (!used.has(base)) return base
  let suffix = 2
  while (used.has(`${base}_${suffix}`)) suffix += 1
  return `${base}_${suffix}`
}
