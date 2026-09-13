import { z } from 'zod'

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
export const HistoryReferenceSchema = z.object({
  id: z.string().min(1),
  provider: z.literal('codex'),
  sessionId: z.string().min(1),
  title: z.string(),
  workspace: z.string(),
  createdAt: z.string(),
  cutoffTurnId: z.string().min(1),
  files: z.array(HistorySourceFileSchema).min(1).max(16),
  parserVersion: z.literal(1),
  warnings: z.array(z.string()).default([])
})
export type HistoryReference = z.infer<typeof HistoryReferenceSchema>

export interface CodexSessionSummary {
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
  /** Bounded preview only; never stored in HistoryReference. */
  label: string
}
