import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'

vi.mock('../../agent/registry', () => ({
  getProvider: () => ({})
}))

import { useReviewStore } from '../../store/review-store'
import { ReviewDiffBlock } from './ReviewDiffBlock'

const WS = 'tws_block0001'
const PATCH = [
  'diff --git a/a.ts b/a.ts',
  'index 111..222 100644',
  '--- a/a.ts',
  '+++ b/a.ts',
  '@@ -1,3 +1,4 @@',
  ' first',
  ' second',
  '+const x = 1',
  ' third',
  ''
].join('\n')

function seed(): void {
  useReviewStore.setState((s) => ({
    workspaces: {
      ...s.workspaces,
      [WS]: {
        files: [],
        loading: false,
        expandedPaths: { 'a.ts': true },
        viewMode: 'unified',
        details: {
          'a.ts': {
            loading: false,
            detail: {
              path: 'a.ts', status: 'modified', insertions: 1, deletions: 0,
              binary: false, tooLarge: false, patch: PATCH, oldText: 'x', newText: 'y'
            }
          }
        },
        comments: [],
        requests: [],
        commentsLoaded: true,
        dirtyComments: {},
        sending: false
      }
    }
  }))
}

async function renderBlock(): Promise<ReactTestRenderer> {
  seed()
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(ReviewDiffBlock, {
      workspaceId: WS,
      file: { path: 'a.ts', status: 'modified', insertions: 1, deletions: 0, binary: false, tooLarge: false }
    }))
  })
  return renderer
}

const drafts = () =>
  useReviewStore.getState().workspaces[WS].comments.map((c) => ({
    line: c.line, side: c.side, anchor: c.anchor
  }))

beforeEach(() => {
  useReviewStore.setState({ bindings: {}, workspaces: {} })
})

describe('ReviewDiffBlock comments', () => {
  it('clicking the gutter creates a draft anchored to the line', async () => {
    const renderer = await renderBlock()
    const gutter = renderer.root.findAllByType('button' as never)
      .find((b) => typeof b.props['aria-label'] === 'string' && b.props['aria-label'].includes('Comment'))
    expect(gutter).toBeTruthy()
    await act(async () => gutter!.props.onClick({ stopPropagation: () => {} }))
    expect(drafts()).toHaveLength(1)
    expect(drafts()[0].anchor.lineText).toBe('first')
    expect(drafts()[0].anchor.before).toEqual([])
    expect(drafts()[0].anchor.after).toEqual(['second', 'const x = 1', 'third'])
  })

  it('pressing c on a focused row creates a draft on the right side', async () => {
    const renderer = await renderBlock()
    const rows = renderer.root.findAll(
      (n) => n.props?.tabIndex === 0 && typeof n.props.onKeyDown === 'function'
    )
    // rows: first ctx, second ctx, added line, third ctx
    const addedRow = rows[2]
    await act(async () => {
      addedRow!.props.onKeyDown({
        key: 'c', metaKey: false, ctrlKey: false,
        target: addedRow, currentTarget: addedRow, preventDefault: () => {}
      })
    })
    expect(drafts()).toHaveLength(1)
    expect(drafts()[0]).toMatchObject({ line: 3, side: 'new' })
    expect(drafts()[0].anchor.lineText).toBe('const x = 1')
  })

  it('ignores c with modifiers or from nested targets', async () => {
    const renderer = await renderBlock()
    const rows = renderer.root.findAll(
      (n) => n.props?.tabIndex === 0 && typeof n.props.onKeyDown === 'function'
    )
    const row = rows[2]
    await act(async () => {
      row!.props.onKeyDown({ key: 'c', metaKey: true, ctrlKey: false, target: row, currentTarget: row, preventDefault: () => {} })
      row!.props.onKeyDown({ key: 'c', metaKey: false, ctrlKey: false, target: {}, currentTarget: row, preventDefault: () => {} })
      row!.props.onKeyDown({ key: 'x', metaKey: false, ctrlKey: false, target: row, currentTarget: row, preventDefault: () => {} })
    })
    expect(drafts()).toHaveLength(0)
  })
})
