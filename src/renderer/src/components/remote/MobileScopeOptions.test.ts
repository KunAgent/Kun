import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MOBILE_REMOTE_SCOPES } from '@shared/mobile-link-scopes'
import { MobileScopeOptions, selectMobileScope } from './MobileScopeOptions'

describe('trusted desktop advanced mobile permissions', () => {
  const advancedScopeCount = MOBILE_REMOTE_SCOPES.filter(scope => scope !== 'personal').length
  it('checks all advanced options with default mobile scopes and reports narrowed states accurately', () => {
    const fullHtml = renderToStaticMarkup(createElement(MobileScopeOptions, { zh: true, value: MOBILE_REMOTE_SCOPES, onChange: () => {} }))
    expect(fullHtml.match(/type="checkbox"/g)).toHaveLength(advancedScopeCount)
    expect(fullHtml.match(/checked=""/g)).toHaveLength(advancedScopeCount)
    expect(fullHtml).toContain('手动输入 Mac 登录密码解锁')
    expect(fullHtml).toContain('已全部开启')
    expect(fullHtml).toContain('默认开启')
    expect(fullHtml).toContain('桌面自动运行')
    expect(fullHtml).toContain('本次启动')
    const emptyHtml = renderToStaticMarkup(createElement(MobileScopeOptions, { zh: true, value: ['personal'], onChange: () => {} }))
    expect(emptyHtml).not.toContain('checked=""')
    expect(emptyHtml).toContain('未开启')
    expect(emptyHtml).not.toContain('默认关闭')
  })
  it('selects necessary read access and removes dependent write permissions when read access is unchecked', () => {
    expect(selectMobileScope(['personal'], 'groups.write', true).sort()).toEqual(['personal', 'groups.read', 'groups.write'].sort())
    expect(selectMobileScope(['personal'], 'desktop.control', true)).toEqual(['personal', 'desktop.control', 'desktop.view'])
    expect(selectMobileScope(['personal', 'desktop.view', 'desktop.control'], 'desktop.view', false)).toEqual(['personal'])
    expect(selectMobileScope(['personal'], 'extensions.control', true)).toEqual(['personal', 'extensions.control', 'extensions.read'])
    expect(selectMobileScope(['personal', 'extensions.read', 'extensions.control'], 'extensions.read', false)).toEqual(['personal'])
    const selected = selectMobileScope(['personal', 'groups.read', 'groups.write', 'collaboration.read'], 'groups.read', false)
    expect(selected).toEqual(['personal'])
    const html = renderToStaticMarkup(createElement(MobileScopeOptions, { zh: false,
      value: ['personal', 'groups.read'], onChange: () => {}, disabled: true }))
    expect(html).toContain('checked=""'); expect(html.match(/disabled=""/g)).toHaveLength(advancedScopeCount)
  })
})
