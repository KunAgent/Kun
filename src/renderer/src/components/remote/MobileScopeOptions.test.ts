import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MobileScopeOptions, selectMobileScope } from './MobileScopeOptions'

describe('trusted desktop advanced mobile permissions', () => {
  it('starts with every advanced option unchecked and explains the narrower read scopes', () => {
    const html = renderToStaticMarkup(createElement(MobileScopeOptions, { zh: true, value: ['personal'], onChange: () => {} }))
    expect(html.match(/type="checkbox"/g)).toHaveLength(7)
    expect(html).not.toContain('checked=""')
    expect(html).toContain('默认关闭')
    expect(html).toContain('桌面自动运行')
    expect(html).toContain('本次启动')
  })
  it('selects necessary read access and removes dependent write permissions when read access is unchecked', () => {
    expect(selectMobileScope(['personal'], 'groups.write', true).sort()).toEqual(['personal', 'groups.read', 'groups.write'].sort())
    expect(selectMobileScope(['personal'], 'extensions.control', true)).toEqual(['personal', 'extensions.control', 'extensions.read'])
    expect(selectMobileScope(['personal', 'extensions.read', 'extensions.control'], 'extensions.read', false)).toEqual(['personal'])
    const selected = selectMobileScope(['personal', 'groups.read', 'groups.write', 'collaboration.read'], 'groups.read', false)
    expect(selected).toEqual(['personal'])
    const html = renderToStaticMarkup(createElement(MobileScopeOptions, { zh: false,
      value: ['personal', 'groups.read'], onChange: () => {}, disabled: true }))
    expect(html).toContain('checked=""'); expect(html.match(/disabled=""/g)).toHaveLength(7)
  })
})
