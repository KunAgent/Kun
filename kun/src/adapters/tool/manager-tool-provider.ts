import type { ToolHostContext } from '../../ports/tool-host.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'
import { shouldAdvertiseManagerTools } from '../../domain/manager-tools.js'
import type { ManagerRuntime, ManagerToolContext } from '../../ade/manager-runtime.js'
import {
  listHarnessesForManager,
  type HarnessListDeps
} from '../../ade/tools/harness-list.js'
import { workerCreate, workerCreateBatch } from '../../ade/tools/worker-create.js'
import { workerRead, workerStatus } from '../../ade/tools/worker-status.js'

export type ManagerToolProviderDeps = {
  manager: ManagerRuntime
  harnessList: HarnessListDeps
}

const START_FROM_SCHEMA = {
  oneOf: [
    { type: 'object', properties: { kind: { const: 'default-branch' } }, required: ['kind'], additionalProperties: false },
    { type: 'object', properties: { kind: { const: 'current-head' } }, required: ['kind'], additionalProperties: false },
    {
      type: 'object',
      properties: { kind: { const: 'branch' }, name: { type: 'string', maxLength: 256 } },
      required: ['kind', 'name'],
      additionalProperties: false
    }
  ]
} as const

/**
 * Manager (`worker_*`) tools (09 §4, 10 §2). `shouldAdvertiseManagerTools`
 * gates advertising AND execution — ADE-manager threads on the native loop
 * only, never workers or room agents.
 */
export function createManagerToolProvider(
  deps: ManagerToolProviderDeps
): CapabilityToolProvider {
  const advertise = (context: ToolHostContext): boolean => shouldAdvertiseManagerTools(context)
  const managerCtx = (context: ToolHostContext): Promise<ManagerToolContext> =>
    deps.manager.toolContext({
      threadId: context.threadId,
      turnId: context.turnId,
      workspace: context.workspace,
      signal: context.abortSignal,
      awaitApproval: context.awaitApproval
    })
  return {
    id: 'ade-manager',
    kind: 'delegation',
    enabled: true,
    available: true,
    tools: [
      LocalToolHost.defineTool({
        name: 'harness_list',
        description:
          'List agent harnesses this manager can dispatch onto: readiness, missing ' +
          'capabilities for manager-worker usage, declared models, and configured ' +
          'worker profiles. Read-only.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        toolKind: 'tool_call',
        policy: 'auto',
        sideEffect: 'read-only',
        shouldAdvertise: advertise,
        execute: async (_args, context) => {
          return { output: await listHarnessesForManager(deps.harnessList, context.model?.id) }
        }
      }),
      LocalToolHost.defineTool({
        name: 'worker_create',
        description:
          'Create a worker and queue a dispatch for it. The worker runs as a side ' +
          'thread under the chosen harness with an isolated task workspace. After ' +
          'a successful dispatch, end your turn — you are woken automatically when ' +
          'the worker finishes or asks a question. Relay `userReport` to the user ' +
          'verbatim. To dispatch several workers at once, use worker_create_batch ' +
          'instead of calling this repeatedly.',
        inputSchema: {
          type: 'object',
          properties: {
            label: { type: 'string', maxLength: 64 },
            role: { type: 'string', maxLength: 64 },
            task: { type: 'string', maxLength: 32_000 },
            context: {
              type: 'object',
              properties: {
                files: { type: 'array', items: { type: 'string' }, maxItems: 64 },
                links: { type: 'array', items: { type: 'string' }, maxItems: 32 },
                constraints: { type: 'array', items: { type: 'string' }, maxItems: 32 }
              },
              additionalProperties: false
            },
            agent: {
              type: 'object',
              properties: {
                harnessId: { type: 'string', maxLength: 64 },
                model: { type: 'string', maxLength: 512 },
                providerId: { type: 'string', maxLength: 128 },
                credentialMode: { type: 'string', maxLength: 64 }
              },
              additionalProperties: false
            },
            workspace: {
              type: 'object',
              properties: {
                isolation: { type: 'string', enum: ['worktree', 'local'] },
                startFrom: START_FROM_SCHEMA
              },
              additionalProperties: false
            },
            permissionMode: { type: 'string', maxLength: 64 },
            lifecycle: { type: 'string', enum: ['persistent', 'ephemeral'] },
            mode: { type: 'string', enum: ['queue', 'interrupt'] }
          },
          required: ['label', 'task'],
          additionalProperties: false
        },
        toolKind: 'tool_call',
        policy: 'auto',
        shouldAdvertise: advertise,
        execute: async (args, context) => {
          const ctx = await managerCtx(context)
          return { output: await workerCreate(deps.manager, ctx, args, context) }
        }
      }),
      LocalToolHost.defineTool({
        name: 'worker_create_batch',
        description:
          'Create several workers in one call. Items run in input order; when the ' +
          'worker limit is reached the remaining items are marked skipped. Relay ' +
          'the summary `userReport` to the user verbatim.',
        inputSchema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              minItems: 1,
              maxItems: 16,
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', maxLength: 64 },
                  role: { type: 'string', maxLength: 64 },
                  task: { type: 'string', maxLength: 32_000 },
                  context: {
                    type: 'object',
                    properties: {
                      files: { type: 'array', items: { type: 'string' }, maxItems: 64 },
                      links: { type: 'array', items: { type: 'string' }, maxItems: 32 },
                      constraints: { type: 'array', items: { type: 'string' }, maxItems: 32 }
                    },
                    additionalProperties: false
                  },
                  agent: {
                    type: 'object',
                    properties: {
                      harnessId: { type: 'string', maxLength: 64 },
                      model: { type: 'string', maxLength: 512 },
                      providerId: { type: 'string', maxLength: 128 },
                      credentialMode: { type: 'string', maxLength: 64 }
                    },
                    additionalProperties: false
                  },
                  workspace: {
                    type: 'object',
                    properties: {
                      isolation: { type: 'string', enum: ['worktree', 'local'] },
                      startFrom: START_FROM_SCHEMA
                    },
                    additionalProperties: false
                  },
                  permissionMode: { type: 'string', maxLength: 64 },
                  lifecycle: { type: 'string', enum: ['persistent', 'ephemeral'] },
                  mode: { type: 'string', enum: ['queue', 'interrupt'] }
                },
                required: ['label', 'task'],
                additionalProperties: false
              }
            }
          },
          required: ['items'],
          additionalProperties: false
        },
        toolKind: 'tool_call',
        policy: 'auto',
        shouldAdvertise: advertise,
        execute: async (args, context) => {
          const ctx = await managerCtx(context)
          return { output: await workerCreateBatch(deps.manager, ctx, args, context) }
        }
      }),
      LocalToolHost.defineTool({
        name: 'worker_status',
        description:
          'Read the team roster: worker records, their dispatches (state, outcome, ' +
          'report), and live activity rows. Read-only.',
        inputSchema: {
          type: 'object',
          properties: { workerId: { type: 'string', maxLength: 256 } },
          additionalProperties: false
        },
        toolKind: 'tool_call',
        policy: 'auto',
        sideEffect: 'read-only',
        shouldAdvertise: advertise,
        execute: async (args, context) => {
          const ctx = await managerCtx(context)
          return { output: await workerStatus(deps.manager, ctx, args) }
        }
      }),
      LocalToolHost.defineTool({
        name: 'worker_read',
        description:
          'Read a worker thread\'s recent visible messages (newest first) to ' +
          'inspect its progress or last reply. Read-only.',
        inputSchema: {
          type: 'object',
          properties: {
            workerId: { type: 'string', maxLength: 256 },
            limit: { type: 'integer', minimum: 1, maximum: 50 }
          },
          required: ['workerId'],
          additionalProperties: false
        },
        toolKind: 'tool_call',
        policy: 'auto',
        sideEffect: 'read-only',
        shouldAdvertise: advertise,
        execute: async (args, context) => {
          const ctx = await managerCtx(context)
          return { output: await workerRead(deps.manager, ctx, args) }
        }
      })
    ]
  }
}
