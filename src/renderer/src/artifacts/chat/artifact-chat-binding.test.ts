import { describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
import type { LibraryArtifact } from '../artifact-types'
import { resolveArtifactChatBinding } from './artifact-chat-binding'

const artifact = {
  id: 'slides:/repo:presentations/paper.pptx', kind: 'slides', title: 'paper', workspaceRoot: '/repo',
  projectName: 'repo', path: 'presentations/paper.pptx', ext: '.pptx', updatedAt: 1, sourceThreadId: 'source'
} as LibraryArtifact
const thread = (id: string, extra: Partial<NormalizedThread> = {}): NormalizedThread =>
  ({ id, title: id, workspace: '/repo', ...extra }) as NormalizedThread

describe('artifact chat binding', () => {
  it('defaults to the conversation that produced the file', () => {
    const binding = resolveArtifactChatBinding(artifact, [thread('source')], { threads: {}, drafts: {} })
    expect(binding).toMatchObject({ kind: 'source', thread: { id: 'source' }, source: { id: 'source' } })
  })

  it('prefers a conversation started from the panel, unless it is archived or gone', () => {
    const threads = [thread('source'), thread('panel')]
    expect(resolveArtifactChatBinding(artifact, threads, { threads: { [artifact.id]: 'panel' }, drafts: {} }))
      .toMatchObject({ kind: 'bound', thread: { id: 'panel' } })
    expect(resolveArtifactChatBinding(artifact, [thread('source'), thread('panel', { archived: true })], { threads: { [artifact.id]: 'panel' }, drafts: {} }))
      .toMatchObject({ kind: 'source' })
    expect(resolveArtifactChatBinding(artifact, [thread('source')], { threads: { [artifact.id]: 'missing' }, drafts: {} }))
      .toMatchObject({ kind: 'source' })
  })

  it('is a draft when asked for a fresh conversation or when nothing produced the file', () => {
    expect(resolveArtifactChatBinding(artifact, [thread('source')], { threads: {}, drafts: { [artifact.id]: true } }))
      .toMatchObject({ kind: 'draft', thread: null, source: { id: 'source' } })
    expect(resolveArtifactChatBinding({ ...artifact, sourceThreadId: undefined }, [], { threads: {}, drafts: {} }))
      .toEqual({ kind: 'draft', thread: null, source: null })
  })
})
