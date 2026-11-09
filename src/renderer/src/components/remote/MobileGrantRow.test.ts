// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MobileLinkScope } from '@shared/mobile-link-scopes'
import { MOBILE_REMOTE_SCOPES } from '@shared/mobile-link-scopes'
import type { MobileLink } from './useMobileLink'
import { MobileGrantRow } from './MobileGrantRow'
import i18n from '../../i18n'
const gate = vi.hoisted(() => ({ allowed: true }))
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
  const [scopes, setScopes] = useState<MobileLinkScope[]>(MOBILE_REMOTE_SCOPES)
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
async function advanced() { await act(async () => (container.querySelector('details input') as HTMLInputElement).click()) }
it('paired desktop access is included without per-phone controls or a save step', async () => {
  await act(async () => root.render(createElement(Harness)))
  expect(container.textContent).toContain('查看与控制 · 已包含')
  expect(container.querySelector('[aria-pressed]')).toBeNull()
  expect([...container.querySelectorAll('button')].some(b => b.textContent === '保存权限')).toBe(false)
  expect(save).not.toHaveBeenCalled()
})
it('keeps unrelated advanced changes explicit and preserves included desktop access', async () => {
  await act(async () => root.render(createElement(Harness))); await advanced()
  expect(save).not.toHaveBeenCalled()
  gate.allowed = false; await click('保存权限'); expect(save).not.toHaveBeenCalled()
  gate.allowed = true; await click('保存权限')
  expect(save).toHaveBeenCalledWith('grant', expect.arrayContaining([...MOBILE_REMOTE_SCOPES, 'groups.read']))
  expect(save.mock.calls[0][1]).toHaveLength(4)
  await act(async () => apply(true))
  expect(container.textContent).toContain('权限已保存')
  expect(container.textContent).not.toContain('有未保存的权限变更')
})
it('keeps an advanced draft after a failed save and restores it on cancel', async () => {
  await act(async () => root.render(createElement(Harness))); await advanced(); await click('保存权限')
  await act(async () => apply(false))
  expect(container.textContent).toContain('权限未保存，请重试')
  await click('取消')
  expect((container.querySelector('details input') as HTMLInputElement).checked).toBe(false)
  expect(container.textContent).toContain('查看与控制 · 已包含')
})
it('does not claim advanced permissions saved before the server echoes them', async () => {
  await act(async () => root.render(createElement(Harness))); await advanced(); await click('保存权限')
  await act(async () => apply(true, false))
  expect(container.textContent).not.toContain('权限已保存')
  expect(container.textContent).toContain('有未保存的权限变更')
})
it('preserves advanced drafts during polling without changing desktop access', async () => {
  await act(async () => root.render(createElement(Harness)))
  await advanced(); await act(async () => poll([...MOBILE_REMOTE_SCOPES].reverse()))
  expect((container.querySelector('details input') as HTMLInputElement).checked).toBe(true)
  expect(container.textContent).toContain('有未保存的权限变更')
})
it('asks before revoking the whole device', async () => {
  await act(async () => root.render(createElement(Harness)))
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  await click('撤销这台设备'); expect(revoke).not.toHaveBeenCalled()
  confirm.mockReturnValue(true); await click('撤销这台设备'); expect(revoke).toHaveBeenCalledWith('grant')
})
