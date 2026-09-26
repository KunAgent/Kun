/**
 * Review-session state-machine tests on a view-less editor harness
 * (implementation §6.7): start → resolve chunks → finish, asserting the
 * serialized markdown is byte-exact in both directions.
 */
import { describe, expect, it } from 'vitest'
import { getSchema, type Editor } from '@tiptap/core'
import { EditorState, type Transaction } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { buildWriteRichExtensions } from '../markdown-manager'
import {
  createWorkDocContext,
  parseWorkDocument,
  serializeWorkDocument,
  type WorkDocContext
} from '../../markdown/document-codec'
import { writeReviewPlugin, writeReviewPluginKey } from './review-plugin'
import { WriteReviewSession } from './review-session'

const schema = getSchema(buildWriteRichExtensions())

type Harness = {
  editor: Editor
  session: WriteReviewSession
  emitted: string[]
  stateChanges: boolean[]
  serialize: () => string
}

function makeHarness(markdown: string): Harness {
  const parsed = parseWorkDocument(markdown)
  let ctx: WorkDocContext = parsed.ctx
  let state = EditorState.create({
    schema,
    doc: schema.nodeFromJSON(parsed.doc),
    plugins: [writeReviewPlugin]
  })
  const emitted: string[] = []
  const stateChanges: boolean[] = []
  const view = {
    dispatch: (tr: Transaction) => {
      state = state.apply(tr)
    },
    nodeDOM: () => null
  }
  const editor = {
    schema,
    view,
    get state() {
      return state
    },
    setEditable: () => undefined
  } as unknown as Editor

  const harness: Harness = {
    editor,
    session: undefined as unknown as WriteReviewSession,
    emitted,
    stateChanges,
    serialize: () => serializeWorkDocument(state.doc.toJSON(), ctx)
  }
  harness.session = new WriteReviewSession(
    editor,
    {
      onFinish: (markdown) => emitted.push(markdown),
      onStateChange: (active) => stateChanges.push(active),
      onChunksChange: () => undefined
    },
    () => ctx,
    (next) => {
      ctx = next
    }
  )
  return harness
}

function chunkKinds(harness: Harness): string[] {
  const state = writeReviewPluginKey.getState(harness.editor.state)
  return (state?.chunks ?? []).map((chunk) => chunk.kind)
}

function chunkIds(harness: Harness): string[] {
  const state = writeReviewPluginKey.getState(harness.editor.state)
  return (state?.chunks ?? []).map((chunk) => chunk.id)
}

const ORIGINAL = [
  '# Title',
  '',
  'first paragraph stays the same',
  '',
  'the middle block gets rewritten by the agent in this document',
  '',
  'last block survives'
].join('\n')

const NEXT = [
  '# Title',
  '',
  'first paragraph stays the same',
  '',
  'the middle block was rewritten by the agent in this document',
  '',
  'a brand new block inserted by the agent',
  '',
  'last block survives'
].join('\n')

describe('WriteReviewSession', () => {
  it('enters review, seeds chunks, and emits byte-exact nextDoc on accept-all', () => {
    const harness = makeHarness(ORIGINAL)
    const started = harness.session.begin({ original: ORIGINAL, nextDoc: NEXT })
    expect(started).toBe(true)
    expect(harness.session.isActive()).toBe(true)
    expect(harness.stateChanges).toEqual([true])
    expect(chunkKinds(harness)).toEqual(['modified', 'added'])

    harness.session.resolveAll('accept')
    expect(harness.session.isActive()).toBe(false)
    expect(harness.stateChanges).toEqual([true, false])
    expect(harness.emitted).toEqual([NEXT])
  })

  it('rejects all chunks back to the byte-exact original', () => {
    const harness = makeHarness(ORIGINAL)
    harness.session.begin({ original: ORIGINAL, nextDoc: NEXT })
    harness.session.resolveAll('reject')
    expect(harness.emitted).toEqual([ORIGINAL])
  })

  it('per-chunk resolves: accept added, reject modified', () => {
    const harness = makeHarness(ORIGINAL)
    harness.session.begin({ original: ORIGINAL, nextDoc: NEXT })
    const [modified, added] = chunkIds(harness)
    harness.session.resolve(added, 'accept')
    harness.session.resolve(modified, 'reject')
    const expected = [
      '# Title',
      '',
      'first paragraph stays the same',
      '',
      'the middle block gets rewritten by the agent in this document',
      '',
      'a brand new block inserted by the agent',
      '',
      'last block survives'
    ].join('\n')
    expect(harness.emitted).toEqual([expected])
  })

  it('removed chunks re-insert the original blocks on reject', () => {
    const next = '# Title\n\nfirst paragraph stays the same\n'
    const harness = makeHarness(ORIGINAL)
    harness.session.begin({ original: ORIGINAL, nextDoc: next })
    expect(chunkKinds(harness)).toEqual(['removed'])
    harness.session.resolveAll('reject')
    expect(harness.emitted).toEqual([ORIGINAL])
  })

  it('returns false for identical texts and stays inactive', () => {
    const harness = makeHarness(ORIGINAL)
    expect(harness.session.begin({ original: ORIGINAL, nextDoc: ORIGINAL })).toBe(false)
    expect(harness.session.isActive()).toBe(false)
  })

  it('re-begin mid-review recomputes against the same baseline', () => {
    const harness = makeHarness(ORIGINAL)
    harness.session.begin({ original: ORIGINAL, nextDoc: NEXT })
    const next2 = NEXT + '\n\nsecond agent pass adds this\n'
    expect(harness.session.begin({ original: ORIGINAL, nextDoc: next2 })).toBe(true)
    expect(chunkKinds(harness)).toEqual(['modified', 'added', 'added'])
    harness.session.resolveAll('accept')
    expect(harness.emitted).toEqual([next2])
  })

  it('preserves frontmatter through a review round-trip', () => {
    const original = '---\ntitle: doc\ntags: [a]\n---\n\n# H\n\nbody text\n'
    const next = '---\ntitle: doc\ntags: [a]\n---\n\n# H\n\nbody text\n\nappended\n'
    const harness = makeHarness(original)
    harness.session.begin({ original, nextDoc: next })
    harness.session.resolveAll('accept')
    expect(harness.emitted).toEqual([next])
  })
})
