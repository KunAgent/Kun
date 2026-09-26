import { describe, expect, it } from 'vitest'
import { isAssignmentBlock, parseAssignmentCard } from './assignment-card'

const SAMPLE = `<kun_assignment dispatch="dsp_1" worker="wrk_1" from="总管">
## 任务
重构登录模块

## 背景与约束
- 保持现有 API

## 协作方式
- 完成后汇报
</kun_assignment>`

describe('parseAssignmentCard', () => {
  it('parses attributes and body', () => {
    const parsed = parseAssignmentCard(SAMPLE)
    expect(parsed).toMatchObject({
      dispatchId: 'dsp_1',
      workerId: 'wrk_1',
      from: '总管',
      title: '重构登录模块'
    })
    expect(parsed?.body).toContain('## 协作方式')
  })

  it('uses the english task heading too', () => {
    const parsed = parseAssignmentCard(
      '<kun_assignment dispatch="d" worker="w">\n## Task\nFix the flaky test\n</kun_assignment>'
    )
    expect(parsed?.title).toBe('Fix the flaky test')
  })

  it('returns null for ordinary text and malformed wrappers', () => {
    expect(parseAssignmentCard('hello world')).toBeNull()
    expect(parseAssignmentCard('<kun_assignment worker="w">no close')).toBeNull()
    expect(parseAssignmentCard('<kun_assignment worker="w"></kun_assignment>')).toBeNull()
    expect(parseAssignmentCard('<kun_assignment worker="w"')).toBeNull()
  })

  it('detects assignment user blocks only', () => {
    expect(isAssignmentBlock({ kind: 'user', text: SAMPLE })).toBe(true)
    expect(isAssignmentBlock({ kind: 'assistant', text: SAMPLE })).toBe(false)
    expect(isAssignmentBlock({ kind: 'user', text: 'plain' })).toBe(false)
  })
})
