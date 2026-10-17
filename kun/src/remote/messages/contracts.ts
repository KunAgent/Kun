import { z } from 'zod'
import { ResourceSchema } from '../resources/contracts.js'
import { SourceContentParams } from './source/content-contracts.js'
const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
const Page = { cursor: z.string().max(2048).optional(), limit: z.number().int().min(1).max(50).default(20) }
export const MessageParamSchemas = {
  'message.search': z.object({ ...Page, resource: ResourceSchema, query: z.string().trim().min(1).max(200) }).strict(),
  'message.get': z.object({ resource: ResourceSchema, messageId: Id, turnId: Id.optional(),
    historyVersion: z.string().min(1).max(256), contentOffset: z.number().int().nonnegative().default(0),
    maxChars: z.number().int().min(1).max(32000).default(8192) }).strict().refine(
      (p) => p.resource.kind !== 'code' || Boolean(p.turnId), 'Code messages require their turnId'),
  'message.source.get': SourceContentParams
} as const
