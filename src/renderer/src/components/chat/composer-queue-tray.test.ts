/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComposerActivityTray } from './composer-tray/ComposerActivityTray'
import {
  FloatingComposerQueuedMessages,
  type QueuedComposerMessage
} from './FloatingComposerQueuedMessages'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) => {
      const parts = Object.entries(values ?? {})
        .map(([name, value]) => `${name}=${String(value)}`)
      return parts.length > 0 ? `${key} ${parts.join(' ')}` : key
    }
  })
}))

type QueueProps = Parameters<typeof FloatingComposerQueuedMessages>[0]

function message(
  id: string,
  text: string,
  overrides: Partial<QueuedComposerMessage> = {}
): QueuedComposerMessage {
  return { id, text, ...overrides }
}

function queueRow(container: HTMLElement, id: string): HTMLLIElement {
  const row = container.querySelector<HTMLLIElement>(`[data-queued-message-id="${id}"]`)
  if (!row) throw new Error(`missing queued message row: ${id}`)
  return row
}

function dragHandle(row: Element): HTMLButtonElement {
  const handle = row.querySelector<HTMLButtonElement>('[data-queued-message-drag-handle]')
  if (!handle) throw new Error('missing queued message drag handle')
  return handle
}

function reorderControls(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('[data-queued-message-drag-handle]')]
}

function action(kind: string, row: Element): HTMLButtonElement {
  const button = row.querySelector<HTMLButtonElement>(`[data-queued-message-action="${kind}"]`)
  if (!button) throw new Error(`missing queue action: ${kind}`)
  return button
}

describe('FloatingComposerQueuedMessages in the activity tray', () => {
  let container: HTMLDivElement
  let root: Root
  let props: QueueProps

  const render = async (overrides: Partial<QueueProps> = {}): Promise<void> => {
    props = { ...props, ...overrides }
    await act(async () => {
      root.render(createElement(FloatingComposerQueuedMessages, props))
    })
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    props = { messages: [], running: true, onRemove: vi.fn(), onGuide: vi.fn(), onReorder: vi.fn() }
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
    vi.restoreAllMocks()
  })

  it('renders inside the tray queue slot, below the segment bar', async () => {
    await act(async () => {
      root.render(createElement(ComposerActivityTray, {
        kinds: [],
        queue: createElement(FloatingComposerQueuedMessages, {
          messages: [message('q-1', '/review the diff')],
          running: true,
          onRemove: vi.fn()
        })
      }))
    })
    const slot = container.querySelector('[data-composer-tray] > [data-composer-tray-queue]')
    expect(slot?.getAttribute('aria-label')).toBe('composerTray.queueLabel')
    expect(slot?.querySelector('[data-queue-dock][data-composer-stack-item="queue"]')).not.toBeNull()
    expect(slot?.querySelector('[data-queued-message-id="q-1"]')?.textContent).toContain('/review the diff')
  })

  it('captions the queue with its count, drag hint and delivery phase', async () => {
    await render({ messages: [message('q-1', 'one'), message('q-2', 'two')] })
    const caption = container.querySelector('[data-queued-message-caption]')
    expect(caption?.textContent).toBe('composerQueue.caption count=2composerQueue.dragHint')

    await render({ messages: [message('q-1', 'one')] })
    expect(container.querySelector('[data-queued-message-caption]')?.textContent)
      .toBe('composerQueue.caption count=1')

    await render({ messages: [message('q-1', 'one')], running: false })
    expect(container.querySelector('[data-queued-message-caption]')?.textContent)
      .toBe('queuedMessagesTitle count=1')

    await render({
      messages: [message('q-1', 'one', { deliveryState: 'starting' }), message('q-2', 'two')],
      running: true
    })
    // Reordering pauses while a row is handed to the runtime: no drag hint.
    expect(container.querySelector('[data-queued-message-caption]')?.textContent)
      .toBe('queuedMessagesConfirming count=2')
    expect(reorderControls(container)).toHaveLength(0)
  })

  it('always shows the first row actions and marks the others for hover reveal', async () => {
    await render({
      messages: [message('q-1', 'one'), message('q-2', 'two')],
      onRestoreToComposer: vi.fn(() => true)
    })
    expect(queueRow(container, 'q-1').getAttribute('data-first')).toBe('true')
    expect(queueRow(container, 'q-2').hasAttribute('data-first')).toBe(false)
    for (const id of ['q-1', 'q-2']) {
      const row = queueRow(container, id)
      expect([...row.querySelectorAll('[data-queued-message-action]')]
        .map((button) => button.getAttribute('data-queued-message-action')))
        .toEqual(['guide', 'edit', 'remove', 'more'])
    }
    expect(action('guide', queueRow(container, 'q-1')).textContent).toBe('composerQueue.now')
    expect(action('guide', queueRow(container, 'q-1')).getAttribute('aria-label'))
      .toBe('composerQueue.nowLabel')
  })

  it('summarizes attachments by name or count and shows the failure reason', async () => {
    await render({
      messages: [
        message('q-named', 'look', { attachments: [{ name: 'shot.png', kind: 'image' }] }),
        message('q-images', 'compare', {
          attachments: [{ name: 'a.png', kind: 'image' }, { name: 'b.png', kind: 'image' }]
        }),
        message('q-failed', 'deploy', { deliveryState: 'failed', errorMessage: 'network down' })
      ],
      running: false
    })
    const named = queueRow(container, 'q-named').querySelector('[data-queued-message-images]')
    expect(named?.textContent).toBe('shot.png')
    const images = queueRow(container, 'q-images').querySelector('[data-queued-message-images]')
    expect(images?.getAttribute('data-queued-message-images')).toBe('2')
    expect(images?.textContent).toBe('composerQueue.images count=2')
    expect(images?.getAttribute('title')).toBe('a.png, b.png')
    const status = queueRow(container, 'q-failed').querySelector('[data-queued-message-status]')
    expect(status?.getAttribute('data-tone')).toBe('danger')
    expect(status?.textContent).toBe('queuedMessageFailednetwork down')
  })

  it('unfolds the list when a keyboard move lands past the folded rows', async () => {
    const onReorder = vi.fn()
    await render({
      messages: ['q-1', 'q-2', 'q-3', 'q-4', 'q-5'].map((id) => message(id, id)),
      onReorder
    })
    const header = container.querySelector<HTMLButtonElement>('[data-queued-message-header]')!
    expect(header.getAttribute('aria-expanded')).toBe('false')
    const third = dragHandle(queueRow(container, 'q-3'))
    third.focus()
    await act(async () => {
      third.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect(onReorder).toHaveBeenLastCalledWith('q-3', 'q-4', 'after')
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelectorAll('[data-queued-message-id]')).toHaveLength(5)
  })
})
