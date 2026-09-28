import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { KunHarnessSettingsV1 } from '@shared/app-settings'
import { AgentCenterCustomForm } from './agent-center-custom-form'

const mocks = vi.hoisted(() => ({
  probeHarnessDefinition: vi.fn(),
  storeHarnessSecret: vi.fn(async () => 'cred_new'),
  deleteHarnessSecret: vi.fn(async () => undefined)
}))

vi.mock('../../agent/registry', () => ({
  getProvider: () => ({
    probeHarnessDefinition: mocks.probeHarnessDefinition,
    storeHarnessSecret: mocks.storeHarnessSecret,
    deleteHarnessSecret: mocks.deleteHarnessSecret
  })
}))

const t = (key: string, options?: Record<string, unknown>): string =>
  options ? `${key} ${JSON.stringify(options)}` : key

function settings(custom: KunHarnessSettingsV1['custom'] = []): KunHarnessSettingsV1 {
  return {
    disabledIds: [],
    binaryPaths: {},
    custom,
    defaults: {},
    defaultHarnessId: 'kun',
    agentOrder: [],
    terminalAgents: []
  }
}

function render(custom: KunHarnessSettingsV1['custom'] = []) {
  const updateKun = vi.fn()
  let root!: ReactTestRenderer
  act(() => {
    root = create(
      createElement(AgentCenterCustomForm, { settings: settings(custom), updateKun, t })
    )
  })
  return { root, updateKun }
}

function inputByPlaceholder(root: ReactTestRenderer, placeholder: string) {
  return root.root.find(
    (node) => node.type === 'input' && node.props.placeholder === placeholder
  )
}

function textContent(children: unknown): string {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(textContent).join('')
  if (children && typeof children === 'object' && 'props' in children) {
    return textContent((children.props as { children?: unknown }).children)
  }
  return ''
}

function buttonByText(root: ReactTestRenderer, text: string) {
  return root.root.findAll(
    (node) => node.type === 'button' && textContent(node.props.children).includes(text)
  )[0]
}

async function fillBasics(root: ReactTestRenderer): Promise<void> {
  await act(async () => {
    inputByPlaceholder(root, 'adeSettings.acpFormName').props.onChange({
      target: { value: 'My Agent' }
    })
    inputByPlaceholder(root, 'adeSettings.acpFormCommand').props.onChange({
      target: { value: '/bin/my-agent' }
    })
  })
}

const okProbe = {
  durationMs: 12,
  ok: true,
  supported: true,
  protocol: 'acp',
  agent: { name: 'my-agent', version: '1.0' }
}

beforeAll(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('AgentCenterCustomForm test-before-save gating (P4-12)', () => {
  it('keeps Add disabled until a fresh successful probe', async () => {
    const { root } = render()
    const add = buttonByText(root, 'adeSettings.acpFormAdd')
    expect(add.props.disabled).toBe(true)

    mocks.probeHarnessDefinition.mockResolvedValue(okProbe)
    await fillBasics(root)
    await act(async () => {
      buttonByText(root, 'adeSettings.acpFormTest').props.onClick()
    })

    expect(mocks.probeHarnessDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: 'My Agent',
        command: '/bin/my-agent',
        id: 'custom-my-agent'
      })
    )
    expect(buttonByText(root, 'adeSettings.acpFormAdd').props.disabled).toBe(false)
  })

  it('saves the custom entry through updateKun once probed', async () => {
    const { root, updateKun } = render()
    mocks.probeHarnessDefinition.mockResolvedValue(okProbe)
    await fillBasics(root)
    await act(async () => {
      buttonByText(root, 'adeSettings.acpFormTest').props.onClick()
    })
    await act(async () => {
      buttonByText(root, 'adeSettings.acpFormAdd').props.onClick()
    })
    expect(updateKun).toHaveBeenCalledWith(
      expect.objectContaining({
        harnesses: expect.objectContaining({
          custom: [
            expect.objectContaining({
              id: 'custom-my-agent',
              displayName: 'My Agent',
              command: '/bin/my-agent'
            })
          ]
        })
      })
    )
  })

  it('blocks save on a failed probe until save-anyway is chosen', async () => {
    const { root } = render()
    mocks.probeHarnessDefinition.mockResolvedValue({
      durationMs: 5,
      ok: false,
      supported: true,
      detail: 'spawn failed'
    })
    await fillBasics(root)
    await act(async () => {
      buttonByText(root, 'adeSettings.acpFormTest').props.onClick()
    })
    expect(buttonByText(root, 'adeSettings.acpFormAdd').props.disabled).toBe(true)

    await act(async () => {
      buttonByText(root, 'adeSettings.acpFormSaveAnyway').props.onClick()
    })
    expect(buttonByText(root, 'adeSettings.acpFormAdd').props.disabled).toBe(false)
  })

  it('invalidates the probe when a field changes afterwards', async () => {
    const { root } = render()
    mocks.probeHarnessDefinition.mockResolvedValue(okProbe)
    await fillBasics(root)
    await act(async () => {
      buttonByText(root, 'adeSettings.acpFormTest').props.onClick()
    })
    expect(buttonByText(root, 'adeSettings.acpFormAdd').props.disabled).toBe(false)

    await act(async () => {
      inputByPlaceholder(root, 'adeSettings.acpFormArgs').props.onChange({
        target: { value: '--acp' }
      })
    })
    expect(buttonByText(root, 'adeSettings.acpFormAdd').props.disabled).toBe(true)
  })

  it('binds a secret into a secretEnv ref and never stores the raw value', async () => {
    const { root, updateKun } = render()
    mocks.probeHarnessDefinition.mockResolvedValue(okProbe)
    await fillBasics(root)
    await act(async () => {
      inputByPlaceholder(root, 'adeSettings.acpFormSecretName').props.onChange({
        target: { value: 'my_key' } // upper-cased by the input handler
      })
      inputByPlaceholder(root, 'adeSettings.acpFormSecretValue').props.onChange({
        target: { value: 'super-secret' }
      })
    })
    await act(async () => {
      buttonByText(root, 'adeSettings.acpFormSecretBind').props.onClick()
    })
    expect(mocks.storeHarnessSecret).toHaveBeenCalledWith('super-secret')

    await act(async () => {
      buttonByText(root, 'adeSettings.acpFormTest').props.onClick()
    })
    expect(mocks.probeHarnessDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        secretEnv: [{ name: 'MY_KEY', secretRef: 'cred_new' }]
      })
    )
    // The probe request — and everything on the wire — carries the ref only.
    const payload = mocks.probeHarnessDefinition.mock.calls[0]?.[0]
    expect(JSON.stringify(payload)).not.toContain('super-secret')

    await act(async () => {
      buttonByText(root, 'adeSettings.acpFormAdd').props.onClick()
    })
    const patch = updateKun.mock.calls[0]?.[0]
    expect(patch.harnesses.custom[0].secretEnv).toEqual([
      { name: 'MY_KEY', secretRef: 'cred_new' }
    ])
    expect(JSON.stringify(patch)).not.toContain('super-secret')
  })

  it('rejects a duplicate id before save', async () => {
    const { root, updateKun } = render([
      {
        id: 'custom-my-agent',
        displayName: 'My Agent',
        command: '/bin/x',
        args: [],
        env: {}
      }
    ])
    mocks.probeHarnessDefinition.mockResolvedValue(okProbe)
    await fillBasics(root)
    await act(async () => {
      buttonByText(root, 'adeSettings.acpFormTest').props.onClick()
    })
    // Even with a fresh probe the duplicate id must not be persisted.
    await act(async () => {
      buttonByText(root, 'adeSettings.acpFormAdd').props.onClick()
    })
    expect(updateKun).not.toHaveBeenCalled()
  })
})
