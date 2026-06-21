import { describe, expect, it } from 'vitest'
import { buildDesignArtifactMarkdown } from './design-artifact-markdown'
import type { DesignArtifact } from './design-types'

describe('design artifact markdown', () => {
  it('captures brief, paths, selected context, and version info', () => {
    const artifact: DesignArtifact = {
      id: 'screen',
      kind: 'html',
      title: 'Login screen',
      relativePath: '.kun-design/screen/v2.html',
      createdAt: '2026-06-21T00:00:00.000Z',
      updatedAt: '2026-06-21T00:05:00.000Z',
      versions: [
        {
          id: 'screen-v2',
          relativePath: '.kun-design/screen/v2.html',
          createdAt: '2026-06-21T00:05:00.000Z',
          summary: 'Make this a login screen'
        },
        {
          id: 'screen-v1',
          relativePath: '.kun-design/screen/v1.html',
          createdAt: '2026-06-21T00:00:00.000Z',
          summary: 'Create a hello world page'
        }
      ],
      designMdPath: '.kun-design/screen/DESIGN.md'
    }

    const markdown = buildDesignArtifactMarkdown({
      artifact,
      designMdPath: '.kun-design/screen/DESIGN.md',
      currentTurn: 'Make this a login screen',
      updatedAt: '2026-06-21T00:06:00.000Z',
      selectedContext: [
        {
          kind: 'html-screen-frame',
          label: 'Login screen',
          detail: '420 x 340 - .kun-design/screen/v2.html'
        }
      ]
    })

    expect(markdown).toContain('# Design Notes: Login screen')
    expect(markdown).toContain('Source HTML path: `.kun-design/screen/v2.html`')
    expect(markdown).toContain('Design notes file: `.kun-design/screen/DESIGN.md`')
    expect(markdown).toContain('Latest version: v2 (`.kun-design/screen/v2.html`)')
    expect(markdown).toContain('Create a hello world page')
    expect(markdown).toContain('Make this a login screen')
    expect(markdown).toContain('[html-screen-frame] Login screen - 420 x 340')
    expect(markdown).toContain('## Handoff Notes')
  })
})
