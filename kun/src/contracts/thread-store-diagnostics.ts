import { z } from 'zod'

/**
 * Result of checking one persisted thread without changing any files.
 *
 * The doctor deliberately reports each storage surface independently. A
 * missing SQLite index is recoverable from JSONL, while invalid event data is
 * not something a repair pass may silently reconstruct.
 */
export const ThreadStoreArtifactStatus = z.enum([
  'ok',
  'missing',
  'invalid',
  'truncated',
  'mismatch'
])
export type ThreadStoreArtifactStatus = z.infer<typeof ThreadStoreArtifactStatus>

export const ThreadStoreDiagnosticSeverity = z.enum(['warning', 'error'])
export type ThreadStoreDiagnosticSeverity = z.infer<typeof ThreadStoreDiagnosticSeverity>

export const ThreadStoreDiagnosticIssue = z.object({
  // Diagnostics must remain safe to render and export even when a parser
  // reports data copied from a damaged log line.
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(1024),
  severity: ThreadStoreDiagnosticSeverity
}).strict()
export type ThreadStoreDiagnosticIssue = z.infer<typeof ThreadStoreDiagnosticIssue>

export const ThreadStoreDiagnostic = z.object({
  threadId: z.string().min(1).max(256),
  metadata: ThreadStoreArtifactStatus,
  events: ThreadStoreArtifactStatus,
  sqliteIndex: ThreadStoreArtifactStatus,
  attachments: ThreadStoreArtifactStatus,
  recoverable: z.boolean(),
  issues: z.array(ThreadStoreDiagnosticIssue).max(64),
  checkedAt: z.string().datetime({ offset: true })
}).strict()
export type ThreadStoreDiagnostic = z.infer<typeof ThreadStoreDiagnostic>

export const ThreadStoreDiagnosticReport = z.object({
  schemaVersion: z.literal(1),
  checkedAt: z.string().datetime({ offset: true }),
  threads: z.array(ThreadStoreDiagnostic)
}).strict()
export type ThreadStoreDiagnosticReport = z.infer<typeof ThreadStoreDiagnosticReport>
