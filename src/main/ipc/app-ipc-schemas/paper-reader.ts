import { z } from 'zod'
import { PAPER_SEARCH_SOURCES } from '../../../shared/paper/paper-search'
import { MAX_PATH_LENGTH, trimmedString } from './common'

const unitDirSchema = z.string().trim().min(1).max(MAX_PATH_LENGTH)

const workspaceUnitScoped = {
  workspaceRoot: trimmedString(MAX_PATH_LENGTH),
  unitDir: unitDirSchema
}

export const paperMarksReadPayloadSchema = z.object({ ...workspaceUnitScoped }).strict()

export const paperMarksWritePayloadSchema = z
  .object({
    ...workspaceUnitScoped,
    items: z.array(z.unknown()).max(2000),
    removedIds: z.array(z.string().max(80)).max(2000).optional()
  })
  .strict()

const translateModel = {
  providerId: z.string().trim().max(120).optional(),
  model: z.string().trim().max(200).optional()
}

export const paperTranslateSelectionPayloadSchema = z
  .object({
    // Plan §3.4.3: selection translation is capped at 2000 characters.
    text: z.string().min(1).max(2_000),
    targetLanguage: z.enum(['zh', 'en']),
    ...translateModel
  })
  .strict()

export const paperTranslateDocumentPayloadSchema = z
  .object({
    ...workspaceUnitScoped,
    targetLanguage: z.enum(['zh', 'en']),
    ...translateModel,
    requestId: trimmedString(128)
  })
  .strict()

/** R2.2: overlay block translation — blocks arrive already ⟦n⟧-masked. */
export const paperTranslateBlocksPayloadSchema = z
  .object({
    ...workspaceUnitScoped,
    blocks: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(80),
            text: z.string().min(1).max(8_000)
          })
          .strict()
      )
      .min(1)
      .max(400),
    targetLanguage: z.enum(['zh', 'en']),
    ...translateModel
  })
  .strict()

/**
 * R2.4 region capture: renderer crops the PNG itself and sends base64 +
 * the card fields. The main side validates the PNG magic and size before
 * writing `marks/assets/<id>.png` + `marks/<id>.json`.
 */
export const paperSaveVisualMarkPayloadSchema = z
  .object({
    ...workspaceUnitScoped,
    mark: z
      .object({
        id: z.string().trim().min(1).max(80),
        page: z.number().int().min(1).max(10_000),
        rect: z.tuple([
          z.number().min(0).max(1),
          z.number().min(0).max(1),
          z.number().min(0).max(1),
          z.number().min(0).max(1)
        ]),
        comment: z.string().max(8_000).optional()
      })
      .strict(),
    pngBase64: z.string().min(8).max(6_000_000)
  })
  .strict()

export const paperReferencesPayloadSchema = z
  .object({
    ...workspaceUnitScoped,
    force: z.boolean().optional(),
    kind: z.enum(['references', 'citations']).optional()
  })
  .strict()

export const paperSearchTitlePayloadSchema = z
  .object({
    query: trimmedString(2_000),
    limit: z.number().int().min(1).max(10).optional()
  })
  .strict()

export const paperResolveDoiPayloadSchema = z
  .object({ doi: trimmedString(300) })
  .strict()

export const paperUrlMetaPayloadSchema = z
  .object({ url: trimmedString(2_000) })
  .strict()

export const paperIdentifyPdfPayloadSchema = z
  .object({ path: trimmedString(MAX_PATH_LENGTH) })
  .strict()

export const paperFetchFeedPayloadSchema = z
  .object({ url: trimmedString(2_000) })
  .strict()

export const paperArxivTodayPayloadSchema = z
  .object({
    categories: z.array(z.string().trim().min(1).max(60)).max(16),
    /** YYYY-MM-DD; defaults to today (UTC). */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    force: z.boolean().optional()
  })
  .strict()

export const paperListVenuePayloadSchema = z
  .object({
    venue: trimmedString(80),
    group: z.string().trim().max(160).optional(),
    skip: z.number().int().min(0).max(20_000).optional()
  })
  .strict()

export const paperVenueCatalogPayloadSchema = z
  .object({ force: z.boolean().optional() })
  .strict()

export const paperSearchPayloadSchema = z
  .object({
    query: trimmedString(300),
    sources: z.array(z.enum(PAPER_SEARCH_SOURCES)).max(PAPER_SEARCH_SOURCES.length).optional(),
    limit: z.number().int().min(1).max(25).optional(),
    yearFrom: z.number().int().min(1900).max(2100).optional(),
    yearTo: z.number().int().min(1900).max(2100).optional()
  })
  .strict()
