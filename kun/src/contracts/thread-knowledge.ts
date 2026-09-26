import { z } from 'zod'

export const MAX_THREAD_KNOWLEDGE_BASES = 8

export const KnowledgeBaseMountSchema = z.object({
  id: z.string().trim().min(1).max(128),
  root: z.string().trim().min(1).max(4_096),
  name: z.string().trim().min(1).max(200),
  source: z.literal('write-workspace'),
  access: z.literal('read-only')
}).strict()
export type KnowledgeBaseMount = z.infer<typeof KnowledgeBaseMountSchema>

export const KnowledgeBaseMountsSchema = z.array(KnowledgeBaseMountSchema)
  .max(MAX_THREAD_KNOWLEDGE_BASES)
  .superRefine((mounts, ctx) => {
    const ids = new Set<string>()
    const roots = new Set<string>()
    mounts.forEach((mount, index) => {
      const root = mount.root.replace(/[\\/]+$/, '').toLocaleLowerCase()
      if (ids.has(mount.id)) {
        ctx.addIssue({ code: 'custom', path: [index, 'id'], message: 'knowledge base ids must be unique' })
      }
      if (roots.has(root)) {
        ctx.addIssue({ code: 'custom', path: [index, 'root'], message: 'knowledge base roots must be unique' })
      }
      ids.add(mount.id)
      roots.add(root)
    })
  })

export const KnowledgeBaseIndexStateSchema = z.enum([
  'pending', 'indexing', 'ready', 'stale', 'unavailable', 'error'
])
export type KnowledgeBaseIndexState = z.infer<typeof KnowledgeBaseIndexStateSchema>

export const KnowledgeBaseIndexStatusSchema = z.object({
  id: z.string().min(1),
  state: KnowledgeBaseIndexStateSchema,
  documentCount: z.number().int().nonnegative(),
  nodeCount: z.number().int().nonnegative(),
  availableDocumentCount: z.number().int().nonnegative().optional(),
  unavailableDocumentCount: z.number().int().nonnegative().optional(),
  truncatedDocumentCount: z.number().int().nonnegative().optional(),
  formatCounts: z.record(z.string(), z.number().int().nonnegative()).optional(),
  diagnostics: z.array(z.string().max(500)).max(20).optional(),
  lastIndexedAt: z.string().optional(),
  error: z.string().max(1_000).optional()
})
export type KnowledgeBaseIndexStatus = z.infer<typeof KnowledgeBaseIndexStatusSchema>

export const ThreadKnowledgeBasesResponseSchema = z.object({
  mounts: KnowledgeBaseMountsSchema,
  statuses: z.array(KnowledgeBaseIndexStatusSchema).max(MAX_THREAD_KNOWLEDGE_BASES)
})
export type ThreadKnowledgeBasesResponse = z.infer<typeof ThreadKnowledgeBasesResponseSchema>
