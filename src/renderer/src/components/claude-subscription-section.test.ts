import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelProviderProfileV1 } from '@shared/app-settings-types'
import { ClaudeSubscriptionSection } from './claude-subscription-section'

const provider: ModelProviderProfileV1 = {
  id: 'claude-subscription',
  name: 'Claude Pro/Max',
  apiKey: '',
  baseUrl: '',
  endpointFormat: 'chat_completions',
  kind: 'agent-sdk',
  useProxy: false,
  models: [],
  modelProfiles: {}
}

const t = (key: string): string => key

function textContent(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : textContent(child)).join('')
}

function button(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const result = renderer.root.findAllByType('button')
    .find((candidate) => textContent(candidate).trim() === label)
  expect(result, `button "${label}"`).toBeTruthy()
  return result!
}

type ProgressListener = (state: {
  status: string
  receivedBytes: number
  totalBytes: number
  message?: string
}) => void

async function flushEffects(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('ClaudeSubscriptionSection SDK lifecycle', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  it('keeps an installed SDK in restarting state until the runtime reports done', async () => {
    let emitProgress: ProgressListener | undefined
    vi.stubGlobal('window', {
      kunGui: {
        claudeSubscriptionSdkStatus: vi.fn(async () => ({
          installed: true,
          download: { status: 'restarting', receivedBytes: 1, totalBytes: 1 }
        })),
        claudeSubscriptionSdkInstall: vi.fn(),
        onClaudeSubscriptionSdkProgress: vi.fn((listener: ProgressListener) => {
          emitProgress = listener
          return () => undefined
        }),
        claudeSubscriptionStatus: vi.fn(async () => ({ loggedIn: false, source: 'none' }))
      }
    })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(ClaudeSubscriptionSection, {
        provider,
        onTokenChange: vi.fn(),
        t
      }))
      await flushEffects()
    })

    expect(textContent(renderer.root)).toContain('claudeSubSdkRestarting')
    expect(textContent(renderer.root)).not.toContain('claudeSubSdkMissing')
    expect(button(renderer, 'claudeSubRecheck').props.disabled).toBe(true)
    expect(button(renderer, 'claudeSubLoginButton').props.disabled).toBe(true)

    await act(async () => {
      emitProgress?.({ status: 'done', receivedBytes: 1, totalBytes: 1 })
    })

    expect(textContent(renderer.root)).not.toContain('claudeSubSdkRestarting')
    expect(button(renderer, 'claudeSubRecheck').props.disabled).toBe(false)
    expect(button(renderer, 'claudeSubLoginButton').props.disabled).toBe(false)

    await act(async () => renderer.unmount())
  })

  it('keeps a restart failure actionable even when the SDK binary exists', async () => {
    const install = vi.fn(async () => ({
      status: 'restarting',
      receivedBytes: 1,
      totalBytes: 1
    }))
    vi.stubGlobal('window', {
      kunGui: {
        claudeSubscriptionSdkStatus: vi.fn(async () => ({
          installed: true,
          download: {
            status: 'error',
            receivedBytes: 1,
            totalBytes: 1,
            message: 'runtime restart failed'
          }
        })),
        claudeSubscriptionSdkInstall: install,
        onClaudeSubscriptionSdkProgress: vi.fn(() => () => undefined),
        claudeSubscriptionStatus: vi.fn(async () => ({ loggedIn: false, source: 'none' }))
      }
    })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(ClaudeSubscriptionSection, {
        provider,
        onTokenChange: vi.fn(),
        t
      }))
      await flushEffects()
    })

    expect(textContent(renderer.root)).toContain('claudeSubSdkMissing')
    expect(textContent(renderer.root)).toContain('claudeSubSdkFailed: runtime restart failed')
    const retry = button(renderer, 'claudeSubSdkDownload')
    expect(retry.props.disabled).not.toBe(true)

    await act(async () => {
      await retry.props.onClick()
    })

    expect(install).toHaveBeenCalledOnce()
    expect(textContent(renderer.root)).toContain('claudeSubSdkRestarting')
    expect(button(renderer, 'claudeSubLoginButton').props.disabled).toBe(true)

    await act(async () => renderer.unmount())
  })
})
