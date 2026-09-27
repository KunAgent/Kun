import {
  ComposerContextAttachmentSchema,
  type ComposerContextAttachment
} from '@kun/extension-api'
import { rendererRuntimeClient } from './runtime-client'

/**
 * ADE worker notices on the composer (09 §6.2): while a manager thread's
 * composer holds a draft, the renderer renews a notice hold so wake-ups do
 * not interrupt typing; on send, pending notices are attached as a
 * worker-notices composer context and acknowledged via `ackNoticeIds`.
 */
export const WORKER_NOTICE_HOLD_MS = 45_000

export type PendingWorkerNotice = {
  noticeId: string
  workerId: string
  kind: string
  title: string
  harnessLabel?: string
  detail?: string
}

export type PendingWorkerNoticeBundle = {
  context: ComposerContextAttachment
  ackNoticeIds: string[]
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function postWorkerNoticeHold(
  threadId: string,
  holdMs: number = WORKER_NOTICE_HOLD_MS
): Promise<void> {
  try {
    await rendererRuntimeClient.runtimeRequest(
      `/v1/teams/${encodeURIComponent(threadId)}/notice-hold`,
      'POST',
      JSON.stringify({ holdMs })
    )
  } catch {
    // Best-effort: a failed hold just means a wake-up may interleave.
  }
}

/**
 * Fetch pending worker notices for a manager thread and wrap them in a
 * `worker-notices` composer context; returns null when none are pending.
 */
export async function pendingWorkerNoticeBundle(
  threadId: string,
  workspaceRoot: string,
  language?: string
): Promise<PendingWorkerNoticeBundle | null> {
  const query = language?.trim() ? `?language=${encodeURIComponent(language.trim())}` : ''
  const response = await rendererRuntimeClient.runtimeRequest(
    `/v1/teams/${encodeURIComponent(threadId)}/pending-notices${query}`,
    'GET'
  )
  if (!response.ok) return null
  const body = (
    typeof response.body === 'string' ? JSON.parse(response.body) : response.body
  ) as {
    notices?: PendingWorkerNotice[]
    text?: string
    displayText?: string
  }
  const notices = (body.notices ?? []).filter(
    (notice) => typeof notice?.noticeId === 'string' && notice.noticeId.trim().length > 0
  )
  if (!notices.length || typeof body.text !== 'string' || !body.text.trim()) return null
  const workspaceId = await sha256Hex(workspaceRoot.trim() || '__default__')
  const identity = await sha256Hex(
    JSON.stringify({ threadId, noticeIds: notices.map((notice) => notice.noticeId) })
  )
  const clip = (value: string | undefined, max = 1_900) =>
    value ? Array.from(value).slice(0, max).join('') : undefined
  const context = ComposerContextAttachmentSchema.parse({
    schemaVersion: 1,
    id: `worker-notices-${identity.slice(0, 24)}`,
    title: (body.displayText ?? 'Worker updates').slice(0, 128),
    summary: `${notices.length} pending worker update${notices.length === 1 ? '' : 's'}`,
    reference: {
      kind: 'worker-notices',
      text: clip(body.text) ?? '',
      notices: notices.map((notice) => ({
        noticeId: notice.noticeId,
        workerId: notice.workerId,
        kind: notice.kind,
        title: clip(notice.title, 240) ?? '',
        ...(notice.harnessLabel ? { harnessLabel: clip(notice.harnessLabel, 160) } : {}),
        ...(notice.detail ? { detail: clip(notice.detail) } : {})
      }))
    },
    revision: Math.max(0, Math.floor(Date.now())),
    generation: 0,
    attachmentId: `worker-notices-context:${identity}`,
    provenance: { source: 'worker-notices', workspaceId }
  })
  return { context, ackNoticeIds: notices.map((notice) => notice.noticeId) }
}

export type AdeNoticeSendExtras = {
  /** Extra composer contexts to merge into the outgoing turn (≤ 1). */
  contexts: ComposerContextAttachment[]
  /** Notice ids the send should acknowledge on admission. */
  ackNoticeIds?: string[]
}

/**
 * Resolve the worker-notice extras for one composer send (09 §6.2): on an
 * ADE manager thread the pending notices ride the user's message as a
 * `worker-notices` composer context and are acknowledged via the returned
 * ids. Queued retries reuse the ids frozen on the queued row — their
 * composerContexts already carry the matching attachment.
 */
export async function adeWorkerNoticeSendExtras(
  state: {
    activeThreadId: string | null
    threads: readonly { id: string; workspaceMode?: string; workspace?: string }[]
  },
  queuedAckIds: readonly string[] | undefined,
  language?: string
): Promise<AdeNoticeSendExtras> {
  if (queuedAckIds?.length) return { contexts: [], ackNoticeIds: [...queuedAckIds] }
  const thread = state.activeThreadId
    ? state.threads.find((entry) => entry.id === state.activeThreadId)
    : undefined
  if (thread?.workspaceMode !== 'ade' || !state.activeThreadId) return { contexts: [] }
  const bundle = await pendingWorkerNoticeBundle(
    state.activeThreadId,
    thread.workspace ?? '',
    language
  ).catch(() => null)
  return bundle
    ? { contexts: [bundle.context], ackNoticeIds: bundle.ackNoticeIds }
    : { contexts: [] }
}
