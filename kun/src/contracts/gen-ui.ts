import { z } from 'zod'

/**
 * Generated conversation UI (Gen UI) wire contracts.
 *
 * The model authors an HTML fragment; Kun stores an immutable snapshot and the
 * desktop renders it inside an isolated sandbox. A widget reference grants no
 * file, tool, or network access. These schemas are shared by the runtime,
 * Electron Main and the renderer, so they must stay free of Node-only APIs.
 */

export const GEN_UI_TOOL_NAME = 'render_widget' as const
export const GEN_UI_PROVIDER_ID = 'gen-ui' as const
/** Fragment size accepted from the model, inline or from a workspace file. */
export const GEN_UI_HTML_MAX_BYTES = 1_000_000
export const GEN_UI_TITLE_MAX_CHARS = 120
/** One widget's saved `{modelContent, privateContent}` snapshot. */
export const GEN_UI_STATE_MAX_BYTES = 16 * 1024
/** Upper bound for the model-visible state attached to one user message. */
export const GEN_UI_MODEL_CONTEXT_MAX_BYTES = 12 * 1024
export const GEN_UI_FOLLOW_UP_MAX_CHARS = 8_000

const WIDGET_ID_PATTERN = /^gw_[a-f0-9]{64}$/

export const GenUiWidgetIdSchema = z.string().regex(WIDGET_ID_PATTERN, 'invalid widget id')

export function isGenUiWidgetId(value: unknown): value is string {
  return typeof value === 'string' && WIDGET_ID_PATTERN.test(value)
}

export const GenUiModeSchema = z.enum(['inline', 'wide'])
export type GenUiMode = z.infer<typeof GenUiModeSchema>

export const GenUiRenderInputSchema = z.object({
  title: z.string().trim().min(1).max(GEN_UI_TITLE_MAX_CHARS),
  html: z.string().min(1).optional(),
  path: z.string().trim().min(1).max(4_096).optional(),
  mode: GenUiModeSchema.optional()
}).strict().superRefine((value, context) => {
  if ((value.html === undefined) === (value.path === undefined)) {
    context.addIssue({ code: 'custom', message: 'Provide exactly one of html or path' })
  }
})
export type GenUiRenderInput = z.infer<typeof GenUiRenderInputSchema>

export const GenUiWidgetRefSchema = z.object({
  widgetId: GenUiWidgetIdSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().positive().max(GEN_UI_HTML_MAX_BYTES),
  title: z.string().min(1).max(GEN_UI_TITLE_MAX_CHARS),
  mode: GenUiModeSchema
}).strict()
export type GenUiWidgetRef = z.infer<typeof GenUiWidgetRefSchema>

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function serializeJsonOnly(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (
      item === undefined ||
      typeof item === 'function' ||
      typeof item === 'symbol' ||
      typeof item === 'bigint' ||
      (typeof item === 'number' && !Number.isFinite(item))
    ) {
      throw new Error('Widget state must contain JSON values only')
    }
    return item
  })
}

export type GenUiWidgetState = {
  modelContent: unknown
  privateContent: unknown
}

/** Normalize a page-submitted snapshot; omitted fields become null. */
export function parseGenUiWidgetState(value: unknown): GenUiWidgetState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Widget state must be an object')
  }
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (key !== 'modelContent' && key !== 'privateContent') {
      throw new Error(`Unknown widget state field: ${key}`)
    }
  }
  const state = {
    modelContent: record.modelContent ?? null,
    privateContent: record.privateContent ?? null
  }
  const serialized = serializeJsonOnly(state)
  if (utf8ByteLength(serialized) > GEN_UI_STATE_MAX_BYTES) {
    throw new Error(`Widget state exceeds ${GEN_UI_STATE_MAX_BYTES} bytes`)
  }
  return JSON.parse(serialized) as GenUiWidgetState
}

export const GenUiStateEntrySchema = z.object({
  widgetId: GenUiWidgetIdSchema,
  state: z.object({ modelContent: z.unknown(), privateContent: z.unknown() }).strict(),
  updatedAt: z.string()
}).strict()
export type GenUiStateEntry = {
  widgetId: string
  state: GenUiWidgetState
  updatedAt: string
}

export const GenUiFollowUpSchema = z.object({
  prompt: z.string().trim().min(1).max(GEN_UI_FOLLOW_UP_MAX_CHARS),
  title: z.string().trim().max(GEN_UI_TITLE_MAX_CHARS).optional()
}).strict()
export type GenUiFollowUp = z.infer<typeof GenUiFollowUpSchema>

/**
 * Select model-visible widget state for the next user message. Widgets are
 * ordered by title for stable bytes; entries without modelContent are skipped
 * and the selection stops before the byte budget is exceeded.
 */
export function selectGenUiModelContext(
  entries: ReadonlyArray<{ title: string; state: GenUiWidgetState }>
): Array<{ widget: string; state: unknown }> {
  const selected: Array<{ widget: string; state: unknown }> = []
  const ordered = [...entries].sort((left, right) => left.title.localeCompare(right.title))
  for (const entry of ordered) {
    if (entry.state.modelContent === null || entry.state.modelContent === undefined) continue
    const next = [...selected, { widget: entry.title, state: entry.state.modelContent }]
    if (utf8ByteLength(JSON.stringify(next)) > GEN_UI_MODEL_CONTEXT_MAX_BYTES) break
    selected.push({ widget: entry.title, state: entry.state.modelContent })
  }
  return selected
}
