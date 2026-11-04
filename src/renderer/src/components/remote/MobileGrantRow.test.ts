// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MobileLinkScope } from '@shared/mobile-link-scopes'
import type { MobileLink } from './useMobileLink'
import { MobileGrantRow } from './MobileGrantRow'
import i18n from '../../i18n'

const gate = vi.hoisted(() => ({ allowed: true }))
// jsdom cannot produce trusted clicks; the production gate is tested separately.
vi.mock('../../extensions/protected-user-activation', () => ({ runTrustedUserActivation: (_event: unknown, action: () => void) => { if (gate.allowed) action(); return gate.allowed } }))
let root: Root, container: HTMLDivElement, apply!: (ok: boolean, echo?: boolean) => void
let poll!: (scopes: MobileLinkScope[]) => void
const save = vi.fn(), revoke = vi.fn()
beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await i18n.changeLanguage('zh')
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  save.mockClear(); revoke.mockClear(); gate.allowed = true
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks() })
function Harness() {
  const [scopes, setScopes] = useState<MobileLinkScope[]>(['personal'])
  poll = setScopes
  const link = { zh: true, busy: null, mobileAllowed: true, revoke, setScopes: (id: string, next: MobileLinkScope[]) => {
    save(id, next)
    return new Promise<boolean>(resolve => { apply = (ok, echo = true) => { if (ok && echo) setScopes(next); resolve(ok) } })
  } } as unknown as MobileLink
  return createElement(MobileGrantRow, { link, grant: { id: 'grant', controllerId: 'phone', name: 'iPhone', scopes } })
}
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(value => value.textContent === text)!
  expect(button).toBeTruthy(); await act(async () => button.click())
}
it('requires an explicit trusted save and confirms the actual saved grant', async () => {
  await act(async () => root.render(createElement(Harness)))
  await click('控制')
  expect(save).not.toHaveBeenCalled()
  expect(container.textContent).toContain('尚未授权')
  expect(container.textContent).toContain('有未保存的权限变更')
  gate.allowed = false; await click('保存权限'); expect(save).not.toHaveBeenCalled()
  gate.allowed = true; await click('保存权限')
  expect(save).toHaveBeenCalledWith('grant', ['personal', 'desktop.control', 'desktop.view'])
  await act(async () => apply(true))
  expect(container.textContent).toContain('已授权：查看与键鼠控制')
  expect(container.textContent).toContain('权限已保存')
  expect(container.textContent).not.toContain('有未保存的权限变更')
})
it('keeps the draft after failed save and cancel restores server consent', async () => {
  await act(async () => root.render(createElement(Harness)))
  await click('查看'); await click('保存权限'); await act(async () => apply(false))
  expect(container.textContent).toContain('权限未保存，请重试')
  expect(container.textContent).toContain('尚未授权')
  await click('取消')
  expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toBe('关闭')
})
it('never reports success before the server echoes saved scopes', async () => {
  await act(async () => root.render(createElement(Harness)))
  await click('查看'); await click('保存权限'); await act(async () => apply(true, false))
  expect(container.textContent).not.toContain('权限已保存')
  expect(container.textContent).toContain('有未保存的权限变更')
})
it('preserves a dirty draft during polling, but updates a pristine form', async () => {
  await act(async () => root.render(createElement(Harness)))
  await act(async () => poll(['personal', 'schedules.read']))
  expect(container.textContent).not.toContain('有未保存的权限变更')
  await click('控制')
  await act(async () => poll(['schedules.read', 'personal']))
  expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toBe('控制')
  expect(container.textContent).toContain('有未保存的权限变更')
})
it('asks before revoking the device', async () => {
  await act(async () => root.render(createElement(Harness)))
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  await click('撤销这台设备'); expect(revoke).not.toHaveBeenCalled()
  confirm.mockReturnValue(true); await click('撤销这台设备'); expect(revoke).toHaveBeenCalledWith('grant')
})
