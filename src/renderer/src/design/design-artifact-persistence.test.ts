import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deleteArtifactDir,
  parseArtifactMeta,
  reconstructArtifact,
  serializeArtifactMeta
} from './design-artifact-persistence'
import { currentDesignArtifactVersion, defaultDesignArtifactNode, type DesignArtifact } from './design-types'

describe('design artifact persistence', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('keeps the agent section label of a board across restarts', () => {
    const meta = (boardSection: unknown) => JSON.stringify({
      id: 'draft',
      kind: 'html',
      title: 'Draft',
      relativePath: '.kun-design/draft/v1.html',
      createdAt: '2026-06-20T00:00:00.000Z',
      updatedAt: '2026-06-20T00:00:00.000Z',
      boardSection
    })
    expect(parseArtifactMeta(meta('  02 Themes '), 'draft')?.boardSection).toBe('02 Themes')
    expect(parseArtifactMeta(meta(''), 'draft')).not.toHaveProperty('boardSection')
    expect(parseArtifactMeta(meta(7), 'draft')).not.toHaveProperty('boardSection')
  })

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
      node: {
        x: 120,
        y: 240,
        width: 512,
        height: 384,
        sizeMode: 'auto',
        favorite: true,
        boardHidden: true,
        viewMode: 'code'
      },
      prototypeLinks: [
        {
          targetTitle: 'Signup',
          targetArtifactId: 'signup',
          href: '../signup/v1.html',
          label: 'Start trial'
        }
      ],
      direction: {
        id: 'dir_1',
        name: 'Signup exploration',
        status: 'active',
        createdAt
      }
    }

    const parsed = parseArtifactMeta(serializeArtifactMeta(artifact), 'draft')

    expect(parsed?.node).toEqual(artifact.node)
    expect(parsed?.prototypeLinks).toEqual(artifact.prototypeLinks)
    expect(parsed?.direction).toEqual(artifact.direction)
    expect(parsed?.designMdPath).toBe('.kun-design/draft/DESIGN.md')
    expect(parsed?.previewStatus).toBe('ready')
  })

  it('parses, dedupes, and round-trips per-version board-hidden tombstones', () => {
    const createdAt = '2026-06-20T00:00:00.000Z'
    const artifact: DesignArtifact = {
      id: 'draft',
      kind: 'html',
      title: 'Draft',
      relativePath: '.kun-design/draft/v2.html',
      createdAt,
      updatedAt: createdAt,
      versions: [
        { id: 'draft-v2', relativePath: '.kun-design/draft/v2.html', createdAt, summary: '' },
        { id: 'draft-v1', relativePath: '.kun-design/draft/v1.html', createdAt, summary: '' }
      ],
      designMdPath: '.kun-design/draft/DESIGN.md',
      node: {
        x: 120,
        y: 240,
        width: 512,
        height: 384,
        sizeMode: 'manual',
        boardHiddenVersionIds: ['draft-v1']
      }
    }

    const parsed = parseArtifactMeta(serializeArtifactMeta(artifact), 'draft')
    expect(parsed?.node?.boardHiddenVersionIds).toEqual(['draft-v1'])
    expect(parseArtifactMeta(serializeArtifactMeta(parsed!), 'draft')?.node?.boardHiddenVersionIds)
      .toEqual(['draft-v1'])
  })

  it('dedupes and drops invalid entries from boardHiddenVersionIds', () => {
    const createdAt = '2026-06-20T00:00:00.000Z'
    const parsed = parseArtifactMeta(
      JSON.stringify({
        id: 'draft',
        kind: 'html',
        title: 'Draft',
        relativePath: '.kun-design/draft/v1.html',
        createdAt,
        updatedAt: createdAt,
        versions: [],
        node: {
          x: 120,
          y: 240,
          width: 512,
          height: 384,
          boardHiddenVersionIds: ['draft-v1', 'draft-v1', '', 42, 'draft-v2']
        }
      }),
      'draft'
    )

    expect(parsed?.node?.boardHiddenVersionIds).toEqual(['draft-v1', 'draft-v2'])
  })

  it('keeps persisted version order while exposing the current relativePath version', () => {
    const createdAt = '2026-06-20T00:00:00.000Z'
    const parsed = parseArtifactMeta(
      JSON.stringify({
        id: 'draft',
        kind: 'html',
        title: 'Draft',
        relativePath: '.kun-design/draft/v1.html',
        createdAt,
        updatedAt: createdAt,
        versions: [
          {
            id: 'draft-v2',
            relativePath: '.kun-design/draft/v2.html',
            createdAt: '2026-06-20T01:00:00.000Z',
            summary: 'Newer experiment'
          },
          {
            id: 'draft-v1',
            relativePath: '.kun-design/draft/v1.html',
            createdAt,
            summary: 'Selected stable version'
          }
        ]
      }),
      'draft'
    )

    expect(parsed?.versions.map((version) => version.id)).toEqual(['draft-v2', 'draft-v1'])
    expect(parsed ? currentDesignArtifactVersion(parsed)?.summary : '').toBe('Selected stable version')
  })

  it('adds a current version entry when old meta omits the active relativePath', () => {
    const createdAt = '2026-06-20T00:00:00.000Z'
    const parsed = parseArtifactMeta(
      JSON.stringify({
        id: 'draft',
        kind: 'html',
        title: 'Draft',
        relativePath: '.kun-design/draft/v3.html',
        createdAt,
        updatedAt: createdAt,
        versions: [
          {
            id: 'draft-v2',
            relativePath: '.kun-design/draft/v2.html',
            createdAt,
            summary: 'Old version'
          }
        ]
      }),
      'draft'
    )

    expect(parsed?.versions[0]).toMatchObject({
      id: 'draft-v3',
      relativePath: '.kun-design/draft/v3.html',
      summary: ''
    })
    expect(parsed?.versions[1]?.id).toBe('draft-v2')
  })

  it('adds a default node when reconstructing legacy artifact folders', () => {
    const artifact = reconstructArtifact('legacy', [
      { name: 'v1.html', path: '.kun-design/legacy/v1.html', type: 'file', ext: '.html' },
      { name: 'meta.json', path: '.kun-design/legacy/meta.json', type: 'file', ext: '.json' }
    ])

    expect(artifact?.node).toEqual(defaultDesignArtifactNode(0))
    expect(artifact?.designMdPath).toBe('.kun-design/legacy/DESIGN.md')
  })

  it('round-trips SVG metadata and reconstructs the newest version from disk', () => {
    const createdAt = '2026-06-20T00:00:00.000Z'
    const motion: DesignArtifact = {
      id: 'motion',
      kind: 'svg',
      title: 'Orbit loader',
      relativePath: '.kun-design/doc/motion/v2.svg',
      createdAt,
      updatedAt: createdAt,
      versions: [
        { id: 'motion-v1', relativePath: '.kun-design/doc/motion/v1.svg', createdAt, summary: 'First pass' },
        { id: 'motion-v2', relativePath: '.kun-design/doc/motion/v2.svg', createdAt, summary: 'Refined loop' }
      ],
      designMdPath: '.kun-design/doc/motion/DESIGN.md',
      previewStatus: 'ready',
      node: { x: 40, y: 80, width: 64, height: 64, sizeMode: 'manual', viewMode: 'preview' }
    }

    expect(parseArtifactMeta(serializeArtifactMeta(motion), 'motion')).toMatchObject({
      kind: 'svg',
      relativePath: '.kun-design/doc/motion/v2.svg',
      designMdPath: '.kun-design/doc/motion/DESIGN.md',
      node: { width: 64, height: 64 }
    })
    expect(reconstructArtifact('doc/motion', [
      { name: 'v1.svg', path: '.kun-design/doc/motion/v1.svg', type: 'file', ext: '.svg' },
      { name: 'v3.svg', path: '.kun-design/doc/motion/v3.svg', type: 'file', ext: '.svg' }
    ], {
      svgSource: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 96"><title>Motion</title><desc>Mark</desc></svg>'
    })).toMatchObject({
      id: 'motion',
      kind: 'svg',
      relativePath: '.kun-design/doc/motion/v3.svg',
      versions: [
        { id: 'motion-v3', relativePath: '.kun-design/doc/motion/v3.svg' },
        { id: 'motion-v1', relativePath: '.kun-design/doc/motion/v1.svg' }
      ],
      designMdPath: '.kun-design/doc/motion/DESIGN.md',
      node: { width: 64, height: 96, sizeMode: 'manual', viewMode: 'preview' }
    })
  })

  it('uses explicit SVG dimensions while preserving the viewBox aspect ratio when one side is omitted', () => {
    expect(reconstructArtifact('doc/logo', [
      { name: 'v1.svg', path: '.kun-design/doc/logo/v1.svg', type: 'file', ext: '.svg' }
    ], {
      svgSource: '<svg xmlns="http://www.w3.org/2000/svg" width="200" viewBox="0 0 100 50"></svg>'
    })?.node).toMatchObject({ width: 200, height: 100, sizeMode: 'manual' })
  })

  it('does not mistake similarly suffixed SVG attributes for width or height', () => {
    expect(reconstructArtifact('doc/logo', [
      { name: 'v1.svg', path: '.kun-design/doc/logo/v1.svg', type: 'file', ext: '.svg' }
    ], {
      svgSource: '<svg xmlns="http://www.w3.org/2000/svg" stroke-width="2" viewBox="0 0 300 150"></svg>'
    })?.node).toMatchObject({ width: 300, height: 150, sizeMode: 'manual' })
  })

  it('rejects metadata paths that escape the actual artifact directory', () => {
    expect(parseArtifactMeta(JSON.stringify({
      id: 'bad',
      kind: 'html',
      title: 'Bad',
      relativePath: 'src/index.ts',
      versions: [{ id: 'bad-v1', relativePath: '../../src/index.ts' }]
    }), 'bad', '.kun-design/doc/bad')).toBeNull()

    expect(parseArtifactMeta(JSON.stringify({
      id: 'spoofed',
      kind: 'svg',
      title: 'Safe',
      relativePath: '.kun-design/doc/bad/v1.svg',
      versions: [
        { id: 'spoofed-v1', relativePath: '.kun-design/doc/bad/v1.svg' },
        { id: 'escape-v2', relativePath: 'src/index.ts' }
      ],
      designMdPath: 'src/DESIGN.md'
    }), 'bad', '.kun-design/doc/bad')).toMatchObject({
      id: 'bad',
      relativePath: '.kun-design/doc/bad/v1.svg',
      versions: [{ id: 'bad-v1', relativePath: '.kun-design/doc/bad/v1.svg' }],
      designMdPath: '.kun-design/doc/bad/DESIGN.md'
    })
  })

  it('round-trips the imported component prototype source and drops unsafe sources', () => {
    const createdAt = '2026-06-20T00:00:00.000Z'
    const imported: DesignArtifact = {
      id: 'draft',
      kind: 'html',
      title: 'Date range picker',
      relativePath: '.kun-design/doc/draft/v1.html',
      createdAt,
      updatedAt: createdAt,
      versions: [{ id: 'draft-v1', relativePath: '.kun-design/doc/draft/v1.html', createdAt, summary: '' }],
      importedFromPath: '.kun-design/component-prototypes/date-picker/prototype.html'
    }

    expect(parseArtifactMeta(serializeArtifactMeta(imported), 'draft')?.importedFromPath)
      .toBe(imported.importedFromPath)

    expect(parseArtifactMeta(JSON.stringify({
      ...imported,
      importedFromPath: '.kun-design/other/screen.html'
    }), 'draft')?.importedFromPath).toBeUndefined()

    expect(parseArtifactMeta(JSON.stringify({
      ...imported,
      importedFromPath: '.kun-design/component-prototypes/../secret/prototype.html'
    }), 'draft')?.importedFromPath).toBeUndefined()
  })

  it('refuses to delete directories derived from untrusted artifact paths', async () => {
    const deleteWorkspaceEntry = vi.fn(async () => ({ ok: true as const }))
    vi.stubGlobal('window', { kunGui: { deleteWorkspaceEntry } })

    deleteArtifactDir('/workspace', 'src/index.ts')
    deleteArtifactDir('/workspace', '.kun-design/doc/bad/../../src/index.ts')
    await Promise.resolve()
    expect(deleteWorkspaceEntry).not.toHaveBeenCalled()

    deleteArtifactDir('/workspace', '.kun-design/doc/good/v1.svg')
    await vi.waitFor(() => expect(deleteWorkspaceEntry).toHaveBeenCalledWith({
      path: '.kun-design/doc/good',
      workspaceRoot: '/workspace'
    }))
  })
})
