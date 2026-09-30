// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import type { KunHarnessSettingsV1 } from '@shared/app-settings'

vi.mock('../../agent/registry', () => ({ getProvider: () => ({}) }))

import { AgentCenterAddWizard } from './agent-center-add-wizard'

const settings: KunHarnessSettingsV1 = {
  disabledIds: [], binaryPaths: {}, custom: [], defaults: {},
  defaultHarnessId: 'kun', agentOrder: [], terminalAgents: []
}

let root: Root
let host: HTMLDivElement

function wizard() {
  return createElement(AgentCenterAddWizard, {
    rows: [], settings, updateKun: vi.fn(), onClose: vi.fn(), onSelectAgent: vi.fn()
  })
}

async function changeInput(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!
    descriptor.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function remount(): Promise<void> {
  await act(async () => root.unmount())
  host.remove()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(wizard()))
}

beforeEach(() => {
  window.sessionStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  window.sessionStorage.clear()
})

describe('AgentCenterAddWizard recovery', () => {
  it('restores the selected step and terminal draft after leaving settings', async () => {
    await act(async () => root.render(wizard()))
    await act(async () => document.querySelector<HTMLButtonElement>('[data-agent-add-terminal]')!.click())
    const name = document.querySelector<HTMLInputElement>('[data-terminal-name]')!
    await changeInput(name, 'My Terminal')
    await remount()
    expect(document.querySelector('[data-agent-add-connect]')).toBeTruthy()
    expect(document.querySelector<HTMLInputElement>('[data-terminal-name]')?.value).toBe('My Terminal')
  })

  it('restores custom command inputs without persisting the secret value field', async () => {
    await act(async () => root.render(wizard()))
    await act(async () => document.querySelector<HTMLButtonElement>('[data-agent-add-custom]')!.click())
    const fields = document.querySelectorAll<HTMLInputElement>('[data-agent-custom-form] input')
    await changeInput(fields[0]!, 'My Agent')
    await changeInput(fields[1]!, '/usr/bin/my-agent')
    await changeInput(fields[4]!, 'super-secret')
    await remount()
    const restored = document.querySelectorAll<HTMLInputElement>('[data-agent-custom-form] input')
    expect(restored[0]?.value).toBe('My Agent')
    expect(restored[1]?.value).toBe('/usr/bin/my-agent')
    expect(restored[4]?.value ?? '').toBe('')
  })
})
