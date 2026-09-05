import { describe, expect, it } from 'vitest'
import {
  buildResearchPrompt,
  calculateComposerMenuScrollTop,
  formatGoalElapsedSeconds,
  parseCompactCommand,
  parseGoalCommand,
  parseNewCommand,
  parseResearchCommand,
  parseReviewCommand,
  shouldShowGoalFloater
} from './FloatingComposer'
import { getGoalPanelDraftObjective } from './floating-composer-commands'

describe('FloatingComposer slash commands', () => {
  it('parses compact command aliases', () => {
    expect(parseCompactCommand('/compact')).toEqual({})
    expect(parseCompactCommand('/compress')).toEqual({})
    expect(parseCompactCommand('/summarize')).toEqual({})
    expect(parseCompactCommand('/压缩')).toEqual({})
    expect(parseCompactCommand('/压缩会话')).toEqual({})
    expect(parseCompactCommand('/总结')).toEqual({})
  })

  it('parses compact reasons and ignores adjacent command names', () => {
    expect(parseCompactCommand('/compact preparing for a long continuation')).toEqual({
      reason: 'preparing for a long continuation'
    })
    expect(parseCompactCommand('/压缩会话 继续实现前整理上下文')).toEqual({
      reason: '继续实现前整理上下文'
    })
    expect(parseCompactCommand('/compactness')).toBeNull()
    expect(parseCompactCommand('please /compact')).toBeNull()
  })

  it('parses goal command controls and objectives', () => {
    expect(parseGoalCommand('/goal')).toEqual({ action: 'menu' })
    expect(parseGoalCommand('/goal pause')).toEqual({ action: 'pause' })
    expect(parseGoalCommand('/goal resume')).toEqual({ action: 'resume' })
    expect(parseGoalCommand('/goal clear')).toEqual({ action: 'clear' })
    expect(parseGoalCommand('/goal ship the feature')).toEqual({
      action: 'set',
      objective: 'ship the feature'
    })
    expect(parseGoalCommand('/goalkeeper')).toBe(false)
  })

  it('parses new session command aliases', () => {
    expect(parseNewCommand('/new')).toBe(true)
    expect(parseNewCommand('/new-thread')).toBe(true)
    expect(parseNewCommand('/新建会话')).toBe(true)
    expect(parseNewCommand('/new current task')).toBe(false)
    expect(parseNewCommand('/new-topic')).toBe(false)
  })

  it('parses review command targets', () => {
    expect(parseReviewCommand('/review')).toEqual({ kind: 'uncommittedChanges' })
    expect(parseReviewCommand('/review base main')).toEqual({ kind: 'baseBranch', branch: 'main' })
    expect(parseReviewCommand('/review branch release/1.2')).toEqual({ kind: 'baseBranch', branch: 'release/1.2' })
    expect(parseReviewCommand('/review commit abc123')).toEqual({ kind: 'commit', sha: 'abc123' })
    expect(parseReviewCommand('/review focus on auth regressions')).toEqual({
      kind: 'custom',
      instructions: 'focus on auth regressions'
    })
    expect(parseReviewCommand('/reviewer')).toBe(false)
  })

  it('parses research topics and fills the research brief', () => {
    expect(parseResearchCommand('/research')).toBeNull()
    expect(parseResearchCommand('/deepresearch cache economics')).toBe('cache economics')
    expect(parseResearchCommand('/deep-research web + papers')).toBe('web + papers')
    expect(parseResearchCommand('/researcher')).toBe(false)
    expect(buildResearchPrompt('Topic: {{topic}}', 'provider cache')).toBe('Topic: provider cache')
    expect(buildResearchPrompt('Topic: {{topic}}', null)).toBe('Topic: {{topic}}')
  })

  it('uses ordinary composer text as a goal draft only when the goal panel is open', () => {
    expect(getGoalPanelDraftObjective('ship the goal UX', true)).toBe('ship the goal UX')
    expect(getGoalPanelDraftObjective('  ship the goal UX  ', true)).toBe('ship the goal UX')
    expect(getGoalPanelDraftObjective('ship the goal UX', false)).toBe('')
    expect(getGoalPanelDraftObjective('/goal pause', true)).toBe('')
    expect(getGoalPanelDraftObjective('/compact after this', true)).toBe('')
  })
})

describe('FloatingComposer goal helpers', () => {
  it('formats elapsed goal time compactly', () => {
    expect(formatGoalElapsedSeconds(3)).toBe('3s')
    expect(formatGoalElapsedSeconds(60)).toBe('1m')
    expect(formatGoalElapsedSeconds(125)).toBe('2m 5s')
    expect(formatGoalElapsedSeconds(3720)).toBe('1h 2m')
  })

  it('shows the goal banner only when no other composer overlay is active', () => {
    expect(shouldShowGoalFloater({
      compact: false, hasActiveGoal: true, slashQuery: null,
      goalPanelOpen: false, composerMenuOpen: false
    })).toBe(true)
    expect(shouldShowGoalFloater({
      compact: true, hasActiveGoal: true, slashQuery: null,
      goalPanelOpen: false, composerMenuOpen: false
    })).toBe(false)
    expect(shouldShowGoalFloater({
      compact: false, hasActiveGoal: true, slashQuery: 'goal',
      goalPanelOpen: false, composerMenuOpen: false
    })).toBe(false)
    expect(shouldShowGoalFloater({
      compact: false, hasActiveGoal: true, slashQuery: null,
      goalPanelOpen: true, composerMenuOpen: false
    })).toBe(false)
    expect(shouldShowGoalFloater({
      compact: false, hasActiveGoal: false, slashQuery: null,
      goalPanelOpen: false, composerMenuOpen: false
    })).toBe(false)
  })

  it('scrolls keyboard-highlighted menu items into view', () => {
    expect(calculateComposerMenuScrollTop({
      containerScrollTop: 0, containerClientHeight: 100,
      itemOffsetTop: 120, itemOffsetHeight: 30
    })).toBe(50)
    expect(calculateComposerMenuScrollTop({
      containerScrollTop: 60, containerClientHeight: 100,
      itemOffsetTop: 30, itemOffsetHeight: 24
    })).toBe(30)
    expect(calculateComposerMenuScrollTop({
      containerScrollTop: 40, containerClientHeight: 100,
      itemOffsetTop: 70, itemOffsetHeight: 24
    })).toBe(40)
  })
})
