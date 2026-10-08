import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pickWorkComposerReferences, useWorkComposerReferences } from './work-composer-references'

const meeting = { path: '/space/notes/meeting.md', relativePath: 'notes/meeting.md', name: 'meeting.md',
  type: 'file' as const, workspaceRoot: '/space' }
const plan = { path: '/space/plan.md', relativePath: 'plan.md', name: 'plan.md', type: 'file' as const, workspaceRoot: '/space' }

describe('Work composer @ references', () => {
  beforeEach(() => {
    useWorkComposerReferences.setState({ spaceRoot: '', references: [] })
    useWorkComposerReferences.getState().bindSpace('/space')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps one entry per file and drops it by its relative path', () => {
    const store = useWorkComposerReferences.getState()
    store.add(meeting)
    store.add({ ...meeting })
    store.add(plan)
    expect(useWorkComposerReferences.getState().references.map((item) => item.relativePath)).toEqual(['notes/meeting.md', 'plan.md'])
    store.remove('Notes\\Meeting.md')
    expect(useWorkComposerReferences.getState().references).toEqual([plan])
  })

  it('belongs to its space: switching spaces starts over, the same space keeps them', () => {
    useWorkComposerReferences.getState().add(meeting)
    useWorkComposerReferences.getState().bindSpace('/space/')
    expect(useWorkComposerReferences.getState().references).toEqual([meeting])
    useWorkComposerReferences.getState().bindSpace('/other')
    expect(useWorkComposerReferences.getState().references).toEqual([])
  })

  it('a send consumes what it carried; a failed one restores it', () => {
    const store = useWorkComposerReferences.getState()
    store.add(meeting)
    store.add(plan)
    store.consume([meeting])
    expect(useWorkComposerReferences.getState().references).toEqual([plan])
    store.restore([meeting])
    expect(useWorkComposerReferences.getState().references.map((item) => item.relativePath)).toEqual(['plan.md', 'notes/meeting.md'])
  })

  it('adds picked local files relative to the space, and outside files by absolute path', async () => {
    const pickLocalFiles = vi.fn(async () => ({ canceled: false, paths: ['/space/notes/meeting.md', '/Users/me/Downloads/brief.pdf'] }))
    vi.stubGlobal('window', { kunGui: { pickLocalFiles } })
    await pickWorkComposerReferences('/space')
    expect(pickLocalFiles).toHaveBeenCalledWith('/space')
    expect(useWorkComposerReferences.getState().references).toEqual([
      expect.objectContaining({ relativePath: 'notes/meeting.md', workspaceRoot: '/space' }),
      expect.objectContaining({ path: '/Users/me/Downloads/brief.pdf', workspaceRoot: null })
    ])
  })
})
