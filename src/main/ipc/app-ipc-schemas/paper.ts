import { z } from 'zod'
import {
  MAX_PATH_LENGTH,
  defaultPathSchema,
  trimmedString
} from './common'

const MAX_PAPER_INPUT_LENGTH = 2_048

const requestIdSchema = trimmedString(128)

const importHintMetaSchema = z
  .object({
    title: z.string().max(400).optional(),
    authors: z.array(z.string().max(200)).max(40).optional(),
    abstract: z.string().max(8_000).optional(),
    year: z.string().max(10).optional(),
    venue: z.string().max(300).optional(),
    doi: z.string().max(300).optional(),
    arxivId: z.string().max(64).optional(),
    coolId: z.string().max(200).optional(),
    pdfUrl: z.string().max(2_000).optional(),
    sourceUrl: z.string().max(2_000).optional(),
    pmid: z.string().max(32).optional()
  })
  .strict()

export const paperImportPayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    input: z.string().max(MAX_PAPER_INPUT_LENGTH),
    localPdfPath: defaultPathSchema.optional(),
    /** Search-card metadata that seeds the DOI/OA path (plan P3.2). */
    meta: importHintMetaSchema.optional(),
    parentDir: z.string().trim().max(240).optional(),
    requestId: requestIdSchema
  })
  .strict()

export const paperImportBatchPayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    items: z
      .array(
        z
          .object({
            input: z.string().max(MAX_PAPER_INPUT_LENGTH),
            meta: importHintMetaSchema.optional()
          })
          .strict()
      )
      .min(1)
      .max(50),
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
