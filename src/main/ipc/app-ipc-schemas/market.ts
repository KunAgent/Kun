import { z } from 'zod'
import { MAX_PATH_LENGTH, trimmedString } from './common'

const marketIdSchema = trimmedString(128)

export const marketCatalogPayloadSchema = z
  .object({
    sourceId: marketIdSchema,
    mode: z.enum(['cache-only', 'auto', 'refresh']).optional()
  })
  .strict()

export const marketInstallSkillPayloadSchema = z
  .object({
    sourceId: marketIdSchema,
    skillId: marketIdSchema,
    rootPath: trimmedString(MAX_PATH_LENGTH),
    overwrite: z.boolean().optional()
  })
  .strict()

export const marketMcpInstallPayloadSchema = z
  .object({
    sourceId: marketIdSchema,
    serverId: marketIdSchema
  })
  .strict()
