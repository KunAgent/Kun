/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import { useChatStore } from '../../store/chat-store'
import i18n from '../../i18n'
import { FloatingComposer } from './FloatingComposer'
import { ScheduledSendDialog } from './ScheduledSendDialog'

const MODEL_GROUPS: ModelProviderModelGroup[] = [{
  providerId: 'provider-a',
  accountId: 'account-a',
  label: 'Provider A',
  modelIds: ['model-a']
}]

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function setReactActEnvironment(value: boolean): void {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = value
}

async function changeControlValue(
  control: HTMLInputElement | HTMLSelectElement,
  value: string
): Promise<void> {
  const prototype = control instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(control, value)
  await act(async () => {
    control.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function composerProps(overrides: Record<string, unknown> = {}) {
  return {
    input: 'Follow up using the current context',
    setInput: vi.fn(),
    mode: 'agent' as const,
    setMode: vi.fn(),
    busy: false,
    runtimeReady: true,
    hasActiveThread: true,
    workspaceRootOverride: '/workspace/project',
    composerModel: 'model-a',
    composerProviderId: 'provider-a',
    composerModelGroups: MODEL_GROUPS,
    composerPickList: ['model-a'],
    composerReasoningEffort: 'high',
    onComposerModelChange: vi.fn(),
    queuedMessages: [] as [],
    onRemoveQueuedMessage: vi.fn(),
    onSend: vi.fn(),
    onInterrupt: vi.fn(),
    attachmentUploadEnabled: true,
    attachments: [{ id: 'attachment-a', kind: 'document' as const, name: 'notes.txt' }],
    onRemoveAttachment: vi.fn(),
    ...overrides
  }
}

describe('FloatingComposer scheduled send', () => {
  let container: HTMLDivElement
  let root: Root
  let createScheduleTask: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setReactActEnvironment(true)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-05-10T08:00:00.000Z'))
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    createScheduleTask = vi.fn()
    Object.defineProperty(window, 'kunGui', {
      configurable: true,
      value: {
        createScheduleTask,
        getSettings: vi.fn().mockRejectedValue(new Error('settings not needed by this test')),
        runtimeRequest: vi.fn().mockResolvedValue({ ok: true, status: 200, body: '{"sessions":[],"running":0}' })
      }
    })
    useChatStore.setState({
      activeThreadId: 'thread-a',
      activeThreadGoal: null,
      activeThreadTodos: null,
      blocks: [],
      route: 'chat',
      workspaceRoot: '/workspace/project',
      threads: [{
        id: 'thread-a',
        title: 'Existing Thread',
        updatedAt: '2030-05-10T07:00:00.000Z',
        model: 'model-a',
        mode: 'agent',
        workspace: '/workspace/project'
      }]
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    Reflect.deleteProperty(window, 'kunGui')
    vi.useRealTimers()
    setReactActEnvironment(false)
  })

  it('opens the dialog and freezes the current Thread selection in a future task payload', async () => {
    createScheduleTask.mockResolvedValue({ ok: true, task: { id: 'scheduled-a' } })
    const props = composerProps()
    await act(async () => root.render(createElement(FloatingComposer, props)))

    const trigger = container.querySelector<HTMLButtonElement>('.ds-composer-scheduled-send-action')
    expect(trigger).not.toBeNull()
    expect(trigger?.getAttribute('aria-label')).toBeTruthy()

    await act(async () => trigger?.click())
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    expect(container.querySelector('[data-scheduled-send-date]')).not.toBeNull()
    expect(container.querySelector('[data-scheduled-send-time]')).not.toBeNull()

    const confirm = container.querySelector<HTMLButtonElement>('[data-scheduled-send-confirm]')
    expect(confirm?.disabled).toBe(false)
    await act(async () => confirm?.click())

    expect(createScheduleTask).toHaveBeenCalledOnce()
    const payload = createScheduleTask.mock.calls[0]?.[0]
    expect(new Date(payload.schedule.atTime).getTime()).toBeGreaterThan(Date.now())
    expect(payload).toMatchObject({
      prompt: 'Follow up using the current context',
      workspaceRoot: '/workspace/project',
      sourceThreadId: 'thread-a',
      providerId: 'provider-a',
      accountId: 'account-a',
      model: 'model-a',
      reasoningEffort: 'high',
      attachmentIds: ['attachment-a'],
      schedule: { kind: 'at' }
    })
    expect(props.onSend).not.toHaveBeenCalled()
    expect(props.setInput).toHaveBeenCalledWith('')
    expect(props.onRemoveAttachment).toHaveBeenCalledWith('attachment-a')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('uses the shared localized DST error instead of exposing the converter message', async () => {
    await act(async () => root.render(createElement(ScheduledSendDialog, {
      submitting: false,
      error: '',
      onClose: vi.fn(),
      onSubmit: vi.fn()
    })))
    await changeControlValue(
      container.querySelector<HTMLInputElement>('[data-scheduled-send-date]')!,
      '2030-03-10'
    )
    await changeControlValue(
      container.querySelector<HTMLInputElement>('[data-scheduled-send-time]')!,
      '02:30'
    )
    await changeControlValue(
      container.querySelector<HTMLSelectElement>('[data-scheduled-send-time-zone]')!,
      'America/New_York'
    )

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      i18n.t('planScheduleBuildErrorNonexistentTime', { ns: 'common' })
    )
    expect(container.querySelector<HTMLButtonElement>('[data-scheduled-send-confirm]')?.disabled).toBe(true)
  })

  it('keeps the draft and attachments visible when task creation fails', async () => {
    createScheduleTask.mockResolvedValue({ ok: false, message: 'schedule store unavailable' })
    const props = composerProps()
    await act(async () => root.render(createElement(FloatingComposer, props)))
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.ds-composer-scheduled-send-action')?.click()
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-scheduled-send-confirm]')?.click()
    })

    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('schedule store unavailable')
    expect(container.querySelector('textarea')?.value).toBe('Follow up using the current context')
    expect(container.textContent).toContain('notes.txt')
    expect(props.setInput).not.toHaveBeenCalled()
    expect(props.onRemoveAttachment).not.toHaveBeenCalled()
    expect(props.onSend).not.toHaveBeenCalled()
  })

  it('traps focus, closes on Escape, and returns focus to the opener', async () => {
    const props = composerProps()
    await act(async () => root.render(createElement(FloatingComposer, props)))
    const trigger = container.querySelector<HTMLButtonElement>('.ds-composer-scheduled-send-action')!
    trigger.focus()
    await act(async () => trigger.click())

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    const date = container.querySelector<HTMLInputElement>('[data-scheduled-send-date]')!
    const close = dialog.querySelector<HTMLButtonElement>('button[aria-label]')!
    const confirm = dialog.querySelector<HTMLButtonElement>('[data-scheduled-send-confirm]')!
    expect(document.activeElement).toBe(date)

    close.focus()
    await act(async () => {
      close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
    })
    expect(document.activeElement).toBe(confirm)
    await act(async () => {
      confirm.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(document.activeElement).toBe(close)

    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('locks dismissal while submitting and does not clear a newer draft or Thread', async () => {
    const pending = deferred<{ ok: true; task: { id: string } }>()
    createScheduleTask.mockReturnValue(pending.promise)
    const original = composerProps()
    await act(async () => root.render(createElement(FloatingComposer, original)))
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.ds-composer-scheduled-send-action')?.click()
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-scheduled-send-confirm]')?.click()
    })

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.getAttribute('aria-busy')).toBe('true')
    expect(Array.from(dialog.querySelectorAll('button, input, select')).every((control) => (
      (control as HTMLButtonElement | HTMLInputElement | HTMLSelectElement).disabled
    ))).toBe(true)
    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()

    useChatStore.setState({
      activeThreadId: 'thread-b',
      threads: [{
        id: 'thread-b',
        title: 'New Thread',
        updatedAt: '2030-05-10T07:30:00.000Z',
        model: 'model-b',
        mode: 'agent',
        workspace: '/workspace/other'
      }]
    })
    const newer = composerProps({
      input: 'A newer draft',
      workspaceRootOverride: '/workspace/other',
      composerModel: 'model-b',
      composerProviderId: 'provider-b',
      composerModelGroups: [{
        providerId: 'provider-b',
        accountId: 'account-b',
        label: 'Provider B',
        modelIds: ['model-b']
      }],
      attachments: [{ id: 'attachment-b', kind: 'document' as const, name: 'new.txt' }]
    })
    await act(async () => root.render(createElement(FloatingComposer, newer)))
    await act(async () => pending.resolve({ ok: true, task: { id: 'scheduled-a' } }))

    expect(createScheduleTask).toHaveBeenCalledWith(expect.objectContaining({
      sourceThreadId: 'thread-a',
      prompt: 'Follow up using the current context',
      workspaceRoot: '/workspace/project',
      providerId: 'provider-a',
      accountId: 'account-a',
      model: 'model-a',
      attachmentIds: ['attachment-a']
    }))
    expect(original.setInput).not.toHaveBeenCalled()
    expect(original.onRemoveAttachment).not.toHaveBeenCalled()
    expect(newer.setInput).not.toHaveBeenCalled()
    expect(newer.onRemoveAttachment).not.toHaveBeenCalled()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})
