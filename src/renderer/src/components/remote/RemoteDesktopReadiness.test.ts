import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DesktopAccessStatus } from '@shared/remote-desktop'
import { MobileDesktopScopes } from './MobileDesktopScopes'
import { desktopFailureMessage, desktopReadiness } from './desktop-readiness'

const state: DesktopAccessStatus = { supported: true, enabled: true, ready: true, inputReady: true,
  displays: [{ token: 'source', revision: 'revision', label: 'Display', pixelWidth: 1920, pixelHeight: 1080, rotation: 0, allowed: true }] }
describe('desktop setup feedback', () => {
  it('does not label an enabled but unpermitted computer ready', () => {
    const result = desktopReadiness({ ...state, ready: false, reason: 'SCREEN_PERMISSION_REQUIRED' }, true)
    expect(result.warning).toBe(true); expect(result.label).toContain('仍需系统授权')
    expect(result.detail).toContain('当前 Kun 进程')
    expect(desktopReadiness(state, true).label).toBe('电脑端已就绪')
    expect(desktopReadiness({ ...state, inputReady: false }, true).detail).toContain('只看画面')
    expect(desktopReadiness({ ...state, displays: [] }, true).label).toBe('待选择显示器')
  })
  it('keeps phone desktop consent visible and distinguishes a draft from saved authorization', () => {
    const pending = renderToStaticMarkup(createElement(MobileDesktopScopes, { zh: true,
      value: ['personal', 'desktop.view', 'desktop.control'], saved: ['personal'], disabled: false, onChange() {} }))
    expect(pending).not.toContain('<details')
    expect(pending.match(/checked=""/g)).toHaveLength(2)
    expect(pending).toContain('尚未授权')
    expect(pending).toContain('勾选后需保存')
    expect(pending).not.toContain('已授权：查看与键鼠控制')
    const saved = renderToStaticMarkup(createElement(MobileDesktopScopes, { zh: true,
      value: ['personal', 'desktop.view'], saved: ['personal', 'desktop.view'], disabled: false, onChange() {} }))
    expect(saved).toContain('已授权：仅查看桌面')
    expect(saved).toContain('接管桌面的鼠标和键盘')
  })
  it('never displays raw remote failures or credentials', () => {
    expect(desktopFailureMessage('SCREEN_PERMISSION_REQUIRED', true)).toContain('屏幕录制')
    expect(desktopFailureMessage('raw-token-and-session-data', true)).not.toContain('raw-token')
  })
})
