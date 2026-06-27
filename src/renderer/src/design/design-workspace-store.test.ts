import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDesignWorkspaceStore } from './design-workspace-store'
import { buildHtmlSiblingManifest } from './design-pages'
import type { DesignArtifact, DesignDocument } from './design-types'

const createdAt = '2026-06-20T00:00:00.000Z'

function artifact(id: string, kind: DesignArtifact['kind']): DesignArtifact {
  const relativePath =
    kind === 'canvas' ? `.kun-design/doc/${id}/canvas.json` : `.kun-design/doc/${id}/v1.html`
  return {
    id,
    kind,
    title: id,
    relativePath,
    createdAt,
    updatedAt: createdAt,
    versions: [{ id: `${id}-v1`, relativePath, createdAt, summary: '' }]
  }
}

describe('design workspace store', () => {
  const writeWorkspaceFile = vi.fn(async () => ({ ok: true as const }))

  beforeEach(() => {
    writeWorkspaceFile.mockClear()
    vi.stubGlobal('window', { kunGui: { writeWorkspaceFile } })
    const canvas = artifact('canvas', 'canvas')
    const screen = artifact('screen', 'html')
    const doc: DesignDocument = {
      id: 'doc',
      title: 'Doc',
      createdAt,
      updatedAt: createdAt,
      order: 0,
      artifacts: [canvas, screen],
      activeArtifactId: canvas.id
    }
    useDesignWorkspaceStore.setState({
      workspaceRoot: '/workspace',
      documents: [doc],
      activeDocumentId: 'doc',
      artifacts: [canvas, screen],
      activeArtifactId: canvas.id,
      designIntentMode: 'modify',
      fileError: null
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('can append an HTML version without activating that artifact', () => {
    const result = useDesignWorkspaceStore
      .getState()
      .prepareHtmlTurn('Make it a login screen', { artifactId: 'screen', activate: false })

    expect(result).toEqual({
      artifactId: 'screen',
      relativePath: '.kun-design/doc/screen/v2.html',
      basePath: '.kun-design/doc/screen/v1.html',
      designMdPath: '.kun-design/doc/screen/DESIGN.md'
    })

    const state = useDesignWorkspaceStore.getState()
    const screen = state.artifacts.find((item) => item.id === 'screen')
    expect(state.activeArtifactId).toBe('canvas')
    expect(screen?.relativePath).toBe('.kun-design/doc/screen/v2.html')
    expect(screen?.designMdPath).toBe('.kun-design/doc/screen/DESIGN.md')
    expect(screen?.previewStatus).toBe('pending')
    expect(screen?.versions[0]).toMatchObject({
      id: 'screen-v2',
      relativePath: '.kun-design/doc/screen/v2.html',
      summary: 'Make it a login screen'
    })
    expect(writeWorkspaceFile).toHaveBeenCalledWith(expect.objectContaining({
      path: '.kun-design/doc/screen/meta.json',
      workspaceRoot: '/workspace',
      content: expect.stringContaining('.kun-design/doc/screen/v2.html')
    }))
  })

  it('setVersionSummary writes the agent summary back so the sibling manifest surfaces it', () => {
    const versionId = useDesignWorkspaceStore.getState().artifacts.find((a) => a.id === 'screen')!.versions[0].id
    useDesignWorkspaceStore.getState().setVersionSummary('screen', versionId, '  A clean login screen with email + SSO  ')

    const updated = useDesignWorkspaceStore.getState().artifacts.find((a) => a.id === 'screen')!
    expect(updated.versions[0].summary).toBe('A clean login screen with email + SSO')

    const manifest = buildHtmlSiblingManifest(useDesignWorkspaceStore.getState().artifacts, null)
    expect(manifest.find((entry) => entry.htmlPath === updated.relativePath)?.summary).toBe(
      'A clean login screen with email + SSO'
    )
  })

  it('setVersionSummary no-ops on empty text or unknown ids', () => {
    const before = useDesignWorkspaceStore.getState().artifacts.find((a) => a.id === 'screen')!.versions[0].summary
    const versionId = useDesignWorkspaceStore.getState().artifacts.find((a) => a.id === 'screen')!.versions[0].id
    useDesignWorkspaceStore.getState().setVersionSummary('screen', versionId, '   ')
    useDesignWorkspaceStore.getState().setVersionSummary('screen', 'screen-vNope', 'ignored')
    useDesignWorkspaceStore.getState().setVersionSummary('missing', versionId, 'ignored')
    expect(useDesignWorkspaceStore.getState().artifacts.find((a) => a.id === 'screen')!.versions[0].summary).toBe(before)
  })

  it('createDocument adds a new active 设计稿 with an empty projection', () => {
    const id = useDesignWorkspaceStore.getState().createDocument('Second')
    const state = useDesignWorkspaceStore.getState()
    expect(state.documents).toHaveLength(2)
    expect(state.activeDocumentId).toBe(id)
    expect(state.documents.find((d) => d.id === id)?.title).toBe('Second')
    expect(state.artifacts).toEqual([])
    expect(state.activeArtifactId).toBeNull()
  })

  it('new 画布 nest under the active 设计稿 directory', () => {
    const id = useDesignWorkspaceStore.getState().createDocument('Second')
    const { artifactId, relativePath } = useDesignWorkspaceStore.getState().prepareHtmlTurn('A landing page')
    expect(relativePath).toBe(`.kun-design/${id}/${artifactId}/v1.html`)
    expect(useDesignWorkspaceStore.getState().artifacts.map((a) => a.id)).toContain(artifactId)
  })

  it('switchActiveDocument re-projects to the target 设计稿', () => {
    const second = useDesignWorkspaceStore.getState().createDocument('Second')
    useDesignWorkspaceStore.getState().switchActiveDocument('doc')
    expect(useDesignWorkspaceStore.getState().artifacts.map((a) => a.id).sort()).toEqual(['canvas', 'screen'])
    useDesignWorkspaceStore.getState().switchActiveDocument(second)
    expect(useDesignWorkspaceStore.getState().artifacts).toEqual([])
  })

  it('removeDocument drops it and falls back to a remaining 设计稿', () => {
    const second = useDesignWorkspaceStore.getState().createDocument('Second')
    useDesignWorkspaceStore.getState().removeDocument(second)
    const state = useDesignWorkspaceStore.getState()
    expect(state.documents.map((d) => d.id)).toEqual(['doc'])
    expect(state.activeDocumentId).toBe('doc')
    expect(state.artifacts.map((a) => a.id).sort()).toEqual(['canvas', 'screen'])
  })
})
