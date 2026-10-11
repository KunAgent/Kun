import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import type { ReviewComment } from '@shared/review-comment'

const provider = {
  listReviewComments: vi.fn(),
  createReviewComment: vi.fn(),
  updateReviewComment: vi.fn(),
  sendReview: vi.fn()
}

vi.mock('../../agent/registry', () => ({
  getProvider: () => provider
}))

import { useReviewStore } from '../../store/review-store'
import { ReviewCommentThread } from './ReviewCommentThread'

const WS = 'tws_thread01'

const comment = (over: Partial<ReviewComment> = {}): ReviewComment => ({
  commentId: 'rvc_thread01',
  workspaceId: WS,
  path: 'a.ts',
  side: 'new',
  line: 3,
  anchor: { lineText: 'const x = 1', before: [], after: [] },
  body: 'rename this',
  state: 'draft',
  outdated: false,
  author: 'user',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over
})

function seed(comments: ReviewComment[]): void {
  useReviewStore.setState((s) => ({
    workspaces: {
      ...s.workspaces,
      [WS]: {
        files: [],
        loading: false,
        expandedPaths: {},
        viewMode: 'unified',
        details: {},
        comments,
        requests: [{ requestId: 'rvq_9', round: 3, target: { kind: 'manager' }, commentIds: [], sentAt: '2026-01-01T00:00:00Z' }],
        commentsLoaded: true,
        dirtyComments: {},
        sending: false
      }
    }
  }))
}

async function renderThread(comments: ReviewComment[]): Promise<ReactTestRenderer> {
  seed(comments)
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(ReviewCommentThread, {
      workspaceId: WS,
      comments,
      requests: [{ requestId: 'rvq_9', round: 3 }]
    }))
  })
  return renderer
}

const texts = (renderer: ReactTestRenderer): string =>
  JSON.stringify(renderer.toJSON())

beforeEach(() => {
  vi.clearAllMocks()
  useReviewStore.setState({ bindings: {}, workspaces: {} })
})

describe('ReviewCommentThread', () => {
  it('renders comment bodies with draft and sent badges', async () => {
    const renderer = await renderThread([
      comment(),
      comment({ commentId: 'rvc_sent0001', state: 'sent', sentInRequestId: 'rvq_9', body: 'sent one' })
    ])
    const out = texts(renderer)
    expect(out).toContain('rename this')
    expect(out).toContain('sent one')
    expect(out).toContain('3') // sent round
  })

  it('an empty local draft opens the editor; Cmd+Enter saves via the store', async () => {
    const draft = comment({ commentId: 'local_1', body: '' })
    const renderer = await renderThread([draft])
    const textarea = renderer.root.findByType('textarea' as never)
    expect(textarea).toBeTruthy()
    await act(async () => {
      textarea.props.onChange({ target: { value: 'fix this line' } })
    })
    await act(async () => {
      textarea.props.onKeyDown({ key: 'Enter', metaKey: true, preventDefault: () => {} })
    })
    expect(useReviewStore.getState().workspaces[WS].comments[0].body).toBe('fix this line')
    expect(useReviewStore.getState().workspaces[WS].dirtyComments['local_1']).toBe('create')
  })

  it('Esc discards a never-synced draft', async () => {
    const draft = comment({ commentId: 'local_2', body: '' })
    const renderer = await renderThread([draft])
    const textarea = renderer.root.findByType('textarea' as never)
    await act(async () => {
      textarea.props.onKeyDown({ key: 'Escape', preventDefault: () => {} })
    })
    expect(useReviewStore.getState().workspaces[WS].comments).toHaveLength(0)
  })

  it('resolve button marks the comment resolved and dirty for sync', async () => {
    const renderer = await renderThread([comment()])
    const resolveButton = renderer.root.findAllByType('button' as never)
      .find((b) => typeof b.props.title === 'string' && b.props.title.includes('Resolve'))
    expect(resolveButton).toBeTruthy()
    await act(async () => resolveButton!.props.onClick())
    const ws = useReviewStore.getState().workspaces[WS]
    expect(ws.comments[0].state).toBe('resolved')
    expect(ws.dirtyComments['rvc_thread01']).toBe('update')
  })

  it('outdated comments show the code-changed marker and anchor line', async () => {
    const renderer = await renderThread([comment({ outdated: true, line: 88 })])
    const out = texts(renderer)
    expect(out).toContain('a.ts')
    expect(out).toContain('88')
    expect(out).toContain('const x = 1')
  })

  it('resolved comments collapse behind a count chip', async () => {
    const renderer = await renderThread([
      comment(),
      comment({ commentId: 'rvc_done0001', state: 'resolved', body: 'old one' })
    ])
    const out = texts(renderer)
    expect(out).toContain('rename this')
    expect(out).not.toContain('old one')
    expect(out).toContain('1') // "1 resolved" chip
  })
})
