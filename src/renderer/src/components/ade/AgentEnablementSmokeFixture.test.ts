// @vitest-environment jsdom
import { afterAll, expect, it, vi } from 'vitest'

// Native hit targets and zoom are measured by the Electron runner; this only
// verifies that the offline boundary exercises real component state changes.
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', false)
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
HTMLElement.prototype.scrollTo = () => undefined
HTMLElement.prototype.scrollIntoView = () => undefined
document.body.innerHTML = '<div id="root"></div>'
afterAll(() => vi.unstubAllGlobals())

it('runs the real settings check, composer gate and late-result cancellation with no real account', async () => {
  await import('./AgentEnablementSmokeFixture')
  const fixture = (window as unknown as { agentEnablementFixture: {
    reset(): Promise<void>; setOutcome(value: 'success' | 'failure' | 'pending'): void; resolvePending(ok: boolean): void
    close(): void; reopen(): void; restart(): void; setNavigationBusy(busy: boolean): void
    snapshot(): { enabledProfiles: unknown[]; defaults: Record<string, { model?: string }>; calls: { tests: number; mutations: number } }
  } }).agentEnablementFixture
  const state = (value: string) => vi.waitFor(() => expect(document.querySelector('[data-agent-enablement]')?.getAttribute('data-agent-enablement-state'), document.body.textContent?.slice(-2500)).toBe(value), { timeout: 20_000 })
  const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click()
  await fixture.reset(); await state('disabled')
  const model = document.querySelector<HTMLInputElement>('[data-agent-profile-model]')!
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(model, 'fixture-model')
  model.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  click('[data-agent-enable]'); await state('ready')
  expect(fixture.snapshot().defaults.pi.model).toBe('fixture-model')
  expect(fixture.snapshot().enabledProfiles).toHaveLength(1)
  click('[data-composer-harness-picker]')
  await vi.waitFor(() => expect(document.querySelector('[data-harness-id="pi"]')).toBeTruthy())
  expect(document.querySelector('[data-harness-id="deepseek-harness"]')).toBeNull()
  expect(document.querySelector('[data-harness-id="gemini-cli"]')).toBeNull()
  click('[data-composer-harness-picker]')
  expect(document.querySelector('[data-settings-category-view="agents"]')).toBeTruthy()
  expect(fixture.snapshot().calls.mutations).toBeGreaterThan(0)
  fixture.close()
  await vi.waitFor(() => expect(document.querySelector('[data-agent-enablement]')).toBeNull())
  fixture.reopen(); await state('ready')
  expect(fixture.snapshot().enabledProfiles).toHaveLength(1)
  fixture.restart(); await state('needs-check')
  click('[data-composer-harness-picker]')
  await vi.waitFor(() => expect(document.querySelector('[data-harness-picker-menu]')).toBeTruthy())
  expect(document.querySelector('[data-harness-id="pi"]')).toBeNull()
  click('[data-composer-harness-picker]')
  click('[data-agent-recheck]'); await state('ready')
  click('[data-agent-enable]'); await state('disabled')
  fixture.setOutcome('pending'); click('[data-agent-enable]'); await state('checking')
  click('[data-agent-enable-cancel]'); await state('disabled')
  fixture.resolvePending(true)
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(fixture.snapshot().enabledProfiles).toEqual([])
  fixture.setOutcome('pending'); click('[data-agent-enable]'); await state('checking')
  await vi.waitFor(() => expect(fixture.snapshot().calls.tests).toBe(4))
  fixture.setNavigationBusy(true); fixture.close(); await state('disabled')
  // Back intent invalidates the result even while navigation is awaiting UI reload.
  fixture.resolvePending(true)
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(fixture.snapshot().enabledProfiles).toEqual([])
  fixture.setNavigationBusy(false)
  await vi.waitFor(() => expect(document.querySelector('[data-agent-enablement]')).toBeNull())
  fixture.reopen(); await state('disabled')
  await fixture.reset()
}, 60_000)

it('applies the saved theme through SettingsView and retains it after saves and reopening', async () => {
  await import('./AgentEnablementSmokeFixture')
  const fixture = (window as unknown as { agentEnablementFixture: {
    reset(): Promise<void>; theme(value: 'light' | 'dark'): void; close(): void; reopen(): void
    snapshot(): { defaults: Record<string, { model?: string }> }
  } }).agentEnablementFixture
  await fixture.reset()
  await vi.waitFor(() => expect(document.querySelector('[data-agent-profile-model]')).toBeTruthy())
  const changed = vi.fn()
  window.addEventListener('kun:settings-changed', changed)
  try {
    fixture.theme('dark')
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ theme: 'dark' }) }))
    await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
    expect((await window.kunGui.getSettings()).theme).toBe('dark')
    const model = document.querySelector<HTMLInputElement>('[data-agent-profile-model]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(model, 'theme-persistence-model')
    model.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => expect(fixture.snapshot().defaults.pi.model).toBe('theme-persistence-model'))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect((await window.kunGui.getSettings()).theme).toBe('dark')
    fixture.close()
    await vi.waitFor(() => expect(document.querySelector('[data-agent-enablement]')).toBeNull())
    fixture.reopen()
    await vi.waitFor(() => expect(document.querySelector('[data-agent-profile-model]')).toBeTruthy())
    expect(document.documentElement.dataset.theme).toBe('dark')
    fixture.theme('light')
    await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'))
    expect((await window.kunGui.getSettings()).theme).toBe('light')
  } finally {
    window.removeEventListener('kun:settings-changed', changed)
    await fixture.reset()
  }
}, 30_000)
