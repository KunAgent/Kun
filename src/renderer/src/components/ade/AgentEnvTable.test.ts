// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const provider = vi.hoisted(() => ({ storeHarnessSecret: vi.fn(), deleteHarnessSecret: vi.fn() }))
vi.mock('../../agent/registry', () => ({ getProvider: () => provider }))
import { AgentEnvTable } from './AgentEnvTable'

const t = (key: string): string => key
let root: Root, container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  provider.storeHarnessSecret.mockReset().mockResolvedValue('ref-new'); provider.deleteHarnessSecret.mockReset().mockResolvedValue(undefined)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

const setValue = (input: HTMLInputElement, value: string): void => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
const render = async (props: Partial<Parameters<typeof AgentEnvTable>[0]> = {}) => {
  const onChange = vi.fn()
  await act(async () => root.render(createElement(AgentEnvTable, { env: { CODEX_HOME: '~/.codex' }, secretEnv: [], onChange, t, tSettings: t, ...props })))
  return onChange
}

it('saves a changed value only when the field loses focus', async () => {
  const onChange = await render()
  const value = container.querySelectorAll<HTMLInputElement>('[data-agent-env-row] input')[1]!
  await act(async () => setValue(value, '~/.codex-work'))
  expect(onChange).not.toHaveBeenCalled()
  await act(async () => { value.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
  expect(onChange).toHaveBeenCalledWith({ env: { CODEX_HOME: '~/.codex-work' } })
})

it('flags an invalid or duplicate name and does not save until it is fixed', async () => {
  const onChange = await render({ env: { A: '1' } })
  await act(async () => container.querySelector<HTMLButtonElement>('[data-agent-env-add]')!.click())
  const rows = [...container.querySelectorAll<HTMLElement>('[data-agent-env-row]')]
  const name = rows[1]!.querySelectorAll('input')[0]!
  await act(async () => setValue(name, 'a-b'))
  expect(name.getAttribute('aria-invalid')).toBe('true')
  await act(async () => { name.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
  expect(onChange).not.toHaveBeenCalled()
  await act(async () => setValue(name, 'A'))
  expect(name.getAttribute('aria-invalid')).toBe('true')
  await act(async () => setValue(name, 'B'))
  expect(name.getAttribute('aria-invalid')).toBeNull()
})

it('removes a variable at once', async () => {
  const onChange = await render({ env: { A: '1', B: '2' } })
  await act(async () => container.querySelectorAll<HTMLButtonElement>('[data-agent-env-row] button')[0]!.click())
  expect(onChange).toHaveBeenCalledWith({ env: { B: '2' } })
})

it('stores a sensitive value in the credential store and keeps only a reference', async () => {
  const onChange = await render()
  await act(async () => container.querySelector<HTMLButtonElement>('[data-agent-secret-add]')!.click())
  const [name, value] = container.querySelectorAll<HTMLInputElement>('form input')
  await act(async () => { setValue(name!, 'openai_key'); setValue(value!, 'sk-secret') })
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  expect(provider.storeHarnessSecret).toHaveBeenCalledWith('sk-secret')
  expect(onChange).toHaveBeenCalledWith({ secretEnv: [{ name: 'OPENAI_KEY', secretRef: 'ref-new' }] })
  expect(JSON.stringify(onChange.mock.calls)).not.toContain('sk-secret')
})

it('shows saved sensitive variables without their value and releases the credential on removal', async () => {
  const onChange = await render({ secretEnv: [{ name: 'TOKEN', secretRef: 'ref-1' }] })
  const row = container.querySelector('[data-agent-secret-row="TOKEN"]')!
  expect(row.textContent).toContain('agentCenter.launch.stored')
  await act(async () => row.querySelector('button')!.click())
  expect(onChange).toHaveBeenCalledWith({ secretEnv: [] })
  expect(provider.deleteHarnessSecret).toHaveBeenCalledWith('ref-1')
})

it('rejects a sensitive variable that reuses a plain variable name', async () => {
  const onChange = await render()
  await act(async () => container.querySelector<HTMLButtonElement>('[data-agent-secret-add]')!.click())
  const [name, value] = container.querySelectorAll<HTMLInputElement>('form input')
  await act(async () => { setValue(name!, 'CODEX_HOME'); setValue(value!, 'x') })
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  expect(provider.storeHarnessSecret).not.toHaveBeenCalled()
  expect(onChange).not.toHaveBeenCalled()
  expect(container.querySelector('[role="alert"]')).not.toBeNull()
})
