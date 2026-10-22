import { HarnessGatewayBindingSchema } from '../contracts/harness-gateway-binding.js'
import { z } from 'zod'
import {
  GraphBudgetV1InputSchema,
  GraphExecutionStrategyKindSchema,
  GraphIdentifierSchema,
  GraphRelativePathSchema
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
