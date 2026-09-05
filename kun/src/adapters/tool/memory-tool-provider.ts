import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'
import type { MemoryStore } from '../../memory/memory-store.js'
import { MemoryCreateRequest, MemoryUpdateRequest } from '../../contracts/memory.js'

const memoryTypeSchema = {
  type: 'string',
  enum: ['fact', 'preference', 'decision', 'episode', 'relationship', 'insight']
}

const memorySourceSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 128 },
    kind: { type: 'string', enum: ['user', 'tool', 'inference', 'file', 'web', 'imported', 'legacy'] },
    threadId: { type: 'string', minLength: 1, maxLength: 256 },
    turnId: { type: 'string', minLength: 1, maxLength: 256 },
    itemId: { type: 'string', minLength: 1, maxLength: 256 },
    locator: { type: 'string', minLength: 1, maxLength: 1_024 },
    excerpt: { type: 'string', minLength: 1, maxLength: 512 },
    contentHash: { type: 'string', minLength: 1, maxLength: 128 },
    trust: { type: 'string', enum: ['explicit-user', 'observed', 'inferred', 'imported', 'legacy'] }
  },
  required: ['kind', 'trust'],
  additionalProperties: false
}

const memorySourcesSchema = {
  type: 'array',
  maxItems: 8,
  items: memorySourceSchema
}

const nullableDateTimeSchema = {
  anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }]
}

export function buildMemoryToolProviders(store: MemoryStore | undefined): CapabilityToolProvider[] {
  if (!store) return []
  return [{
    id: 'memory',
    kind: 'memory',
    enabled: true,
    available: true,
    effects: {
      network: false,
      externalWrite: false,
      processExecution: false,
      guiAutomation: false
    },
    tools: [
      LocalToolHost.defineTool({
        name: 'memory_create',
        description: 'Create a long-term memory after explicit user approval.',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            scope: { type: 'string', enum: ['user', 'workspace', 'project'] },
            tags: { type: 'array', items: { type: 'string' } },
            type: memoryTypeSchema,
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            importance: { type: 'number', minimum: 0, maximum: 1 },
            observedAt: { type: 'string', format: 'date-time' },
            validFrom: { type: 'string', format: 'date-time' },
            validTo: { type: 'string', format: 'date-time' },
            sources: memorySourcesSchema,
            ttlDays: { type: 'number', minimum: 1, description: 'Optional lifetime in days.' },
            supersedes: { type: 'string', description: 'Optional memory id replaced by this memory.' }
          },
          required: ['content'],
          additionalProperties: false
        },
        policy: 'on-request',
        execute: async (args, context) => {
          const content = typeof args.content === 'string' ? args.content.trim() : ''
          if (!content) return { output: { error: 'content is required' }, isError: true }
          let ttlMs: number | undefined
          if (hasOwn(args, 'ttlDays')) {
            if (typeof args.ttlDays !== 'number' || !Number.isFinite(args.ttlDays) || args.ttlDays <= 0) {
              return invalidArguments('create', [{ path: ['ttlDays'], message: 'ttlDays must be a positive number' }])
            }
            ttlMs = Math.round(args.ttlDays * 24 * 60 * 60 * 1_000)
          }
          const parsed = MemoryCreateRequest.safeParse({
            content,
            scope: args.scope ?? 'workspace',
            workspace: context.workspace,
            ...(args.scope === 'project' ? { project: context.workspace } : {}),
            sourceThreadId: context.threadId,
            sourceTurnId: context.turnId,
            provenance: { kind: 'user', turnId: context.turnId, origin: 'memory_create' },
            tags: args.tags ?? [],
            ...(ttlMs !== undefined ? { ttlMs } : {}),
            ...optionalArgument(args, 'supersedes', (value) => typeof value === 'string' ? value.trim() : value),
            ...optionalArgument(args, 'type'),
            ...optionalArgument(args, 'confidence'),
            ...optionalArgument(args, 'importance'),
            ...optionalArgument(args, 'observedAt'),
            ...optionalArgument(args, 'validFrom'),
            ...optionalArgument(args, 'validTo'),
            ...optionalArgument(args, 'sources')
          })
          if (!parsed.success) return invalidArguments('create', parsed.error.issues)
          return {
            output: {
              memory: await store.create(parsed.data)
            }
          }
        }
      }),
      LocalToolHost.defineTool({
        name: 'memory_update',
        description: 'Update or disable an existing long-term memory.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            content: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            type: memoryTypeSchema,
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            importance: { type: 'number', minimum: 0, maximum: 1 },
            observedAt: { type: 'string', format: 'date-time' },
            validFrom: nullableDateTimeSchema,
            validTo: nullableDateTimeSchema,
            expiresAt: nullableDateTimeSchema,
            sources: memorySourcesSchema,
            disabled: { type: 'boolean' }
          },
          required: ['id'],
          additionalProperties: false
        },
        policy: 'on-request',
        execute: async (args, context) => {
          const id = typeof args.id === 'string' ? args.id.trim() : ''
          if (!id) return { output: { error: 'id is required' }, isError: true }
          const patch = {
            ...optionalArgument(args, 'content'),
            ...optionalArgument(args, 'tags'),
            ...optionalArgument(args, 'type'),
            ...optionalArgument(args, 'confidence'),
            ...optionalArgument(args, 'importance'),
            ...optionalArgument(args, 'observedAt'),
            ...optionalArgument(args, 'validFrom'),
            ...optionalArgument(args, 'validTo'),
            ...optionalArgument(args, 'expiresAt'),
            ...optionalArgument(args, 'sources'),
            ...optionalArgument(args, 'disabled')
          }
          if (Object.keys(patch).length === 0) {
            return invalidArguments('update', [{ path: [], message: 'at least one update field is required' }])
          }
          const parsed = MemoryUpdateRequest.safeParse(patch)
          if (!parsed.success) return invalidArguments('update', parsed.error.issues)
          return {
            output: {
              memory: await store.update(id, parsed.data, { workspace: context.workspace })
            }
          }
        }
      }),
      LocalToolHost.defineTool({
        name: 'memory_delete',
        description: 'Delete a long-term memory by writing a tombstone.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
          additionalProperties: false
        },
        policy: 'on-request',
        execute: async (args, context) => {
          if (typeof args.id !== 'string') return { output: { error: 'id is required' }, isError: true }
          return { output: { memory: await store.delete(args.id, { workspace: context.workspace }) } }
        }
      })
    ]
  }]
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function optionalArgument(
  args: Record<string, unknown>,
  key: string,
  normalize: (value: unknown) => unknown = (value) => value
): Record<string, unknown> {
  return hasOwn(args, key) ? { [key]: normalize(args[key]) } : {}
}

function invalidArguments(
  operation: 'create' | 'update',
  issues: readonly { path: PropertyKey[]; message: string }[]
) {
  return {
    output: {
      error: `invalid memory ${operation} arguments`,
      issues: issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message }))
    },
    isError: true
  }
}
