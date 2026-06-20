import { describe, expect, it } from 'vitest'
import type { DesignArtifact } from './design-types'
import { canImplementDesignArtifact, groupDesignArtifacts } from './design-artifact-actions'
import { useDesignWorkspaceStore } from './design-workspace-store'

function artifact(id: string, kind: DesignArtifact['kind']): DesignArtifact {
  const createdAt = '2026-06-20T00:00:00.000Z'
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

describe('design artifact actions', () => {
  it('groups HTML drafts separately from design canvases while preserving order', () => {
    const first = artifact('first-html', 'html')
    const canvas = artifact('canvas', 'canvas')
    const second = artifact('second-html', 'html')

    expect(groupDesignArtifacts([first, canvas, second])).toEqual({
      html: [first, second],
      canvas: [canvas]
    })
  })

  it('only allows HTML design artifacts to be implemented directly', () => {
    expect(canImplementDesignArtifact(artifact('draft', 'html'))).toBe(true)
    expect(canImplementDesignArtifact(artifact('design', 'canvas'))).toBe(false)
    expect(canImplementDesignArtifact(null)).toBe(false)
  })

  it('does not expose retired design agent panel visibility state', () => {
    expect(useDesignWorkspaceStore.getState()).not.toHaveProperty('agentPanelOpen')
    expect(useDesignWorkspaceStore.getState()).not.toHaveProperty('setAgentPanelOpen')
  })
})
