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
// The fixture mounts a React root at import time. Unmount it and let the scheduler
// drain before the jsdom globals go away, or its queued work throws "window is not defined".
afterAll(async () => {
  try {
    (window as unknown as { agentEnablementFixture?: { dispose(): void } }).agentEnablementFixture?.dispose()
    // Two timer turns cover the scheduler's setImmediate-driven work loop.
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
  } finally {
    vi.unstubAllGlobals()
  }
})

// Default vi.waitFor gives up after 1s, which a CPU-starved CI worker can exceed.
const waitFor = <T>(callback: () => T | Promise<T>) => vi.waitFor(callback, { timeout: 20_000 })

// AgentCenter applies settingsHarnessId in an effect. Its first committed card
// can be another disabled Agent; wait for Pi, not just any matching control.
const piCard = '[data-agent-detail-slot="pi"]:not([hidden]) [data-agent-enablement="pi"]'
async function piModelButton(): Promise<HTMLButtonElement> {
  return waitFor(() => {
    const button = document.querySelector<HTMLButtonElement>(`${piCard} [data-agent-profile-model]`)
    expect(button).toBeTruthy()
    return button!
  })
}

it('waits for the selected Pi card instead of clicking a transient disabled Agent', async () => {
  const container = document.getElementById('root')!
  container.innerHTML = '<div data-agent-detail-slot="claude-code"><div data-agent-enablement="claude-code" data-agent-enablement-state="disabled"><button data-agent-profile-model></button></div></div>'
  const transient = container.querySelector('button')!
  const clicked = vi.fn()
  transient.addEventListener('click', clicked)
  const selection = piModelButton().then((button) => { button.click(); return button })
  try {
    // Simulate the initial fallback card surviving a scheduler turn before the
    // deep-link selection effect commits. A generic selector clicks it now.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(clicked).not.toHaveBeenCalled()
    container.innerHTML = '<div data-agent-detail-slot="pi"><div data-agent-enablement="pi" data-agent-enablement-state="disabled"><button data-agent-profile-model></button></div></div>'
    expect(await selection).toBe(container.querySelector('button'))
    expect(clicked).not.toHaveBeenCalled()
  } finally {
    container.innerHTML = ''
  }
})

async function chooseCustomModel(value: string): Promise<void> {
  const button = await piModelButton()
  button.click()
  await waitFor(() => expect(document.querySelector('[data-agent-custom-model]')).toBeTruthy())
  document.querySelector<HTMLButtonElement>('[data-agent-custom-model]')!.click()
  await waitFor(() => expect(document.querySelector('[data-agent-custom-model-input]')).toBeTruthy())
  const input = document.querySelector<HTMLInputElement>('[data-agent-custom-model-input]')!
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  document.querySelector<HTMLButtonElement>('[data-agent-custom-model-apply]')!.click()
  await waitFor(() => expect(document.querySelector('[data-agent-settings-model-menu]')).toBeNull())
}

it('runs the real settings check, composer gate and late-result cancellation with no real account', async () => {
  await import('./AgentEnablementSmokeFixture')
  const fixture = (window as unknown as { agentEnablementFixture: {
    reset(): Promise<void>; setOutcome(value: 'success' | 'failure' | 'pending'): void; resolvePending(ok: boolean): void
    close(): void; reopen(): void; restart(): void; setNavigationBusy(busy: boolean): void
    snapshot(): { enabledProfiles: unknown[]; defaults: Record<string, { model?: string }>; calls: { tests: number; mutations: number } }
  } }).agentEnablementFixture
  const state = (value: string) => vi.waitFor(() => expect(document.querySelector(piCard)?.getAttribute('data-agent-enablement-state'), document.body.textContent?.slice(-2500)).toBe(value), { timeout: 20_000 })
  const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click()
  await fixture.reset(); await state('disabled')
  await chooseCustomModel('fixture-model')
  await new Promise((resolve) => setTimeout(resolve, 0))
  click('[data-agent-enable]'); await state('ready')
  expect(fixture.snapshot().defaults.pi.model).toBe('fixture-model')
  expect(fixture.snapshot().enabledProfiles).toHaveLength(1)
  click('[data-composer-harness-picker]')
  await waitFor(() => expect(document.querySelector('[data-harness-id="pi"]')).toBeTruthy())
  expect(document.querySelector('[data-harness-id="deepseek-harness"]')).toBeNull()
  expect(document.querySelector('[data-harness-id="retired-agent"]')).toBeNull()
  click('[data-composer-harness-picker]')
  expect(document.querySelector('[data-settings-category-view="harnesses"]')).toBeTruthy()
  expect(fixture.snapshot().calls.mutations).toBeGreaterThan(0)
  fixture.close()
  await waitFor(() => expect(document.querySelector('[data-agent-enablement]')).toBeNull())
  fixture.reopen(); await state('ready')
  expect(fixture.snapshot().enabledProfiles).toHaveLength(1)
  fixture.restart(); await state('needs-check')
  click('[data-composer-harness-picker]')
  await waitFor(() => expect(document.querySelector('[data-harness-picker-menu]')).toBeTruthy())
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
  await waitFor(() => expect(fixture.snapshot().calls.tests).toBe(4))
  fixture.setNavigationBusy(true); fixture.close(); await state('disabled')
  // Back intent invalidates the result even while navigation is awaiting UI reload.
  fixture.resolvePending(true)
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(fixture.snapshot().enabledProfiles).toEqual([])
  fixture.setNavigationBusy(false)
  await waitFor(() => expect(document.querySelector('[data-agent-enablement]')).toBeNull())
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
  await piModelButton()
  const changed = vi.fn()
  window.addEventListener('kun:settings-changed', changed)
  try {
    fixture.theme('dark')
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ theme: 'dark' }) }))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
    expect((await window.kunGui.getSettings()).theme).toBe('dark')
    await chooseCustomModel('theme-persistence-model')
    await waitFor(() => expect(fixture.snapshot().defaults.pi.model).toBe('theme-persistence-model'))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect((await window.kunGui.getSettings()).theme).toBe('dark')
    fixture.close()
    await waitFor(() => expect(document.querySelector('[data-agent-enablement]')).toBeNull())
    fixture.reopen()
    await piModelButton()
    expect(document.documentElement.dataset.theme).toBe('dark')
    fixture.theme('light')
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'))
    expect((await window.kunGui.getSettings()).theme).toBe('light')
  } finally {
    window.removeEventListener('kun:settings-changed', changed)
    await fixture.reset()
  }
}, 30_000)
