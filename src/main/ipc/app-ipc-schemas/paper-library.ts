import { z } from 'zod'
import {
  MAX_PATH_LENGTH,
  trimmedString
} from './common'

const papersDirSchema = z.string().trim().max(240).optional()

const workspaceScoped = {
  workspaceRoot: trimmedString(MAX_PATH_LENGTH),
  papersDir: papersDirSchema
}

const unitDirSchema = z.string().trim().min(1).max(MAX_PATH_LENGTH)

const metaPatchSchema = z
  .object({
    title: z.string().max(2_000).optional(),
    authors: z.array(z.string().max(400)).max(200).optional(),
    abstract: z.string().max(32_000).nullable().optional(),
    year: z.string().max(40).nullable().optional(),
    venue: z.string().max(400).nullable().optional(),
    arxivId: z.string().max(80).nullable().optional(),
    doi: z.string().max(200).nullable().optional(),
    tags: z.array(z.string().max(40)).max(32).optional(),
    status: z.enum(['unread', 'reading', 'read']).optional(),
    rating: z.number().int().min(1).max(5).nullable().optional(),
    pdfFile: z.string().max(MAX_PATH_LENGTH).nullable().optional(),
    needsReview: z.boolean().optional()
  })
  .strict()

export const paperLibraryListPayloadSchema = z.object({ ...workspaceScoped }).strict()

export const paperReadingActivityPayloadSchema = z.object({ ...workspaceScoped }).strict()

export const paperLibraryDetectPayloadSchema = z
  .object({
    workspaceRoots: z.array(trimmedString(MAX_PATH_LENGTH)).max(64),
    papersDir: papersDirSchema
  })
  .strict()

export const paperUpdateMetaPayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    unitDir: unitDirSchema,
    patch: metaPatchSchema
  })
  .strict()

export const paperMoveToGroupPayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    unitDir: unitDirSchema,
    /** Subgroup path under the papers dir; '' moves to the top level. */
    group: z.string().trim().max(240)
  })
  .strict()

export const paperTrashUnitPayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    unitDir: unitDirSchema
  })
  .strict()

export const paperDownloadPdfPayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    unitDir: unitDirSchema
  })
  .strict()

export const paperLocalStateReadPayloadSchema = z
  .object({ libraryRoot: trimmedString(MAX_PATH_LENGTH) })
  .strict()

export const paperLocalStateWritePayloadSchema = z
  .object({
    libraryRoot: trimmedString(MAX_PATH_LENGTH),
    unitRelDir: z.string().trim().min(1).max(MAX_PATH_LENGTH),
    patch: z
      .object({
        lastOpenedAt: z.string().max(80).optional(),
        lastPage: z.number().int().min(1).max(100_000).nullable().optional(),
        pageCount: z.number().int().min(1).max(100_000).nullable().optional()
      })
      .strict()
  })
  .strict()

export const paperExportBibtexPayloadSchema = z
  .object({
    ...workspaceScoped,
    unitDir: unitDirSchema.optional()
  })
  .strict()

export const paperImportBibtexPayloadSchema = z
  .object({
    workspaceRoot: trimmedString(MAX_PATH_LENGTH),
    bibtex: z.string().max(2_000_000),
    downloadPdfs: z.boolean(),
    requestId: trimmedString(128)
  })
  .strict()
