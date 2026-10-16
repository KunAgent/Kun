import { z } from 'zod'
const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
const Files = { projectId: Id, cursor: z.string().max(2048).optional(), limit: z.number().int().min(1).max(50).default(20) }
export const ProjectFilesParamSchemas = {
  'project.files.list': z.object({ ...Files, parentRef: Id.optional() }).strict(),
  'project.files.search': z.object({ ...Files, query: z.string().min(1).max(200), mode: z.enum(['name', 'content']).default('name') }).strict(),
  'file.preview': z.object({ projectId: Id, fileRef: Id,
    expectedRevision: z.string().regex(/^file-v1:[a-f0-9]{64}$/) }).strict()
} as const
