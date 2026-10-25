import { HARNESS_GATEWAY_BINDING_JSON_SCHEMA } from '../../contracts/harness-gateway-binding.js'

export const START_FROM_SCHEMA = {
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

/** One `worker_create` request; `worker_create_batch` items use the same shape. */
export const WORKER_CREATE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    label: { type: 'string', maxLength: 64 },
    role: { type: 'string', maxLength: 64 },
    profile: {
      type: 'string',
      maxLength: 128,
      description: 'Agent roster id from list_subagent_profiles: the role and its bound engine. An explicit agent.harnessId still wins for the engine.'
    },
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
        credentialMode: { type: 'string', maxLength: 64 },
        gatewayBinding: HARNESS_GATEWAY_BINDING_JSON_SCHEMA
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
    agentSelection: { type: 'string', enum: ['user', 'auto'] },
    permissionMode: { type: 'string', maxLength: 64 },
    lifecycle: { type: 'string', enum: ['persistent', 'ephemeral'] },
    mode: { type: 'string', enum: ['queue', 'interrupt'] }
  },
  required: ['label', 'task'],
  additionalProperties: false
} as const

export const WORKER_CREATE_BATCH_JSON_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 16,
      items: WORKER_CREATE_JSON_SCHEMA
    }
  },
  required: ['items'],
  additionalProperties: false
} as const
