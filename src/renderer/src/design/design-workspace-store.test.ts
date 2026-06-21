import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDesignWorkspaceStore } from './design-workspace-store'
import type { DesignArtifact } from './design-types'

const createdAt = '2026-06-20T00:00:00.000Z'

function artifact(id: string, kind: DesignArtifact['kind']): DesignArtifact {
  const relativePath =
    kind === 'canvas' ? `.kun-design/${id}/canvas.json` : `.kun-design/${id}/v1.html`
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
    useDesignWorkspaceStore.setState({
      workspaceRoot: '/workspace',
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
      relativePath: '.kun-design/screen/v2.html',
      basePath: '.kun-design/screen/v1.html',
      designMdPath: '.kun-design/screen/DESIGN.md'
    })

    const state = useDesignWorkspaceStore.getState()
    const screen = state.artifacts.find((item) => item.id === 'screen')
    expect(state.activeArtifactId).toBe('canvas')
    expect(screen?.relativePath).toBe('.kun-design/screen/v2.html')
    expect(screen?.designMdPath).toBe('.kun-design/screen/DESIGN.md')
    expect(screen?.previewStatus).toBe('pending')
    expect(screen?.versions[0]).toMatchObject({
      id: 'screen-v2',
      relativePath: '.kun-design/screen/v2.html',
      summary: 'Make it a login screen'
    })
    expect(writeWorkspaceFile).toHaveBeenCalledWith(expect.objectContaining({
      path: '.kun-design/screen/meta.json',
      workspaceRoot: '/workspace',
      content: expect.stringContaining('.kun-design/screen/v2.html')
    }))
  })
})
