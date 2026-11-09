import { z } from 'zod'
import { ResourceSchema } from '../resources/contracts.js'
const Page = { cursor: z.string().max(2048).optional(), limit: z.number().int().min(1).max(50).default(20) }
const Identity = { resource: ResourceSchema, id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  revision: z.string().regex(/^artifact-v1:[a-f0-9]{64}$/) }
const State = z.object({ modelContent: z.unknown().optional(), privateContent: z.unknown().optional() }).strict()
  .refine(value => Buffer.byteLength(JSON.stringify(value), 'utf8') <= 16 * 1024)
export const ArtifactDirectoryParamSchemas = {
  'artifact.list': z.object({ ...Page, resource: ResourceSchema }).strict(),
  'artifact.catalog.list': z.object({ ...Page, resource: ResourceSchema }).strict(),
  'artifact.preview.get': z.object(Identity).strict(),
  'artifact.widget.state.update': z.object({ ...Identity, state: State }).strict()
} as const
