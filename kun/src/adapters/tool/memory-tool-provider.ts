import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'
import type { MemoryStore } from '../../memory/memory-store.js'

export function buildMemoryToolProviders(store: MemoryStore | undefined): CapabilityToolProvider[] {
  if (!store) return []
  return [{
    id: 'memory',
    kind: 'memory',
    enabled: true,
    available: true,
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
          return {
            output: {
              memory: await store.create({
                content,
                scope: args.scope === 'user' || args.scope === 'project' ? args.scope : 'workspace',
                workspace: context.workspace,
                ...(args.scope === 'project' ? { project: context.workspace } : {}),
                sourceThreadId: context.threadId,
                sourceTurnId: context.turnId,
                provenance: { kind: 'user', turnId: context.turnId, origin: 'memory_create' },
                ...(typeof args.ttlDays === 'number' && Number.isFinite(args.ttlDays) && args.ttlDays > 0
                  ? { ttlMs: Math.round(args.ttlDays * 24 * 60 * 60 * 1_000) }
                  : {}),
                ...(typeof args.supersedes === 'string' && args.supersedes.trim()
                  ? { supersedes: args.supersedes.trim() }
                  : {}),
                tags: Array.isArray(args.tags) ? args.tags.filter((tag): tag is string => typeof tag === 'string') : []
              })
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
            disabled: { type: 'boolean' }
          },
          required: ['id'],
          additionalProperties: false
        },
        policy: 'on-request',
        execute: async (args, context) => {
          if (typeof args.id !== 'string') return { output: { error: 'id is required' }, isError: true }
          return {
            output: {
              memory: await store.update(args.id, {
                ...(typeof args.content === 'string' ? { content: args.content } : {}),
                ...(typeof args.disabled === 'boolean' ? { disabled: args.disabled } : {})
              }, { workspace: context.workspace })
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
