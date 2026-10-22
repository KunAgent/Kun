import type { GraphRuntimeConfig } from '../config/kun-config.js'
import {
  GRAPH_CONTRACT_VERSION,
  GraphPlanV1Schema,
  type GraphExecutionStrategyKind,
  type GraphPlanV1
} from '../contracts/graph.js'
import {
  GraphIntentSchema,
  type GraphIntent,
  type GraphIntentTask,
  type GraphPlanIntentV2
} from './graph-intent-schemas.js'

export * from './graph-intent-schemas.js'

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
