/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FloatingComposerQueuedMessages,
  type QueuedComposerMessage
} from './FloatingComposerQueuedMessages'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) => values?.count == null
      ? key
      : `${key}:${values.count}`
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

function deferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}

function setReactActEnvironment(value: boolean): void {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = value
}

describe('FloatingComposerQueuedMessages DSH queue dock interactions', () => {
  let container: HTMLDivElement
  let root: Root
  let props: QueueProps

  const render = async (overrides: Partial<QueueProps> = {}): Promise<void> => {
    props = { ...props, ...overrides }
    await act(async () => {
      root.render(createElement(FloatingComposerQueuedMessages, props))
    })
  }

  const action = (kind: string, row?: Element): HTMLButtonElement => {
    const scope = row ?? container
    const button = scope.querySelector<HTMLButtonElement>(
      `[data-queued-message-action="${kind}"]`
    )
    if (!button) throw new Error(`missing queue action: ${kind}`)
    return button
  }

  const setEditorValue = async (value: string): Promise<HTMLInputElement> => {
    const editor = container.querySelector<HTMLInputElement>('[data-queued-message-editor]')
    if (!editor) throw new Error('missing queued message editor')
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set
    await act(async () => {
      setter?.call(editor, value)
      editor.dispatchEvent(new Event('input', { bubbles: true }))
    })
    return editor
  }

  beforeEach(() => {
    setReactActEnvironment(true)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    props = {
      messages: [],
      running: true,
      onRemove: vi.fn(),
      onGuide: vi.fn(),
      onEdit: vi.fn(() => true)
    }
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    setReactActEnvironment(false)
    vi.restoreAllMocks()
  })

  it('renders nothing for an empty queue and one direct row without a header or portal', async () => {
    await render()
    expect(container.innerHTML).toBe('')

    await render({ messages: [message('q-1', 'first follow-up')] })
    expect(container.querySelector('[data-queue-dock]')).not.toBeNull()
    expect(container.querySelector('[data-queued-message-header]')).toBeNull()
    expect(container.querySelector('[data-queued-message-id="q-1"]')?.textContent)
      .toContain('first follow-up')
    expect(document.body.querySelectorAll('[data-composer-queue]')).toHaveLength(1)
    expect(container.querySelector('[data-composer-queue]')).not.toBeNull()
  })

  it('defaults multiple rows to a collapsed, labelled list and toggles it from the header', async () => {
    await render({
      messages: [message('q-1', 'first'), message('q-2', 'second')]
    })

    const header = container.querySelector<HTMLButtonElement>('[data-queued-message-header]')
    expect(header).not.toBeNull()
    expect(header?.getAttribute('aria-expanded')).toBe('false')
    const listId = header?.getAttribute('aria-controls')
    expect(listId).toBeTruthy()
    expect(document.getElementById(listId!)?.getAttribute('aria-label'))
      .toBe('queuedMessagesTitle:2')
    expect(container.querySelector('[data-queued-message-id="q-1"]')).toBeNull()

    await act(async () => header?.click())
    expect(header?.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelectorAll('[data-queued-message-id]')).toHaveLength(2)

    await act(async () => header?.click())
    expect(header?.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelectorAll('[data-queued-message-id]')).toHaveLength(0)
  })

  it('forces the list open while editing and saves the changed text under the same id', async () => {
    const onEdit = vi.fn(() => true)
    await render({ messages: [message('q-edit', 'before')], onEdit })
    await act(async () => action('edit').click())
    await setEditorValue('after')

    await render({
      messages: [message('q-edit', 'before'), message('q-tail', 'tail')]
    })
    const header = container.querySelector<HTMLButtonElement>('[data-queued-message-header]')
    expect(header?.getAttribute('aria-expanded')).toBe('true')
    expect(header?.disabled).toBe(true)
    expect(container.querySelector<HTMLInputElement>('[data-queued-message-editor]')?.value)
      .toBe('after')

    const editor = container.querySelector<HTMLInputElement>('[data-queued-message-editor]')!
    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await Promise.resolve()
    })
    expect(onEdit).toHaveBeenCalledWith('q-edit', 'after')
  })

  it('cancels with Escape, ignores composing Enter, and disables blank saves', async () => {
    const onEdit = vi.fn(() => true)
    await render({ messages: [message('q-edit', 'before')], onEdit })
    await act(async () => action('edit').click())
    let editor = await setEditorValue('输入中')

    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        isComposing: true
      }))
    })
    expect(onEdit).not.toHaveBeenCalled()
    expect(container.querySelector('[data-queued-message-editor]')).not.toBeNull()

    editor = await setEditorValue('   ')
    expect(action('save').disabled).toBe(true)
    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(container.querySelector('[data-queued-message-editor]')).toBeNull()
    expect(container.textContent).toContain('before')
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('keeps structured rows visible but disables inline editing', async () => {
    await render({
      messages: [message('q-structured', 'inspect the file', {
        attachmentIds: ['attachment-1']
      })]
    })
    const row = container.querySelector('[data-queued-message-id="q-structured"]')!
    expect(row.textContent).toContain('inspect the file')
    expect(action('edit', row).disabled).toBe(true)
    expect(action('guide', row).disabled).toBe(false)
  })

  it('interlocks every row action and forces expansion while one operation is busy', async () => {
    const pending = deferred<void>()
    const onGuide = vi.fn(() => pending.promise)
    await render({ messages: [message('q-1', 'one')], onGuide })
    await act(async () => action('guide').click())

    await render({
      messages: [message('q-1', 'one'), message('q-2', 'two')]
    })
    const header = container.querySelector<HTMLButtonElement>('[data-queued-message-header]')
    expect(header?.getAttribute('aria-expanded')).toBe('true')
    expect(header?.disabled).toBe(true)
    expect([...container.querySelectorAll<HTMLButtonElement>('[data-queued-message-action]')]
      .every((button) => button.disabled)).toBe(true)

    await act(async () => {
      pending.resolve()
      await pending.promise
    })
    expect(header?.disabled).toBe(false)
    expect(header?.getAttribute('aria-expanded')).toBe('false')
  })

  it('shows paused and failed rows with Retry while hiding claimed delivery states', async () => {
    const onGuide = vi.fn()
    await render({
      messages: [
        message('q-paused', 'paused', { deliveryState: 'paused' }),
        message('q-failed', 'failed', { deliveryState: 'failed', errorMessage: 'network' }),
        message('q-admission', 'provisional', {
          deliveryState: 'failed', waitForRuntimeAdmission: true
        }),
        message('q-starting', 'starting', { deliveryState: 'starting' }),
        message('q-flight', 'in flight', { deliveryState: 'in_flight' })
      ],
      running: false,
      onGuide
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-queued-message-header]')?.click()
    })

    expect(container.querySelector('[data-queued-message-id="q-paused"]')).not.toBeNull()
    expect(container.querySelector('[data-queued-message-id="q-failed"]')).not.toBeNull()
    expect(action(
      'guide',
      container.querySelector('[data-queued-message-id="q-admission"]')!
    ).disabled).toBe(true)
    expect(container.querySelector('[data-queued-message-id="q-starting"]')).toBeNull()
    expect(container.querySelector('[data-queued-message-id="q-flight"]')).toBeNull()

    const failed = container.querySelector('[data-queued-message-id="q-failed"]')!
    const retry = action('guide', failed)
    expect(retry.textContent).toBe('')
    expect(retry.getAttribute('aria-label')).toBe('queuedMessageRetry')
    await act(async () => retry.click())
    expect(onGuide).toHaveBeenCalledWith('q-failed')
  })

  it('retires live rows and resets expansion before a later queue arrives', async () => {
    await render({ messages: [message('q-1', 'one'), message('q-2', 'two')] })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-queued-message-header]')?.click()
    })
    expect(container.querySelectorAll('[data-queued-message-id]')).toHaveLength(2)

    await render({ messages: [] })
    expect(container.innerHTML).toBe('')

    await render({ messages: [message('q-3', 'three'), message('q-4', 'four')] })
    const header = container.querySelector<HTMLButtonElement>('[data-queued-message-header]')
    expect(header?.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelectorAll('[data-queued-message-id]')).toHaveLength(0)
  })
})
