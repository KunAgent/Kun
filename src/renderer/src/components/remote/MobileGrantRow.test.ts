// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MobileLinkScope } from '@shared/mobile-link-scopes'
import type { MobileLink } from './useMobileLink'
import { MobileGrantRow } from './MobileGrantRow'

// jsdom cannot produce browser-trusted clicks. The production gate has its own trust tests.
vi.mock('../../extensions/protected-user-activation', () => ({ runTrustedUserActivation: (_event: unknown, action: () => void) => { action(); return true } }))
let root: Root, container: HTMLDivElement, apply!: (ok: boolean) => void
const save = vi.fn()
beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); save.mockClear()
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
function Harness() {
  const [scopes, setScopes] = useState<MobileLinkScope[]>(['personal'])
  const link = { zh: true, busy: null, revoke: vi.fn(), setScopes: (id: string, next: MobileLinkScope[]) => {
    save(id, next)
    return new Promise<boolean>(resolve => { apply = ok => { if (ok) setScopes(next); resolve(ok) } })
  } } as unknown as MobileLink
  return createElement(MobileGrantRow, { link, grant: { id: 'grant', controllerId: 'phone', name: 'iPhone', scopes } })
}
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(value => value.textContent === text)!
  expect(button).toBeTruthy(); await act(async () => button.click())
}
it('keeps chosen permissions pending until saved and confirms the actual saved grant', async () => {
  await act(async () => root.render(createElement(Harness)))
  const control = container.querySelectorAll('fieldset input')[1] as HTMLInputElement
  await act(async () => control.click())
  expect(save).not.toHaveBeenCalled()
  expect(container.textContent).toContain('尚未授权')
  expect(container.textContent).toContain('有未保存的权限变更')
  await click('保存访问权限')
  expect(save).toHaveBeenCalledWith('grant', ['personal', 'desktop.control', 'desktop.view'])
  await act(async () => apply(true))
  expect(container.textContent).toContain('已授权：查看与键鼠控制')
  expect(container.textContent).toContain('权限已保存')
  expect(container.textContent).not.toContain('有未保存的权限变更')
})
it('keeps saved consent unchanged and shows the failure beside the phone when save fails', async () => {
  await act(async () => root.render(createElement(Harness)))
  await act(async () => (container.querySelector('fieldset input') as HTMLInputElement).click())
  await click('保存访问权限'); await act(async () => apply(false))
  expect(container.textContent).toContain('权限未保存，请重试')
  expect(container.textContent).toContain('尚未授权')
  expect(container.textContent).not.toContain('已授权：仅查看桌面')
  await click('取消修改')
  expect((container.querySelector('fieldset input') as HTMLInputElement).checked).toBe(false)
})
