import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'

const source = readFileSync(resolve(import.meta.dirname, 'WorkbenchChatStage.tsx'), 'utf8')

describe('WorkbenchChatStage refresh status i18n', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it.each([
    ['en', 'Refreshing…'],
    ['zh', '正在刷新…']
  ] as const)('resolves the active thread refresh status in %s', async (locale, expected) => {
    await i18n.changeLanguage(locale)
    expect(i18n.t('threadRefreshing', { ns: 'common' })).toBe(expected)
  })

  it('uses the common key for both visible and accessible status text', () => {
    expect(source.match(/t\('threadRefreshing'\)/g)).toHaveLength(2)
    expect(source).not.toContain('sidebar:threadRefreshing')
  })

  it('keeps the trajectory Composer mounted but inert and outside pointer hit-testing', () => {
    expect(source).toContain("stack.style.setProperty('--trajectory-composer-height', '0px')")
    expect(source).toContain("'pointer-events-none invisible absolute inset-x-0 bottom-0 z-20'")
    expect(source).toContain('inert={trajectoryOpen || undefined}')
    expect(source).toContain('timelineRange: null')
  })
})
