import { createHash } from 'node:crypto'
import { z } from 'zod'

/**
 * Subagents spawned by an external Agent (OpenCode, CodeMaker, Codex, Claude
 * Code, Devin) are presented with the same card as Kun's own subagents. The
 * adapter that maps the Agent's stream puts this record on the parent tool
 * item's `meta`; the GUI turns it into child-card metadata, and the
 * {@link ExternalSubagentStore} mirrors the subagent's own steps into a hidden
 * `side` thread so the card can preview and open it.
 */
export const EXTERNAL_SUBAGENT_META_KEY = 'externalSubagent'

export const ExternalSubagentSource = z.enum([
  'opencode',
  'opencode2',
  'codemaker',
  'codex',
  'claude-code',
  'devin'
])
export type ExternalSubagentSource = z.infer<typeof ExternalSubagentSource>

export const ExternalSubagentStatus = z.enum([
  'queued',
  'running',
  'awaiting',
  'completed',
  'failed',
  'aborted'
])
export type ExternalSubagentStatus = z.infer<typeof ExternalSubagentStatus>

export const ExternalSubagentPresentation = z.object({
  version: z.literal(1),
  source: ExternalSubagentSource,
  /** Kun side thread mirroring the subagent; absent when its steps cannot be read. */
  childThreadId: z.string().min(1).max(128).optional(),
  /** The Agent's own id for the subagent (session, thread, task or agent id). */
  nativeId: z.string().min(1).max(256).optional(),
  /** Subagent type exactly as the Agent names it; may be user defined. */
  profile: z.string().min(1).max(200).optional(),
  label: z.string().min(1).max(500).optional(),
  model: z.string().min(1).max(200).optional(),
  status: ExternalSubagentStatus,
  /** Runs in the background: the parent does not wait for it. */
  detached: z.boolean().optional(),
  steps: z.number().int().nonnegative().optional(),
  /** Short "what it is doing now" line, never tool output. */
  activity: z.string().min(1).max(500).optional(),
  summary: z.string().min(1).max(4000).optional(),
  error: z.string().min(1).max(1000).optional(),
  /** Times the parent polled or waited for this subagent. */
  progressChecks: z.number().int().nonnegative().optional(),
  /** The parent closed or cancelled the subagent. */
  closedByParent: z.boolean().optional(),
  /** The parent turn ended while the subagent was still unreported. */
  endedWithTurn: z.boolean().optional(),
  /** Why the subagent's steps cannot be shown. */
  unavailableReason: z.string().min(1).max(300).optional(),
  /** A permission request is pending; `native` means only the Agent can answer it. */
  awaitingPermission: z.enum(['kun', 'native']).optional(),
  /** Whether Kun can stop this one subagent without ending the turn. */
  stoppable: z.boolean().optional(),
  startedAt: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional()
}).strict()
export type ExternalSubagentPresentation = z.infer<typeof ExternalSubagentPresentation>

export const EXTERNAL_SUBAGENT_TERMINAL_STATUSES: ReadonlySet<ExternalSubagentStatus> =
  new Set(['completed', 'failed', 'aborted'])

export function isTerminalExternalSubagentStatus(status: ExternalSubagentStatus): boolean {
  return EXTERNAL_SUBAGENT_TERMINAL_STATUSES.has(status)
}

/** Read a valid presentation from item meta; invalid or foreign values are ignored. */
export function readExternalSubagent(meta: unknown): ExternalSubagentPresentation | undefined {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return undefined
  const parsed = ExternalSubagentPresentation.safeParse((meta as Record<string, unknown>)[EXTERNAL_SUBAGENT_META_KEY])
  return parsed.success ? parsed.data : undefined
}

/**
 * Deterministic side-thread id for one subagent call. Pure mappers can derive
 * it without IO, and a replayed call maps onto the same thread.
 */
export function externalSubagentThreadId(parentThreadId: string, callId: string): string {
  const digest = createHash('sha256').update(`${parentThreadId}\u0000${callId}`).digest('hex')
  return `xsub_${digest.slice(0, 24)}`
}

export function isExternalSubagentThreadId(threadId: string): boolean {
  return /^xsub_[a-f0-9]{24}$/.test(threadId)
}

export function externalSubagentTurnId(childThreadId: string): string {
  return `${childThreadId}_turn`
}

/** Clip free text to a schema bound without splitting a surrogate pair. */
export function clipExternalText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.length <= max) return trimmed
  const cut = Array.from(trimmed).slice(0, Math.max(1, max - 1)).join('')
  return `${cut.slice(0, max - 1)}…`
}
