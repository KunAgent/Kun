import { z } from 'zod'

export const HistorySourceProviderSchema = z.enum(['codex', 'claude-code', 'opencode'])
export type HistorySourceProvider = z.infer<typeof HistorySourceProviderSchema>

export const HistorySourceStatusSchema = z.enum(['available', 'missing', 'changed', 'partial'])
export type HistorySourceStatus = z.infer<typeof HistorySourceStatusSchema>

/** Offsets and fingerprints are over decoded JSONL bytes, including newlines. */
export const HistorySourceFileSchema = z.object({
  path: z.string().min(1),
  sessionId: z.string().min(1),
  byteLength: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  recordCount: z.number().int().nonnegative()
})
export type HistorySourceFile = z.infer<typeof HistorySourceFileSchema>

/** Contains identity and positions only, never historical message bodies. */
const JsonlHistoryReferenceSchema = z.object({
  id: z.string().min(1),
  provider: z.enum(['codex', 'claude-code']),
  sessionId: z.string().min(1),
  title: z.string(),
  workspace: z.string(),
  createdAt: z.string(),
  cutoffTurnId: z.string().min(1),
  files: z.array(HistorySourceFileSchema).min(1).max(16),
  parserVersion: z.literal(1),
  warnings: z.array(z.string()).default([])
})
export const OpenCodeSourceKindSchema = z.enum(['sqlite', 'legacy', 'export'])
export const OpenCodeSourceSchema = z.object({
  kind: OpenCodeSourceKindSchema,
  path: z.string().min(1),
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,256}$/u)
})
export const OpenCodeRecordPointerSchema = z.object({
  kind: z.enum(['message', 'part']),
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,256}$/u),
  messageId: z.string().regex(/^[a-zA-Z0-9_-]{1,256}$/u),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u)
})
const OpenCodeHistoryReferenceSchema = JsonlHistoryReferenceSchema.extend({
  provider: z.literal('opencode'), parserVersion: z.literal(2),
  files: z.array(HistorySourceFileSchema).max(0).default([]),
  source: OpenCodeSourceSchema,
  sourceWorkspace: z.string(),
  records: z.array(OpenCodeRecordPointerSchema).min(1).max(10000)
})
export const HistoryReferenceSchema = z.discriminatedUnion('provider', [JsonlHistoryReferenceSchema, OpenCodeHistoryReferenceSchema]).superRefine((ref, ctx) => {
  if (ref.provider !== 'opencode') return
  const identities = new Set(ref.records.map((r) => `${r.kind}:${r.id}`))
  const messages = new Set(ref.records.filter((r) => r.kind === 'message').map((r) => r.id))
  if (ref.source.sessionId !== ref.sessionId || identities.size !== ref.records.length ||
      ref.records.some((r) => !messages.has(r.messageId) || (r.kind === 'message' && r.id !== r.messageId))) {
    ctx.addIssue({ code: 'custom', message: 'Invalid OpenCode reference record identities.' })
  }
})
export type OpenCodeSource = z.infer<typeof OpenCodeSourceSchema>
export type OpenCodeRecordPointer = z.infer<typeof OpenCodeRecordPointerSchema>
export type OpenCodeHistoryReference = z.infer<typeof OpenCodeHistoryReferenceSchema>
export type HistoryReference = z.infer<typeof HistoryReferenceSchema>

export interface CodexSessionSummary {
  sourceKind?: z.infer<typeof OpenCodeSourceKindSchema>
  sessionId: string
  path: string
  title: string
  workspace: string
  updatedAt: string
  archived: boolean
}

export interface HistoryCutoff {
  turnId: string
  createdAt: string
  /** Effective source workspace at this completed branch point. */
  workspace?: string
  /** Bounded preview only; never stored in HistoryReference. */
  label: string
}
