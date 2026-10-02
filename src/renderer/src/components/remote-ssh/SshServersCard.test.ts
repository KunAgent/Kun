// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { SshServersCard } from './SshServersCard'

const roots: ReturnType<typeof createRoot>[] = []
afterEach(() => {
  roots.forEach(root => { act(() => root.unmount()) })
  roots.length = 0
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

it('keeps the SSH dialog outside the size-contained card and restores keyboard focus', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Object.assign(window, { kunGui: { listRemoteSshHosts: async () => [] } })
  const host = document.createElement('div')
  host.className = 'ds-settings-surface'
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  const t = (key: string, options?: Record<string, unknown>): string => String(options?.defaultValue ?? key)
  await act(async () => { root.render(createElement(SshServersCard, { t })) })
  const add = [...host.querySelectorAll('button')].find(button => button.textContent === 'Add server')!
  add.focus()
  await act(async () => { add.click() })
  const dialog = host.querySelector<HTMLDivElement>('[role="dialog"]')!
  expect(dialog.getAttribute('aria-label')).toBe('Add server')
  expect(dialog.closest('.ds-settings-card')).toBeNull()
  expect(dialog.querySelector('form')?.className).toContain('overflow-y-auto')
  expect(document.activeElement).toBe(dialog.querySelector('input'))
  const controls = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
  controls.at(-1)!.focus()
  await act(async () => {
    controls.at(-1)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
  })
  expect(document.activeElement).toBe(controls[0])
  await act(async () => {
    controls[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
  })
  expect(document.activeElement).toBe(controls.at(-1))
  await act(async () => {
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  })
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(add)
})
