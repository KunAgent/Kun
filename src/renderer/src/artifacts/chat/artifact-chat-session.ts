import { create } from 'zustand'
import type { WorkspaceOfficePreviewSuccess } from '@shared/office-document'
import type { OfficeVersionEntry } from '@shared/office-version'
import {
  composerFileReferenceFromPath,
  composerFileReferenceKey,
  mergeComposerFileReferences,
  type ComposerFileReference
} from '../../lib/composer-file-references'
import type { LibraryArtifact } from '../artifact-types'
import { changeIsEmpty, diffOfficeVersions, officeFormatForPath, type ArtifactOfficeChange } from './artifact-office-diff'

/**
 * Per-artifact state behind the chat panel: the file as it was before the
 * turn the panel sent, the change that turn made, the kept versions and the
 * version shown in compare mode. Snapshots go to the main-process version
 * store only once Kun actually changed the file.
 */

export type ArtifactPendingTurn = {
  threadId: string
  label: string
  beforeData: Uint8Array
  beforeSha: string
  /** The turn was seen running; its end finalizes the pending entry. */
  sawBusy: boolean
  versionId?: string
  afterSha?: string
}

export type ArtifactLatestChange = {
  versionId: string
  label: string
  beforeSha: string
  afterSha: string
  change: ArtifactOfficeChange
  at: number
}

export type ArtifactCompare = { versionId: string; label: string; createdAt: string; data: Uint8Array; sha: string }

export type ArtifactChatNotice = 'no-change' | 'external-change' | 'restored' | { error: string } | null

type SessionState = {
  pending: Record<string, ArtifactPendingTurn>
  latest: Record<string, ArtifactLatestChange | null>
  versions: Record<string, OfficeVersionEntry[]>
  compare: Record<string, ArtifactCompare | null>
  notice: Record<string, ArtifactChatNotice>
  restoring: Record<string, boolean>
  /** Content a restore just wrote; its reload is not an outside change. */
  expectedSha: Record<string, string>
  /** Files @-referenced in the panel composer, consumed by the next send. */
  references: Record<string, ComposerFileReference[]>
}

export const useArtifactChatSession = create<SessionState>(() => ({
  pending: {}, latest: {}, versions: {}, compare: {}, notice: {}, restoring: {}, expectedSha: {}, references: {}
}))

function patch<K extends keyof SessionState>(key: K, artifactId: string, value: SessionState[K][string]): void {
  useArtifactChatSession.setState((state) => ({ [key]: { ...state[key], [artifactId]: value } }) as Partial<SessionState>)
}

function dropPending(artifactId: string): void {
  useArtifactChatSession.setState((state) => {
    const { [artifactId]: _done, ...pending } = state.pending
    return { pending }
  })
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

const target = (artifact: Pick<LibraryArtifact, 'path' | 'workspaceRoot'>) => ({ path: artifact.path, workspaceRoot: artifact.workspaceRoot })

export async function loadArtifactVersions(artifact: LibraryArtifact): Promise<void> {
  const result = await window.kunGui?.listOfficeVersions?.(target(artifact)).catch(() => null)
  if (result?.ok) patch('versions', artifact.id, result.entries)
}

/** Called right before the panel sends: remembers the file the turn starts from. */
export function beginArtifactTurn(artifact: LibraryArtifact, preview: WorkspaceOfficePreviewSuccess, threadId: string, label: string, busy: boolean): void {
  patch('pending', artifact.id, {
    threadId, label, beforeData: preview.data, beforeSha: preview.sourceSha256, sawBusy: busy
  })
  patch('notice', artifact.id, null)
}

export function cancelArtifactTurn(artifactId: string): void {
  cancelSettle(artifactId)
  dropPending(artifactId)
}

/** The preview reloaded: if a panel turn is running and the file changed, record and describe the change. */
export async function observeArtifactPreview(artifact: LibraryArtifact, preview: WorkspaceOfficePreviewSuccess): Promise<void> {
  const pending = useArtifactChatSession.getState().pending[artifact.id]
  if (!pending) return
  if (preview.sourceSha256 === pending.beforeSha || preview.sourceSha256 === pending.afterSha) return
  patch('pending', artifact.id, { ...pending, afterSha: preview.sourceSha256 })
  let versionId = pending.versionId
  if (!versionId) {
    const recorded = await window.kunGui?.recordOfficeVersion?.({
      ...target(artifact),
      dataBase64: bytesToBase64(pending.beforeData),
      sha256: pending.beforeSha,
      replacedBySha256: preview.sourceSha256,
      label: pending.label,
      threadId: pending.threadId
    }).catch(() => null)
    if (!recorded?.ok) return
    versionId = recorded.entry.id
    const current = useArtifactChatSession.getState().pending[artifact.id]
    if (current) patch('pending', artifact.id, { ...current, versionId })
    void loadArtifactVersions(artifact)
  }
  const format = officeFormatForPath(artifact.path)
  const change: ArtifactOfficeChange = format
    ? await diffOfficeVersions(format, pending.beforeData, preview.data)
    : { kind: 'unknown' }
  if (changeIsEmpty(change)) return
  patch('latest', artifact.id, {
    versionId, label: pending.label, beforeSha: pending.beforeSha, afterSha: preview.sourceSha256, change, at: Date.now()
  })
}

/** The file watcher can report Kun's last write just after the turn ends. */
export const ARTIFACT_TURN_SETTLE_MS = 1_500
const settleTimers = new Map<string, ReturnType<typeof setTimeout>>()

function cancelSettle(artifactId: string): void {
  const timer = settleTimers.get(artifactId)
  if (timer) clearTimeout(timer)
  settleTimers.delete(artifactId)
}

/** Busy flips for the bound thread: the end of the panel's turn (and its queue) closes the pending entry. */
export function observeArtifactBusy(artifact: LibraryArtifact, threadId: string | null, busy: boolean, queued: number): void {
  const pending = useArtifactChatSession.getState().pending[artifact.id]
  if (!pending || pending.threadId !== threadId) return
  if (busy || queued > 0) {
    cancelSettle(artifact.id)
    if (busy && !pending.sawBusy) patch('pending', artifact.id, { ...pending, sawBusy: true })
    return
  }
  if (!pending.sawBusy || settleTimers.has(artifact.id)) return
  settleTimers.set(artifact.id, setTimeout(() => {
    settleTimers.delete(artifact.id)
    const settled = useArtifactChatSession.getState().pending[artifact.id]
    if (!settled || settled.threadId !== threadId) return
    if (!settled.versionId) patch('notice', artifact.id, 'no-change')
    dropPending(artifact.id)
  }, ARTIFACT_TURN_SETTLE_MS))
}

export function noteExternalChange(artifactId: string, sha: string): void {
  const state = useArtifactChatSession.getState()
  if (state.pending[artifactId] || state.restoring[artifactId]) return
  if (state.expectedSha[artifactId] === sha) {
    patch('expectedSha', artifactId, '')
    return
  }
  patch('notice', artifactId, 'external-change')
}

export function dismissArtifactNotice(artifactId: string): void {
  patch('notice', artifactId, null)
}

export function dismissArtifactChange(artifactId: string): void {
  patch('latest', artifactId, null)
}

export async function openArtifactCompare(artifact: LibraryArtifact, versionId: string): Promise<void> {
  const result = await window.kunGui?.readOfficeVersion?.({ ...target(artifact), id: versionId }).catch(() => null)
  if (!result?.ok) {
    patch('notice', artifact.id, { error: result?.message ?? 'unavailable' })
    return
  }
  patch('compare', artifact.id, {
    versionId, label: result.entry.label, createdAt: result.entry.createdAt,
    data: base64ToBytes(result.dataBase64), sha: result.entry.sha256
  })
}

export function closeArtifactCompare(artifactId: string): void {
  patch('compare', artifactId, null)
}

/** Puts a kept version back; the current content becomes a version itself. */
export async function restoreArtifactVersion(artifact: LibraryArtifact, versionId: string, currentSha: string): Promise<boolean> {
  patch('restoring', artifact.id, true)
  try {
    const result = await window.kunGui?.restoreOfficeVersion?.({ ...target(artifact), id: versionId, expectedSha256: currentSha })
      .catch((error: unknown) => ({ ok: false as const, code: 'io' as const, message: error instanceof Error ? error.message : String(error) }))
    if (!result?.ok) {
      patch('notice', artifact.id, { error: result?.message ?? 'unavailable' })
      return false
    }
    patch('expectedSha', artifact.id, result.sha256)
    patch('latest', artifact.id, null)
    patch('compare', artifact.id, null)
    patch('notice', artifact.id, 'restored')
    await loadArtifactVersions(artifact)
    return true
  } finally {
    patch('restoring', artifact.id, false)
  }
}

export function addArtifactReference(artifactId: string, reference: ComposerFileReference): void {
  const current = useArtifactChatSession.getState().references[artifactId] ?? []
  patch('references', artifactId, mergeComposerFileReferences(current, reference))
}

export function removeArtifactReference(artifactId: string, relativePath: string): void {
  const current = useArtifactChatSession.getState().references[artifactId] ?? []
  patch('references', artifactId, current.filter((reference) => reference.relativePath !== relativePath))
}

export function consumeArtifactReferences(artifactId: string, sent: readonly ComposerFileReference[]): void {
  const keys = new Set(sent.map(composerFileReferenceKey))
  const current = useArtifactChatSession.getState().references[artifactId] ?? []
  patch('references', artifactId, current.filter((reference) => !keys.has(composerFileReferenceKey(reference))))
}

/** "Add local files": the picker opens in the artifact's project; outside files keep absolute paths. */
export async function pickArtifactReferences(artifact: Pick<LibraryArtifact, 'id' | 'workspaceRoot'>): Promise<void> {
  if (typeof window.kunGui?.pickLocalFiles !== 'function') return
  const result = await window.kunGui.pickLocalFiles(artifact.workspaceRoot || undefined)
  if (result.canceled) return
  for (const path of result.paths) {
    addArtifactReference(artifact.id, composerFileReferenceFromPath(path, artifact.workspaceRoot ? [artifact.workspaceRoot] : []))
  }
}
