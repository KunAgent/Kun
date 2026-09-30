import { describe, expect, it } from 'vitest'
import type { WorkspaceEntry } from '@shared/workspace-file'
import { mobileParentFolderPage, mobileWorkResources, resolveMobileWorkEntry } from './mobile-work-resources'
import { workFileResourceKey } from './work-resource-key'

const root = '/home/w'
const folder = { name: 'drafts', path: `${root}/drafts`, type: 'directory' } as WorkspaceEntry
const file = { name: 'NOTES.md', path: `${root}/drafts/NOTES.md`, type: 'file', mtimeMs: 2 } as WorkspaceEntry
const state = {
  workspaceRoot: root, rootDirectory: root,
  entriesByDir: { [root]: [folder], [folder.path]: [file] },
  documentsByPath: {}, whiteboards: {}
}

describe('mobile work directory selector', () => {
  it('shows current directory instead of flattening every file, but searches loaded folders', () => {
    expect(mobileWorkResources(state, root, '').resources.map((item) => item.title)).toEqual(['drafts'])
    expect(mobileWorkResources(state, folder.path, '').resources.map((item) => item.title)).toEqual(['NOTES.md'])
    expect(mobileWorkResources(state, root, 'notes').resources.map((item) => item.title)).toEqual(['NOTES.md'])
  })
  it('resolves opaque keys only within loaded workspace entries', () => {
    expect(resolveMobileWorkEntry(state, workFileResourceKey(root, file.path))).toEqual(file)
    expect(resolveMobileWorkEntry(state, workFileResourceKey('/elsewhere', file.path))).toBeUndefined()
  })
  it('returns to the actual parent of a nested folder', () => {
    expect(mobileParentFolderPage(root, root, `${root}/drafts/chapters`)).toEqual({
      mode: 'work', kind: 'folder', folderKey: workFileResourceKey(root, `${root}/drafts`)
    })
    expect(mobileParentFolderPage(root, root, `${root}/drafts`)).toEqual({ mode: 'work', kind: 'home' })
  })
})
