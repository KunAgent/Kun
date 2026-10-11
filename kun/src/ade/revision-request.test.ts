import { describe, expect, it } from 'vitest'
import type { ReviewComment } from '../contracts/review.js'
import { renderRevisionRequest } from './revision-request.js'

const base = {
  commentId: 'rvc_aaaaaaaa' as const,
  workspaceId: 'tws_k2j4',
  path: 'src/login/api.ts',
  side: 'new' as const,
  line: 42,
  anchor: { lineText: 'const timeout = 5000', before: [], after: [] },
  body: '超时应该从配置读取，不要写死。',
  state: 'draft' as const,
  outdated: false,
  author: 'user' as const,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z'
}

const comment = (over: Partial<ReviewComment>): ReviewComment => ({ ...base, ...over })

describe('renderRevisionRequest', () => {
  it('renders the deterministic numbered template', () => {
    const text = renderRevisionRequest({
      workspaceId: 'tws_k2j4',
      round: 2,
      comments: [comment({})]
    })
    expect(text).toBe([
      '<kun_review_request round="2" workspace="tws_k2j4">',
      '请根据以下审查意见修改。每条意见都对应具体位置。',
      '',
      '1. src/login/api.ts 第 42 行（新版本）',
      '   代码：const timeout = 5000',
      '   意见：超时应该从配置读取，不要写死。',
      '',
      '完成后，逐条说明处理结果：已修改 / 不同意（附原因）。',
      '</kun_review_request>'
    ].join('\n'))
  })

  it('marks outdated comments with their original line text', () => {
    const text = renderRevisionRequest({
      workspaceId: 'tws_k2j4',
      round: 1,
      comments: [
        comment({
          commentId: 'rvc_bbbbbbbb',
          path: 'src/login/LoginForm.tsx',
          line: 88,
          anchor: { lineText: 'setError(e.message)', before: [], after: [] },
          body: '错误信息要走 i18n。',
          outdated: true
        })
      ]
    })
    expect(text).toContain('1. src/login/LoginForm.tsx 第 88 行（代码已变化，原文：setError(e.message)）')
    expect(text).toContain('   意见：错误信息要走 i18n。')
    expect(text).not.toContain('代码：setError')
  })

  it('orders by path then line and includes the note', () => {
    const text = renderRevisionRequest({
      workspaceId: 'tws_x',
      round: 1,
      note: '优先改登录相关',
      comments: [
        comment({ commentId: 'rvc_cccccccc', path: 'b.ts', line: 9 }),
        comment({ commentId: 'rvc_dddddddd', path: 'a.ts', line: 20 }),
        comment({ commentId: 'rvc_eeeeeeee', path: 'a.ts', line: 5 })
      ]
    })
    const first = text.indexOf('1. a.ts 第 5 行')
    const second = text.indexOf('2. a.ts 第 20 行')
    const third = text.indexOf('3. b.ts 第 9 行')
    expect(first).toBeGreaterThan(-1)
    expect(first).toBeLessThan(second)
    expect(second).toBeLessThan(third)
    expect(text).toContain('优先改登录相关')
  })

  it('renders old-side labels', () => {
    const text = renderRevisionRequest({
      workspaceId: 'tws_x',
      round: 1,
      comments: [comment({ side: 'old' })]
    })
    expect(text).toContain('（旧版本）')
  })
})
