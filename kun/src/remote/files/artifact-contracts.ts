import { z } from 'zod'
import { ResourceSchema } from '../resources/contracts.js'
const Page = { cursor: z.string().max(2048).optional(), limit: z.number().int().min(1).max(50).default(20) }
export const ArtifactDirectoryParamSchemas = {
  'artifact.list': z.object({ ...Page, resource: ResourceSchema }).strict()
} as const
