import { z } from 'zod'
import type { JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'
import type { ListThreadsOptions } from '../../services/thread-service.js'

const BooleanQuery = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return value
}, z.boolean())

const ListThreadsQuery = z.object({
  limit: z.preprocess((value) => {
    if (typeof value !== 'string' || value.trim() === '') return undefined
    return Number(value)
  }, z.number().int().positive().max(500).optional()),
  search: z.string().optional(),
  include_archived: BooleanQuery.optional(),
  archived_only: BooleanQuery.optional(),
  /**
   * Comma-separated list of additional categories to include. Currently
   * the only opt-in category is `side` (side conversations are hidden
   * from the default listing).
   */
  include: z.string().optional(),
  /** Opaque keyset cursor for the next page of results. */
  cursor: z.string().optional(),
  /** Filter by workspace root path. */
  workspace: z.string().optional(),
  /**
   * Filter by owning workspace mode ('code' | 'ade'). Legacy threads without a
   * stored value count as 'code'. An absent parameter returns every mode.
   */
  workspace_mode: z.enum(['code', 'ade']).optional(),
  /** Return the lean sidebar projection (omits heavy metadata blobs). */
  lean: BooleanQuery.optional()
})

export function parseListThreadsOptions(
  request: Request
): { ok: true; options: ListThreadsOptions } | { ok: false; response: JsonResponse } {
  const url = new URL(request.url)
  const parsed = ListThreadsQuery.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (!parsed.success) {
    return {
      ok: false,
      response: ERRORS.validation('invalid list threads query', parsed.error.issues)
    }
  }
  const includeSide = (parsed.data.include ?? '').split(',').map((value) => value.trim().toLowerCase())
    .includes('side')
  // Repeated workspaces params are trimmed and capped; an absent/empty list
  // omits the option entirely rather than serializing workspaces: [].
  const workspaces = url.searchParams.getAll('workspaces').map((value) => value.trim())
    .filter(Boolean).slice(0, 64)
  return {
    ok: true,
    options: {
      limit: parsed.data.limit,
      search: parsed.data.search,
      includeArchived: parsed.data.include_archived,
      archivedOnly: parsed.data.archived_only,
      includeSide,
      cursor: parsed.data.cursor,
      workspace: parsed.data.workspace,
      ...(parsed.data.workspace_mode ? { workspaceMode: parsed.data.workspace_mode } : {}),
      ...(workspaces.length > 0 ? { workspaces } : {}),
      lean: parsed.data.lean === true
    }
  }
}
