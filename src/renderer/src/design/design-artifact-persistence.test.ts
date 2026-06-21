import { describe, expect, it } from 'vitest'
import {
  parseArtifactMeta,
  reconstructArtifact,
  serializeArtifactMeta
} from './design-artifact-persistence'
import { defaultDesignArtifactNode, type DesignArtifact } from './design-types'

describe('design artifact persistence', () => {
  it('keeps old artifact meta valid when node placement is absent', () => {
    const artifact = parseArtifactMeta(
      JSON.stringify({
        id: 'draft',
        kind: 'html',
        title: 'Draft',
        relativePath: '.kun-design/draft/v1.html',
        createdAt: '2026-06-20T00:00:00.000Z',
        updatedAt: '2026-06-20T00:00:00.000Z',
        versions: []
      }),
      'draft'
    )

    expect(artifact?.id).toBe('draft')
    expect(artifact?.designMdPath).toBe('.kun-design/draft/DESIGN.md')
    expect(artifact?.node).toBeUndefined()
  })

  it('round-trips Stitch project-canvas node placement', () => {
    const createdAt = '2026-06-20T00:00:00.000Z'
    const artifact: DesignArtifact = {
      id: 'draft',
      kind: 'html',
      title: 'Draft',
      relativePath: '.kun-design/draft/v1.html',
      createdAt,
      updatedAt: createdAt,
      versions: [{ id: 'draft-v1', relativePath: '.kun-design/draft/v1.html', createdAt, summary: '' }],
      designMdPath: '.kun-design/draft/DESIGN.md',
      previewStatus: 'ready',
      node: { x: 120, y: 240, width: 512, height: 384, sizeMode: 'auto', favorite: true, viewMode: 'code' }
    }

    const parsed = parseArtifactMeta(serializeArtifactMeta(artifact), 'draft')

    expect(parsed?.node).toEqual(artifact.node)
    expect(parsed?.designMdPath).toBe('.kun-design/draft/DESIGN.md')
    expect(parsed?.previewStatus).toBe('ready')
  })

  it('adds a default node when reconstructing legacy artifact folders', () => {
    const artifact = reconstructArtifact('legacy', [
      { name: 'v1.html', path: '.kun-design/legacy/v1.html', type: 'file', ext: '.html' },
      { name: 'meta.json', path: '.kun-design/legacy/meta.json', type: 'file', ext: '.json' }
    ])

    expect(artifact?.node).toEqual(defaultDesignArtifactNode(0))
    expect(artifact?.designMdPath).toBe('.kun-design/legacy/DESIGN.md')
  })
})
