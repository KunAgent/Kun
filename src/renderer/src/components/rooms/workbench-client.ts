import type { ConfirmWorkbenchLink, WorkbenchDirectory, WorkbenchLinkEntry, WorkbenchLinkStatus } from '@shared/rooms-api'
import { roomPath, roomRequestId, roomsRequest } from './rooms-client'

const linkPath = (roomId: string, linkId: string): string =>
  `${roomPath(roomId)}/workbench-links/${encodeURIComponent(linkId)}`

/** Statuses that still occupy the Agent: shown in the conversation header and never treated as final. */
export const WORKBENCH_LIVE_STATUSES: readonly WorkbenchLinkStatus[] = ['queued', 'running', 'needs_attention', 'recovery_required', 'scheduled', 'missed', 'plan_ready', 'active', 'paused']
export const WORKBENCH_FINAL_STATUSES: readonly WorkbenchLinkStatus[] = ['completed', 'failed', 'cancelled', 'dismissed', 'ended']

const decision = async (link: Pick<WorkbenchLinkEntry, 'roomId' | 'id' | 'revision'>, action: string,
  edits?: ConfirmWorkbenchLink['edits'], clientRequestId = roomRequestId()): Promise<WorkbenchLinkEntry> =>
  (await roomsRequest<{ link: WorkbenchLinkEntry }>(`${linkPath(link.roomId, link.id)}/${action}`, 'POST',
    { clientRequestId, expectedRevision: link.revision, ...(edits ? { edits } : {}) })).link

/** Card + header client for the Code/Work hand-offs a bot Agent proposes. */
export const workbenchClient = {
  get: async (roomId: string, linkId: string, signal?: AbortSignal): Promise<WorkbenchLinkEntry> =>
    (await roomsRequest<{ link: WorkbenchLinkEntry }>(linkPath(roomId, linkId), 'GET', undefined, signal)).link,
  list: (roomId: string, statuses?: readonly WorkbenchLinkStatus[], signal?: AbortSignal) =>
    roomsRequest<{ links: WorkbenchLinkEntry[]; nextCursor?: string }>(
      `${roomPath(roomId)}/workbench-links?limit=50${statuses?.length ? '&status=' + statuses.join(',') : ''}`, 'GET', undefined, signal),
  confirm: async (link: Pick<WorkbenchLinkEntry, 'roomId' | 'id' | 'revision'>, edits?: ConfirmWorkbenchLink['edits'],
    clientRequestId = roomRequestId()): Promise<WorkbenchLinkEntry> => decision(link, 'confirm', edits, clientRequestId),
  update: (link: Pick<WorkbenchLinkEntry, 'roomId' | 'id' | 'revision'>, edits: ConfirmWorkbenchLink['edits']) => decision(link, 'update', edits),
  runNow: (link: Pick<WorkbenchLinkEntry, 'roomId' | 'id' | 'revision'>) => decision(link, 'run-now'),
  pause: (link: Pick<WorkbenchLinkEntry, 'roomId' | 'id' | 'revision'>) => decision(link, 'pause'),
  resume: (link: Pick<WorkbenchLinkEntry, 'roomId' | 'id' | 'revision'>) => decision(link, 'resume'),
  build: (link: Pick<WorkbenchLinkEntry, 'roomId' | 'id' | 'revision'>) => decision(link, 'build'),
  skip: (link: Pick<WorkbenchLinkEntry, 'roomId' | 'id' | 'revision'>) => decision(link, 'skip'),
  dismiss: async (link: Pick<WorkbenchLinkEntry, 'roomId' | 'id' | 'revision'>, clientRequestId = roomRequestId()): Promise<WorkbenchLinkEntry> =>
    (await roomsRequest<{ link: WorkbenchLinkEntry }>(`${linkPath(link.roomId, link.id)}/dismiss`, 'POST',
      { clientRequestId, expectedRevision: link.revision })).link,
  cancel: async (link: Pick<WorkbenchLinkEntry, 'roomId' | 'id' | 'revision'>, clientRequestId = roomRequestId()): Promise<WorkbenchLinkEntry> =>
    (await roomsRequest<{ link: WorkbenchLinkEntry }>(`${linkPath(link.roomId, link.id)}/cancel`, 'POST',
      { clientRequestId, expectedRevision: link.revision })).link,
  watch: async (roomId: string, threadId: string, title?: string): Promise<WorkbenchLinkEntry> =>
    (await roomsRequest<{ link: WorkbenchLinkEntry }>(`${roomPath(roomId)}/workbench-links/watch`, 'POST',
      { clientRequestId: roomRequestId(), threadId, ...(title ? { title } : {}) })).link,
  getDirectory: () => roomsRequest<WorkbenchDirectory>('/v1/workbench/directory'),
  setDirectory: (directory: WorkbenchDirectory) => roomsRequest<WorkbenchDirectory>('/v1/workbench/directory', 'PUT', directory)
}
