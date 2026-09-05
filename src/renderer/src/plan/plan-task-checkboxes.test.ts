import { describe, expect, it } from 'vitest'
import { normalizePlanTaskPath, planHasTaskCheckboxes } from './plan-task-checkboxes'

describe('plan-task-checkboxes', () => {
  it('detects task checkboxes outside code fences', () => {
    const markdown = [
      '# Demo', '## Implementation', '- [ ] Build feature', '```md', '- [x] Ignore me', '```',
      '### Tests', '* [X] Add tests', '+ [ ] Ship'
    ].join('\r\n')
    expect(planHasTaskCheckboxes(markdown)).toBe(true)
  })

  it('returns false when tasks only live inside fences', () => {
    const markdown = [
      '## Tasks', '````md', '- [ ] Hidden one', '```', '- [ ] Hidden two',
      '```` not-a-close', '- [ ] Hidden three', '````',
      '~~~', '- [ ] Hidden tilde', '~~~'
    ].join('\r\n')
    expect(planHasTaskCheckboxes(markdown)).toBe(false)
  })

  it('normalizes Windows-style plan paths for todo matching', () => {
    expect(normalizePlanTaskPath('.kunsdd\\plan\\demo.md')).toBe('.kunsdd/plan/demo.md')
    expect(normalizePlanTaskPath('./a//b.md')).toBe('a/b.md')
  })
})
