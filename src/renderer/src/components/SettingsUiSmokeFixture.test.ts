// @vitest-environment jsdom
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { afterAll, expect, it, vi } from 'vitest'

// A contract/render check only. Native geometry, accessible names, focus and
// screenshots are measured exclusively by scripts/smoke-settings-ui.mjs.
const errors: string[] = []
window.addEventListener('error', event => errors.push(event.message))
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)))
Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({
  matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}
}) })
HTMLElement.prototype.scrollTo = () => undefined
HTMLElement.prototype.scrollIntoView = () => undefined
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
document.body.innerHTML = '<div id="root"></div>'

let root: Root | undefined
afterAll(async () => {
  await act(async () => root?.unmount())
  vi.unstubAllGlobals()
})

async function waitUntil(test: () => boolean): Promise<void> {
  await vi.waitFor(() => expect(test(), `${errors.join('\n')}\n${document.body.textContent?.slice(0, 3000)}`).toBe(true), { timeout: 20_000, interval: 20 })
}
async function settled(): Promise<void> {
  await waitUntil(() => !document.querySelector('[data-testid="settings-section-fallback"]'))
  await new Promise(resolve => setTimeout(resolve, 30))
}

it('renders all real SettingsView destinations and every discovered nested tab offline', async () => {
  root = (await import('./SettingsUiSmokeFixture')).fixtureRoot
  await waitUntil(() => !!document.querySelector('[data-settings-category-view="general"]'))
  const categories = [...document.querySelectorAll<HTMLButtonElement>('[data-settings-category]')]
    .map(element => element.dataset.settingsCategory!)
  expect(new Set(categories).size).toBe(22)
  expect(categories).not.toContain('integrations')
  const panels: string[] = []
  const discovered = new Set<string>()
  for (const category of categories) {
    document.querySelector<HTMLButtonElement>(`[data-settings-category="${category}"]`)!.click()
    await waitUntil(() => !!document.querySelector(`[data-settings-category-view="${category}"]`))
    await settled()
    const visited = new Set<string>()
    for (let iteration = 0; iteration < 120; iteration++) {
      expect(errors, `Renderer errors in ${category}`).toEqual([])
      const summary = [...document.querySelectorAll<HTMLElement>('[data-settings-category-view] details:not([open]) > summary')]
        .find(element => !element.closest('[hidden]'))
      if (summary) {
        summary.click()
        await settled()
        continue
      }
      const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-settings-category-view] [role="tab"]')]
        .filter(element => !element.closest('[hidden]'))
      const key = (tab: HTMLElement): string => tab.id || `${tab.closest('[role="tablist"]')?.getAttribute('aria-label')}::${tab.textContent}`
      for (const tab of tabs) discovered.add(`${category}:${key(tab)}`)
      for (const tab of tabs.filter(tab => tab.getAttribute('aria-selected') === 'true')) visited.add(key(tab))
      const next = tabs.reverse().find(tab => !visited.has(key(tab)))
      if (!next) break
      visited.add(key(next))
      panels.push(`${category}:${key(next)}`)
      next.click()
      await settled()
      expect(iteration).toBeLessThan(119)
    }
  }
  expect(panels.length).toBeGreaterThan(30)
  const fixture = (window as unknown as { settingsFixture: {
    label(key: string, fallback?: string): string
    host: ReturnType<typeof import('./SettingsUiSmokeHost').installSettingsSmokeHost>
  } }).settingsFixture
  const button = (label: string): HTMLButtonElement => {
    const result = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(element => element.textContent?.trim() === label && !element.closest('[hidden]'))
    expect(result, `Missing button ${label}`).toBeDefined()
    return result!
  }
  document.querySelector<HTMLButtonElement>('[data-settings-category="terminal"]')!.click()
  await settled()
  button(fixture.label('sshAddServer', 'Add server')).click()
  await waitUntil(() => !!document.querySelector('[role="dialog"]'))
  document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label]')!.click()
  document.querySelector<HTMLButtonElement>('[data-settings-category="updates"]')!.click()
  await settled()
  fixture.host.setBusy('checkGuiUpdate', true)
  const check = button(fixture.label('guiUpdateCheck'))
  check.click()
  await waitUntil(() => check.disabled)
  fixture.host.setBusy('checkGuiUpdate', false)
  await waitUntil(() => !check.disabled)
  document.querySelector<HTMLButtonElement>('[data-settings-category="uninstall"]')!.click()
  await settled()
  button(fixture.label('uninstallAction')).click()
  await waitUntil(() => [...document.querySelectorAll('button')]
    .some(element => element.textContent?.trim() === fixture.label('uninstallConfirmCancel')))
  button(fixture.label('uninstallConfirmCancel')).click()
  expect(fixture.host.calls.some(call => call.name === 'uninstall.perform')).toBe(false)
  console.log(`Real SettingsView: ${categories.length} destinations; ${discovered.size} discovered tabs; ${panels.length} tab transitions; SSH/update/uninstall states`)
  expect(errors).toEqual([])
}, 120_000)
