import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import { formatGoalElapsed, goalElapsedSecondsAt } from './goal-tray-elapsed'
import {
  GoalActionButton,
  GoalStatusToggleButton,
  formatGoalTokens,
  goalSegmentStatusLabel,
  goalStatusLabel,
  goalTrayTone
} from './goal-tray-parts'
import type { TrayTranslate } from './tray-elapsed'

const en: TrayTranslate = (key, options) => i18n.getFixedT('en', 'common')(key, options)
const zh: TrayTranslate = (key, options) => i18n.getFixedT('zh', 'common')(key, options)

describe('goal elapsed', () => {
  it('adds the running turn to the persisted time only while timing', () => {
    const nowMs = 1_000_000
    expect(goalElapsedSecondsAt({ goal: { timeUsedSeconds: 60 }, timing: true, anchorMs: nowMs - 42_500, nowMs })).toBe(102)
    expect(goalElapsedSecondsAt({ goal: { timeUsedSeconds: 60 }, timing: false, anchorMs: nowMs - 42_500, nowMs })).toBe(60)
    expect(goalElapsedSecondsAt({ goal: { timeUsedSeconds: 60 }, timing: true, anchorMs: undefined, nowMs })).toBe(60)
    // A clock skew never subtracts time.
    expect(goalElapsedSecondsAt({ goal: { timeUsedSeconds: 60 }, timing: true, anchorMs: nowMs + 5000, nowMs })).toBe(60)
    expect(goalElapsedSecondsAt({ goal: { timeUsedSeconds: Number.NaN }, timing: false, anchorMs: undefined, nowMs })).toBe(0)
  })

  it('counts seconds for the first minute, then minutes', async () => {
    await i18n.loadLanguages('zh')
    expect(formatGoalElapsed(0, en)).toBe('0s')
    expect(formatGoalElapsed(42, en)).toBe('42s')
    expect(formatGoalElapsed(18 * 60 + 12, en)).toBe('18 min')
    expect(formatGoalElapsed(3600 + 5 * 60 + 9, en)).toBe('1 h 5 min')
    expect(formatGoalElapsed(18 * 60 + 12, zh)).toBe('18 分钟')
    expect(formatGoalElapsed(42, zh)).toBe('42 秒')
  })

  it('uses the short form in compact bars', async () => {
    await i18n.loadLanguages('zh')
    expect(formatGoalElapsed(42, en, true)).toBe('42s')
    expect(formatGoalElapsed(18 * 60 + 12, en, true)).toBe('18m')
    expect(formatGoalElapsed(3600 + 5 * 60 + 9, en, true)).toBe('1h 5m')
    expect(formatGoalElapsed(18 * 60 + 12, zh, true)).toBe('18 分')
  })
})

describe('goal status', () => {
  it('maps statuses to tray tones', () => {
    expect(goalTrayTone('active')).toBe('running')
    expect(goalTrayTone('paused')).toBe('default')
    expect(goalTrayTone('blocked')).toBe('waiting')
    expect(goalTrayTone('usageLimited')).toBe('waiting')
    expect(goalTrayTone('budgetLimited')).toBe('waiting')
    expect(goalTrayTone('complete')).toBe('done')
  })

  it('has full pill labels and the old short words for the bar', async () => {
    await i18n.loadLanguages('zh')
    expect(goalStatusLabel('active', en)).toBe('Active')
    expect(goalStatusLabel('usageLimited', en)).toBe('Usage limited')
    expect(goalStatusLabel('active', zh)).toBe('进行中')
    expect(goalStatusLabel('budgetLimited', zh)).toBe('预算受限')
    expect(goalSegmentStatusLabel('active', en)).toBeNull()
    expect(goalSegmentStatusLabel('paused', zh)).toBe('已暂停')
    expect(goalSegmentStatusLabel('blocked', zh)).toBe('阻塞')
    expect(goalSegmentStatusLabel('complete', en)).toBe('Done')
  })
})

describe('formatGoalTokens', () => {
  it('formats token counts compactly', () => {
    expect(formatGoalTokens(0)).toBe('0')
    expect(formatGoalTokens(860)).toBe('860')
    expect(formatGoalTokens(1500)).toBe('1.5k')
    expect(formatGoalTokens(8000)).toBe('8k')
    expect(formatGoalTokens(142_300)).toBe('142k')
    expect(formatGoalTokens(999_499)).toBe('999k')
    expect(formatGoalTokens(999_500)).toBe('1M')
    expect(formatGoalTokens(2_400_000)).toBe('2.4M')
    expect(formatGoalTokens(37_000_000)).toBe('37M')
    expect(formatGoalTokens(Number.NaN)).toBe('0')
  })
})

describe('goal tray stylesheet', () => {
  const css = readFileSync(
    resolve(process.cwd(), 'src/renderer/src/components/chat/composer-tray/goal-tray.css'),
    'utf8'
  )

  it('keeps the trailing goal segment whole in a crowded bar', () => {
    expect(css).toMatch(
      /\.ds-composer-tray-segment-slot\[data-composer-stack-item='goal'\]\s*\{\s*flex-shrink:\s*0;\s*\}/
    )
  })

  it('keeps the focus ring on the outlined status toggle', () => {
    expect(css).toMatch(
      /\.ds-goal-tray-action\[data-variant='outline'\]:focus-visible\s*\{[^}]*inset 0 0 0 1px var\(--ds-border\),\s*0 0 0 2px color-mix\(in srgb, var\(--ds-accent\) 45%, transparent\)/
    )
    const toggle = renderToStaticMarkup(createElement(GoalStatusToggleButton, { status: 'paused', onToggle: () => {} }))
    expect(toggle).toMatch(/class="ds-composer-tray-button[^"]*\bds-goal-tray-action\b/)
    expect(toggle).toContain('data-variant="outline"')
    expect(toggle).toContain('data-goal-action="resume"')
    const clear = renderToStaticMarkup(createElement(GoalActionButton, { danger: true }, 'Clear'))
    expect(clear).toContain('ds-goal-tray-action')
  })
})
