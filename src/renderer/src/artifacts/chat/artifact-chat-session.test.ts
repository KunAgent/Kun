import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceOfficePreviewSuccess } from '@shared/office-document'
import type { LibraryArtifact } from '../artifact-types'
import {
  ARTIFACT_TURN_SETTLE_MS,
  base64ToBytes,
  beginArtifactTurn,
  bytesToBase64,
  noteExternalChange,
  observeArtifactBusy,
  observeArtifactPreview,
  restoreArtifactVersion,
  useArtifactChatSession
} from './artifact-chat-session'

const artifact = {
  id: 'doc:/repo:paper.docx', kind: 'doc', title: 'paper', workspaceRoot: '/repo',
  projectName: 'repo', path: 'paper.docx', ext: '.docx', updatedAt: 1
} as LibraryArtifact

async function docx(text: string): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('word/document.xml', `<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`)
  return zip.generateAsync({ type: 'uint8array' })
}

function preview(data: Uint8Array, sha: string): WorkspaceOfficePreviewSuccess {
  return { ok: true, path: '/repo/paper.docx', name: 'paper.docx', sourceFormat: 'docx', renderFormat: 'docx', viewer: 'word', size: data.length, mtimeMs: 1, sourceSha256: sha, data }
}

describe('artifact chat session', () => {
  const recordOfficeVersion = vi.fn(async (_payload: Record<string, unknown>) => ({ ok: true as const, entry: { id: 'v1', createdAt: '', sha256: 'a'.repeat(64), size: 1, label: 'x', reason: 'agent-edit' as const } }))
  const listOfficeVersions = vi.fn(async () => ({ ok: true as const, entries: [] }))
  const restoreOfficeVersion = vi.fn(async () => ({ ok: true as const, sha256: 'b'.repeat(64), backup: { id: 'v2', createdAt: '', sha256: 'c'.repeat(64), size: 1, label: 'x', reason: 'restore' as const } }))

  beforeEach(() => {
    vi.stubGlobal('window', { kunGui: { recordOfficeVersion, listOfficeVersions, restoreOfficeVersion } })
    useArtifactChatSession.setState({ pending: {}, latest: {}, versions: {}, compare: {}, notice: {}, restoring: {}, expectedSha: {}, references: {} })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('round-trips base64', () => {
    const bytes = new Uint8Array(70_000).map((_, index) => index % 251)
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })

  it('records the pre-turn file once Kun changes it and describes the change', async () => {
    const before = await docx('old text')
    const after = await docx('new text')
    beginArtifactTurn(artifact, preview(before, 'a'.repeat(64)), 'thread-1', 'Rewrite it', false)
    await observeArtifactPreview(artifact, preview(before, 'a'.repeat(64)))
    expect(recordOfficeVersion).not.toHaveBeenCalled()

    await observeArtifactPreview(artifact, preview(after, 'b'.repeat(64)))
    expect(recordOfficeVersion).toHaveBeenCalledTimes(1)
    expect(recordOfficeVersion.mock.calls[0]![0]).toMatchObject({
      path: 'paper.docx', workspaceRoot: '/repo', sha256: 'a'.repeat(64), replacedBySha256: 'b'.repeat(64), label: 'Rewrite it', threadId: 'thread-1'
    })
    expect(useArtifactChatSession.getState().latest[artifact.id]).toMatchObject({
      versionId: 'v1', change: { kind: 'word', changedCount: 1, paragraphs: [{ before: 'old text', after: 'new text' }] }
    })
  })

  it('closes the turn shortly after the thread goes idle, noting when nothing changed', () => {
    vi.useFakeTimers()
    beginArtifactTurn(artifact, preview(new Uint8Array([1]), 'a'.repeat(64)), 'thread-1', 'Explain it', false)
    observeArtifactBusy(artifact, 'thread-1', false, 0)
    vi.advanceTimersByTime(ARTIFACT_TURN_SETTLE_MS)
    expect(useArtifactChatSession.getState().pending[artifact.id]).toBeDefined()
    observeArtifactBusy(artifact, 'thread-1', true, 0)
    observeArtifactBusy(artifact, 'thread-1', false, 1)
    vi.advanceTimersByTime(ARTIFACT_TURN_SETTLE_MS)
    expect(useArtifactChatSession.getState().pending[artifact.id]).toBeDefined()
    observeArtifactBusy(artifact, 'thread-1', false, 0)
    expect(useArtifactChatSession.getState().pending[artifact.id]).toBeDefined()
    vi.advanceTimersByTime(ARTIFACT_TURN_SETTLE_MS)
    expect(useArtifactChatSession.getState().pending[artifact.id]).toBeUndefined()
    expect(useArtifactChatSession.getState().notice[artifact.id]).toBe('no-change')
    vi.useRealTimers()
  })

  it('flags outside changes but not the reload that follows a restore', async () => {
    noteExternalChange(artifact.id, 'x'.repeat(64))
    expect(useArtifactChatSession.getState().notice[artifact.id]).toBe('external-change')
    expect(await restoreArtifactVersion(artifact, 'v1', 'a'.repeat(64))).toBe(true)
    expect(restoreOfficeVersion).toHaveBeenCalledWith({ path: 'paper.docx', workspaceRoot: '/repo', id: 'v1', expectedSha256: 'a'.repeat(64) })
    expect(useArtifactChatSession.getState().notice[artifact.id]).toBe('restored')
    noteExternalChange(artifact.id, 'b'.repeat(64))
    expect(useArtifactChatSession.getState().notice[artifact.id]).toBe('restored')
  })
})
