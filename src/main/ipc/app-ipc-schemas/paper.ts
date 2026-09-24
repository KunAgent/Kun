import { z } from 'zod'
import {
  MAX_PATH_LENGTH,
  defaultPathSchema,
  trimmedString
} from './common'

const MAX_PAPER_INPUT_LENGTH = 2_048

const requestIdSchema = trimmedString(128)

export const paperImportPayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    input: z.string().max(MAX_PAPER_INPUT_LENGTH),
    localPdfPath: defaultPathSchema.optional(),
    parentDir: z.string().trim().max(240).optional(),
    requestId: requestIdSchema
  })
  .strict()

export const paperUnitTargetPayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    unitDir: z.string().trim().min(1).max(MAX_PATH_LENGTH)
  })
  .strict()

export const paperListUnitsPayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    parentDir: z.string().trim().max(240).optional()
  })
  .strict()

export const paperJobPayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    unitDir: z.string().trim().min(1).max(MAX_PATH_LENGTH),
    force: z.boolean().optional(),
    requestId: requestIdSchema
  })
  .strict()

export const paperRecordInterpretationPayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    unitDir: z.string().trim().min(1).max(MAX_PATH_LENGTH),
    path: z.string().trim().min(1).max(MAX_PATH_LENGTH),
    threadId: z.string().trim().max(128).optional()
  })
  .strict()

export const paperCancelPayloadSchema = z
  .object({ requestId: requestIdSchema })
  .strict()
