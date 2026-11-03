/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FloatingComposerQueuedMessages,
  type QueuedComposerMessage
} from './FloatingComposerQueuedMessages'
import css from './FloatingComposerQueuedMessages.module.css'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) => {
      const parts = Object.entries(values ?? {}).map(([name, value]) => `${name}=${String(value)}`)
      return parts.length > 0 ? `${key} ${parts.join(' ')}` : key
    }
  })
}))

type QueueProps = Parameters<typeof FloatingComposerQueuedMessages>[0]

function message(id: string, overrides: Partial<QueuedComposerMessage> = {}): QueuedComposerMessage {
  return { id, text: `text ${id}`, ...overrides }
}

describe('FloatingComposerQueuedMessages paused queue and row menu', () => {
  let container: HTMLDivElement
  let root: Root

  const render = async (props: Partial<QueueProps>): Promise<void> => {
    await act(async () => {
      root.render(createElement(FloatingComposerQueuedMessages, {
        messages: [], running: false, onRemove: vi.fn(), onGuide: vi.fn(), ...props
      }))
    })
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  it('replaces the caption with a paused notice whose Continue button resumes the queue', async () => {
    const onResume = vi.fn(async () => true)
    await render({
      messages: [
        message('q-1', { deliveryState: 'paused', clientRequestId: 'r1' } as Partial<QueuedComposerMessage>),
        message('q-2', { deliveryState: 'paused' })
      ],
      onResume
    })
    const banner = container.querySelector('[data-queue-paused-banner]')
    expect(banner?.getAttribute('role')).toBe('status')
    expect(banner?.textContent).toContain('composerQueue.pausedTitle')
    expect(banner?.textContent).toContain('composerQueue.pausedCount count=2')
    // Only the reason ellipsizes: the count sits beside it, outside the clip.
    const spans = [...(banner?.querySelectorAll('span') ?? [])]
    const title = spans.find((span) => span.textContent === 'composerQueue.pausedTitle')
    const count = spans.find((span) => span.textContent === 'composerQueue.pausedCount count=2')
    expect(title?.classList.contains(css.captionText)).toBe(true)
    expect(count?.closest(`.${css.captionText}`)).toBeNull()
    expect(count?.parentElement).toBe(title?.parentElement)
    expect(container.querySelector('[data-queued-message-caption]')).toBeNull()
    expect(container.querySelector('[data-queued-message-header]')).toBeNull()
    expect(container.querySelectorAll('[data-queued-message-id]')).toHaveLength(2)
    // Rows defer to the banner: no per-row retry or paused chip.
    const guides = [...container.querySelectorAll<HTMLButtonElement>('[data-queued-message-action="guide"]')]
    expect(guides.every((button) => button.hidden)).toBe(true)
    expect(container.textContent).not.toContain('queuedMessagePaused')

    const resume = container.querySelector<HTMLButtonElement>('[data-queue-resume]')!
    expect(resume.disabled).toBe(false)
    expect(resume.textContent).toBe('composerQueue.resume')
    expect(resume.title).toBe('composerQueue.resumeHint')
    await act(async () => resume.click())
    expect(onResume).toHaveBeenCalledTimes(1)
  })

  it('disables resume while a reply is still running', async () => {
    await render({
      messages: [message('q-1', { deliveryState: 'paused' })],
      running: true,
      onResume: vi.fn()
    })
    const resume = container.querySelector<HTMLButtonElement>('[data-queue-resume]')!
    expect(resume.disabled).toBe(true)
    expect(resume.title).toBe('queueResumeBusy')
  })

  it('keeps the edit-pending chip and shows no banner for rows being restored', async () => {
    await render({
      messages: [message('q-1', { deliveryState: 'paused', editIntent: 'restoring' })],
      onResume: vi.fn()
    })
    expect(container.querySelector('[data-queue-paused-banner]')).toBeNull()
    expect(container.textContent).toContain('queuedMessageRestorePending')
  })

  it('moves a later row to the top from its overflow menu', async () => {
    const onReorder = vi.fn()
    await render({
      messages: [message('q-1'), message('q-2'), message('q-3')],
      running: true,
      onReorder
    })
    const thirdRow = container.querySelector('[data-queued-message-id="q-3"]')!
    const more = thirdRow.querySelector<HTMLButtonElement>('[data-queued-message-action="more"]')!
    await act(async () => more.click())
    expect(more.getAttribute('aria-expanded')).toBe('true')
    const moveTop = document.body.querySelector<HTMLButtonElement>(
      '[data-queued-message-menu] [data-queued-message-action="move-top"]'
    )!
    await act(async () => moveTop.click())
    expect(onReorder).toHaveBeenCalledWith('q-3', 'q-1', 'before')
    expect(document.body.querySelector('[data-queued-message-menu]')).toBeNull()

    const firstMore = container.querySelector('[data-queued-message-id="q-1"]')!
      .querySelector<HTMLButtonElement>('[data-queued-message-action="more"]')!
    await act(async () => firstMore.click())
    expect(document.body.querySelector('[data-queued-message-action="move-top"]')).toBeNull()
  })
})
