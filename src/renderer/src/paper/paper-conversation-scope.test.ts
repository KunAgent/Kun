import { describe, expect, it } from 'vitest'
import type { WorkspaceEntry } from '@shared/workspace-file'
import { paperConversationResourcePath } from './paper-conversation-scope'

const ROOT = '/lib'

function dir(path: string, names: string[]): WorkspaceEntry[] {
  return names.map((name) => ({ name, path: `${path}/${name}`, type: 'file' }) as WorkspaceEntry)
}

describe('paperConversationResourcePath', () => {
  const unitDirs = ['/lib/papers/attention']
  const entriesByDir = { '/lib/papers': [ { name: 'attention', path: '/lib/papers/attention', type: 'directory' } as WorkspaceEntry ] }

  it('anchors an ordinary document to the file itself', () => {
    expect(paperConversationResourcePath({
      workspaceRoot: '/docs',
      activeFilePath: '/docs/a.md',
      unitDirs: []
    })).toBe('/docs/a.md')
  })

  it('anchors files inside a unit to the unit dir', () => {
    expect(paperConversationResourcePath({
      workspaceRoot: ROOT,
      activeFilePath: '/lib/papers/attention/NOTES.md',
      unitDirs,
      entriesByDir,
      view: 'reader'
    })).toBe('/lib/papers/attention')
  })

  it('keeps non-unit files on their own path', () => {
    expect(paperConversationResourcePath({
      workspaceRoot: ROOT,
      activeFilePath: '/lib/reading-list.md',
      unitDirs,
      entriesByDir,
      view: 'reader'
    })).toBe('/lib/reading-list.md')
  })

  it('anchors library and discover pages to the space itself', () => {
    for (const view of ['library', 'discover'] as const) {
      expect(paperConversationResourcePath({
          workspaceRoot: ROOT,
        activeFilePath: '/lib/papers/attention/paper.pdf',
        unitDirs,
        entriesByDir,
        view
      })).toBeUndefined()
    }
  })

  it('resolves units via known unit dirs when entries are unloaded', () => {
    expect(paperConversationResourcePath({
      workspaceRoot: ROOT,
      activeFilePath: '/lib/papers/attention/paper.pdf',
      unitDirs,
      view: 'reader'
    })).toBe('/lib/papers/attention')
  })
})
