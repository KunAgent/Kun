import type { WorkspaceFileReadResult, WorkspaceFileTarget } from '@shared/workspace-file'
import {
  forgetRememberedSddDraft,
  readRememberedSddDraftContent,
  readRememberedSddDraft,
  type SddDraft,
  type SddDraftSaveStatus
} from './sdd-draft-store'

export type RestoredSddDraft = {
  kind: 'restored'
  draft: SddDraft
  content: string
  lastSavedContent: string
  saveStatus: SddDraftSaveStatus
}

export type UnrestorableSddDraft =
  | { kind: 'missing' }
  | { kind: 'unreadable'; draft: SddDraft; message: string }

export type RestoreRememberedSddDraftResult = RestoredSddDraft | UnrestorableSddDraft

type RestoreRememberedSddDraftOptions = {
  workspaceRoot: string
  readWorkspaceFile: (options: WorkspaceFileTarget) => Promise<WorkspaceFileReadResult>
}

function timestampMs(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export async function restoreRememberedSddDraft({
  workspaceRoot,
  readWorkspaceFile
}: RestoreRememberedSddDraftOptions): Promise<RestoreRememberedSddDraftResult> {
  const remembered = readRememberedSddDraft(workspaceRoot)
  if (!remembered) return { kind: 'missing' }

  const result = await readWorkspaceFile({
    workspaceRoot: remembered.workspaceRoot,
    path: remembered.relativePath
  })
  if (!result.ok) {
    forgetRememberedSddDraft(remembered)
    return { kind: 'unreadable', draft: remembered, message: result.message }
  }

  const contentSnapshot = readRememberedSddDraftContent(remembered)
  const snapshotLooksNewer =
    contentSnapshot &&
    contentSnapshot.content !== contentSnapshot.lastSavedContent &&
    contentSnapshot.content !== result.content &&
    timestampMs(contentSnapshot.updatedAt) > timestampMs(remembered.updatedAt)
  const content = snapshotLooksNewer ? contentSnapshot.content : result.content

  return {
    kind: 'restored',
    draft: { ...remembered, absolutePath: result.path },
    content,
    lastSavedContent: result.content,
    saveStatus: content === result.content ? 'saved' : 'dirty'
  }
}
