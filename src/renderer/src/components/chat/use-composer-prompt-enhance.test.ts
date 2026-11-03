// @vitest-environment jsdom
import { act, createElement, useRef, useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { useChatStore } from '../../store/chat-store'
import type { PromptOptimizationResult } from '@shared/kun-gui-api'
import { ComposerPromptEnhanceButton, ComposerPromptEnhanceStatus } from './ComposerPromptEnhance'
import { useComposerPromptEnhance } from './use-composer-prompt-enhance'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLDivElement
let root: Root
let pending: Array<(result: PromptOptimizationResult) => void>
const optimizePrompt = vi.fn()
const cancelPromptOptimization = vi.fn(async () => undefined)
const openSettings = vi.fn()

function Harness({ initial, agentLabel, providerId = 'deepseek' }: { initial: string; agentLabel?: string; providerId?: string }): ReactElement {
  const [input, setInput] = useState(initial)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const enhance = useComposerPromptEnhance({
    available: true, editable: true, input, setInput, textareaRef, setCursor: () => undefined, activeThreadId: 'thread-1',
    providerId, model: 'deepseek-v4-pro', kunHarness: !agentLabel, agentLabel
  })
  if (!enhance.visible) return createElement('p', null, 'hidden')
  return createElement('div', null,
    createElement('textarea', {
      ref: textareaRef, value: input, readOnly: enhance.running,
      onChange: (event: { target: { value: string } }) => setInput(event.target.value),
      onKeyDown: (event: Parameters<typeof enhance.handleKeyDown>[0]) => { enhance.handleKeyDown(event) }
    }),
    createElement(ComposerPromptEnhanceStatus, { enhance, t: i18n.t, onOpenSettings: openSettings }),
    createElement(ComposerPromptEnhanceButton, { enhance, t: i18n.t }))
}

const button = (): HTMLButtonElement => host.querySelector('.ds-composer-prompt-optimize-action') as HTMLButtonElement
const textarea = (): HTMLTextAreaElement => host.querySelector('textarea') as HTMLTextAreaElement
const status = (): string => host.querySelector('[data-prompt-enhance-status], [role="alert"]')?.textContent ?? ''

async function render(props: { initial: string; agentLabel?: string; providerId?: string }): Promise<void> {
  await act(async () => root.render(createElement(Harness, props)))
  await act(async () => { await Promise.resolve() })
}

async function click(element: Element): Promise<void> {
  await act(async () => { (element as HTMLElement).click() })
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  pending = []
  optimizePrompt.mockImplementation(() => new Promise((resolve) => { pending.push(resolve) }))
  Object.assign(window, { kunGui: {
    platform: 'darwin',
    getSettings: async () => ({ agents: { kun: { promptOptimization: { enabled: true, providerId: '', model: '', prompt: '', timeoutMs: 60_000, defaultsVersion: 2 } } } }),
    optimizePrompt,
    cancelPromptOptimization
  } })
  useChatStore.setState({ composerModelGroups: [{ providerId: 'deepseek', label: 'DeepSeek', modelIds: ['deepseek-v4-pro'] }] })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.clearAllMocks()
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe('composer prompt enhance', () => {
  it('rewrites the draft with the composer model and undoes it', async () => {
    await render({ initial: 'rough draft' })
    expect(button().title).toContain('deepseek-v4-pro')

    await click(button())
    expect(optimizePrompt).toHaveBeenCalledWith(expect.objectContaining({
      text: 'rough draft', providerId: 'deepseek', model: 'deepseek-v4-pro', requestId: expect.any(String)
    }))
    expect(textarea().readOnly).toBe(true)
    expect(button().getAttribute('aria-label')).toBe('Cancel enhancement')
    expect(status()).toContain('Enhancing with deepseek-v4-pro')

    await act(async () => pending[0]({ ok: true, text: 'Clear prompt', model: 'deepseek-v4-pro', providerId: 'deepseek' }))
    expect(textarea().value).toBe('Clear prompt')
    expect(textarea().readOnly).toBe(false)
    expect(status()).toContain('Enhanced with deepseek-v4-pro')

    await click(host.querySelector('[data-prompt-enhance-status="done"] button') as Element)
    expect(textarea().value).toBe('rough draft')
    expect(host.querySelector('[data-prompt-enhance-status]')).toBeNull()
  })

  it('cancels on a second click and keeps the draft when the late answer arrives', async () => {
    await render({ initial: 'rough draft' })
    await click(button())
    const requestId = optimizePrompt.mock.calls[0][0].requestId

    await click(button())
    expect(cancelPromptOptimization).toHaveBeenCalledWith({ requestId })
    expect(textarea().readOnly).toBe(false)

    await act(async () => pending[0]({ ok: true, text: 'too late', model: 'm', providerId: 'p' }))
    expect(textarea().value).toBe('rough draft')
    expect(host.querySelector('[data-prompt-enhance-status]')).toBeNull()
  })

  it('cancels with Esc and undoes the rewrite with Cmd+Z', async () => {
    await render({ initial: 'rough draft' })
    await click(button())
    await act(async () => { textarea().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(cancelPromptOptimization).toHaveBeenCalledTimes(1)

    await click(button())
    await act(async () => pending[1]({ ok: true, text: 'Clear prompt', model: 'deepseek-v4-pro', providerId: 'deepseek' }))
    await act(async () => { textarea().dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true })) })
    expect(textarea().value).toBe('rough draft')
  })

  it('asks for a prompt first instead of sending an empty draft', async () => {
    await render({ initial: '   ' })
    await click(button())
    expect(optimizePrompt).not.toHaveBeenCalled()
    expect(status()).toContain('Enter a prompt to enhance first')
  })

  it('explains a model Kun cannot call and links to Settings', async () => {
    await render({ initial: 'rough draft', agentLabel: 'Claude Code', providerId: '' })
    expect(button().getAttribute('aria-disabled')).toBe('true')
    await click(button())
    expect(optimizePrompt).not.toHaveBeenCalled()
    expect(status()).toContain('signs in through Claude Code')
    await click(host.querySelector('[data-prompt-enhance-status="unsupported"] button') as Element)
    expect(openSettings).toHaveBeenCalled()
  })

  it('shows a failure without touching the draft', async () => {
    await render({ initial: 'rough draft' })
    await click(button())
    await act(async () => pending[0]({ ok: false, code: 'failed', message: 'Provider returned HTTP 404.' }))
    expect(textarea().value).toBe('rough draft')
    expect(status()).toContain('Enhancement failed: Provider returned HTTP 404. The draft was not changed.')
  })
})
