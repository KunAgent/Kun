import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../../store/chat-store'
import { watchLatexAssistantReply } from './latex-assistant-context'
import { latexSession, openLatexSession, refreshLatexSources } from './latex-project-store'
import { releaseLatexSession } from './latex-session-lifecycle'
import { installLatexSessionFixture } from './latex-session-test-support'

vi.mock('../../i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('../../store/chat-store', async () => {
  const { create } = await import('zustand')
  return { useChatStore: create(() => ({ activeThreadId: 'thread', busy: true, blocks: [] })) }
})
vi.mock('../write-workspace-store', () => ({ useWriteWorkspaceStore: { getState: () => ({ workspaceRoot: '/work', activeFilePath: '/work/paper/main.tex', openWriteRightPanel: vi.fn() }) } }))
let fixture: ReturnType<typeof installLatexSessionFixture>
const response = '```kun-latex-edits\n' + JSON.stringify({ edits: [{ file: 'main.tex', before: 'original source', after: 'assistant edit' }] }) + '\n```'
const complete = () => useChatStore.setState({ busy: false, blocks: [{ kind: 'assistant', id: 'reply', text: response }] })
beforeEach(() => {
  fixture = installLatexSessionFixture()
  useChatStore.setState({ activeThreadId: 'thread', busy: true, blocks: [] })
})
afterEach(() => vi.unstubAllGlobals())

describe('Work assistant proposal ownership', () => {
  it('stages a reply that completed before the observer was installed', async () => {
    const { key, project } = fixture
    await openLatexSession('/work', project.mainPath)
    complete()
    watchLatexAssistantReply('/work', project.mainPath, 'thread', new Set())
    expect(latexSession(key)?.review[0].after).toBe('assistant edit')
    expect(latexSession(key)?.proposalIds).toHaveLength(0)
    expect(latexSession(key)?.proposing).toBe(false)
  })

  it('cannot overwrite an external review with a later assistant reply', async () => {
    const { key, project, disk } = fixture
    await openLatexSession('/work', project.mainPath)
    watchLatexAssistantReply('/work', project.mainPath, 'thread', new Set())
    disk.set('main.tex', 'external edit')
    await refreshLatexSources(key)
    const review = latexSession(key)!.review
    complete()
    expect(latexSession(key)?.review).toBe(review)
    expect(latexSession(key)?.reviewOrigin).toBe('external')
    expect(latexSession(key)?.proposing).toBe(false)
  })

  it('does not attach a previous thread reply to a reopened project session', async () => {
    const { key, project } = fixture
    await openLatexSession('/work', project.mainPath)
    watchLatexAssistantReply('/work', project.mainPath, 'thread', new Set())
    releaseLatexSession('/work', project.mainPath)
    await openLatexSession('/work', project.mainPath)
    complete()
    expect(latexSession(key)?.review).toHaveLength(0)
    expect(latexSession(key)?.proposing).toBe(false)
  })

  it('finishes overlapping observers without replacing the first staged review', async () => {
    const { key, project } = fixture
    await openLatexSession('/work', project.mainPath)
    watchLatexAssistantReply('/work', project.mainPath, 'thread', new Set())
    watchLatexAssistantReply('/work', project.mainPath, 'thread', new Set())
    expect(latexSession(key)?.proposalIds).toHaveLength(2)
    complete()
    expect(latexSession(key)?.review).toEqual([{ file: 'main.tex', before: 'original source', after: 'assistant edit' }])
    expect(latexSession(key)?.proposalIds).toHaveLength(0)
    expect(latexSession(key)?.proposing).toBe(false)
  })
})
