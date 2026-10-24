import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import {
  TrayElapsedLabel,
  elapsedSecondsSince,
  formatTrayAgo,
  formatTrayDuration
} from './tray-elapsed'

const en = i18n.getFixedT('en', 'common')
const zh = i18n.getFixedT('zh', 'common')

beforeAll(async () => {
  // zh is lazily loaded by the locale backend.
  await i18n.loadLanguages('zh')
})

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

describe('formatTrayDuration', () => {
  it('formats exact running time', () => {
    expect(formatTrayDuration(12, en)).toBe('12s')
    expect(formatTrayDuration(192, en)).toBe('3m 12s')
    expect(formatTrayDuration(180, en)).toBe('3m')
    expect(formatTrayDuration(3900, en)).toBe('1h 5m')
    expect(formatTrayDuration(7200, en)).toBe('2h')
    expect(formatTrayDuration(192, zh)).toBe('3 分 12 秒')
    expect(formatTrayDuration(728, zh)).toBe('12 分 8 秒')
  })

  it('formats coarse elapsed time in minutes', () => {
    expect(formatTrayDuration(30, en, 'minutes')).toBe('<1 min')
    expect(formatTrayDuration(26 * 60 + 5, en, 'minutes')).toBe('26 min')
    expect(formatTrayDuration(3900, en, 'minutes')).toBe('1 h 5 min')
    expect(formatTrayDuration(18 * 60, zh, 'minutes')).toBe('18 分钟')
    expect(formatTrayDuration(3600, zh, 'minutes')).toBe('1 小时')
  })

  it('treats invalid and negative input as zero', () => {
    expect(formatTrayDuration(Number.NaN, en)).toBe('0s')
    expect(formatTrayDuration(-5, en)).toBe('0s')
  })
})

describe('formatTrayAgo', () => {
  it('reads relative time', () => {
    expect(formatTrayAgo(20, en)).toBe('just now')
    expect(formatTrayAgo(125, en)).toBe('2 min ago')
    expect(formatTrayAgo(125, zh)).toBe('2 分钟前')
    expect(formatTrayAgo(8 * 60, zh)).toBe('8 分钟前')
  })
})

describe('elapsedSecondsSince', () => {
  it('accepts epoch ms and ISO strings', () => {
    const now = Date.parse('2026-10-23T10:00:00Z')
    expect(elapsedSecondsSince(now - 61_500, now)).toBe(61)
    expect(elapsedSecondsSince('2026-10-23T09:58:00Z', now)).toBe(120)
    expect(elapsedSecondsSince(now + 5_000, now)).toBe(0)
    expect(elapsedSecondsSince(null, now)).toBeNull()
    expect(elapsedSecondsSince('not a date', now)).toBeNull()
  })
})

describe('TrayElapsedLabel', () => {
  it('renders a fixed span and accumulated time', () => {
    const fixed = renderToStaticMarkup(createElement(TrayElapsedLabel, {
      since: '2026-10-23T10:00:00Z',
      until: '2026-10-23T10:03:12Z'
    }))
    expect(fixed).toContain('3m 12s')
    expect(fixed).toContain('tabular-nums')
    const base = renderToStaticMarkup(createElement(TrayElapsedLabel, { baseSeconds: 26 * 60, precision: 'minutes' }))
    expect(base).toContain('26 min')
    expect(renderToStaticMarkup(createElement(TrayElapsedLabel, {}))).toBe('')
  })
})
