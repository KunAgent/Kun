import { z } from 'zod'
import {
  PAPER_MODE_FEED_TITLE_MAX_CHARS,
  PAPER_MODE_FEED_URL_MAX_CHARS,
  PAPER_MODE_MAX_ARXIV_CATEGORIES,
  PAPER_MODE_MAX_FEEDS,
  PAPER_MODE_MAX_LIBRARIES
} from '../../../shared/app-settings-paper-mode'
import { PAPER_SEARCH_SOURCES } from '../../../shared/paper/paper-search'
import { MAX_PATH_LENGTH, optionalTrimmedString, trimmedString } from './common'

/**
 * `write.paperMode` patch schema — kept in its own module so settings.ts
 * stays under the file-size gate.
 */
export const writePaperModePatchSchema = z.object({
  enabled: z.boolean().optional(),
  libraries: z.array(trimmedString(MAX_PATH_LENGTH)).max(PAPER_MODE_MAX_LIBRARIES).optional(),
  activeLibrary: optionalTrimmedString(MAX_PATH_LENGTH),
  autoMarkReading: z.boolean().optional(),
  translate: z.object({
    targetLanguage: z.enum(['zh', 'en']).optional(),
    inheritModel: z.boolean().optional(),
    providerId: optionalTrimmedString(64),
    model: optionalTrimmedString(128),
    autoTranslateSelection: z.boolean().optional()
  }).strict().optional(),
  discover: z.object({
    arxivCategories: z.array(trimmedString(32)).max(PAPER_MODE_MAX_ARXIV_CATEGORIES).optional(),
    feeds: z.array(z.object({
      id: trimmedString(64).optional(),
      url: trimmedString(PAPER_MODE_FEED_URL_MAX_CHARS).optional(),
      title: z.string().max(PAPER_MODE_FEED_TITLE_MAX_CHARS).optional()
    }).strict()).max(PAPER_MODE_MAX_FEEDS).optional(),
    rankMode: z.enum(['lexical', 'embedding', 'off']).optional(),
    embedding: z.object({
      baseUrl: optionalTrimmedString(MAX_PATH_LENGTH),
      apiKey: z.string().max(512).optional(),
      model: optionalTrimmedString(128)
    }).strict().optional()
  }).strict().optional(),
  scholar: z.object({
    semanticScholarApiKey: z.string().max(512).optional(),
    crossrefMailto: optionalTrimmedString(200),
    onlineReferences: z.boolean().optional()
  }).strict().optional(),
  search: z.object({
    enabledSources: z.array(z.enum(PAPER_SEARCH_SOURCES)).max(PAPER_SEARCH_SOURCES.length).optional(),
    semanticScholarApiKey: z.string().max(512).optional(),
    coreApiKey: z.string().max(512).optional(),
    openAlexMailto: optionalTrimmedString(320),
    unpaywallEmail: optionalTrimmedString(320)
  }).strict().optional(),
  reader: z.object({
    paperTone: z.enum(['white', 'sepia', 'green', 'dark']).optional()
  }).strict().optional()
}).strict()
