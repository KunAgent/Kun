// @vitest-environment jsdom
import { ComposerContextAttachmentSchema } from '@kun/extension-api'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COMPOSER_FOCUS_REQUEST_EVENT } from '../components/chat/floating-composer-commands'
import { resolveComposerTrayPlaceholder } from '../components/chat/composer-tray/composer-tray-placeholder'
import { useChatStore } from '../store/chat-store'
import {
  createTrayReferenceAttachment,
  toggleTrayReference,
  trayReferenceFromComposerContext
} from './tray-reference-attachment'

describe('tray-reference-attachment', () => {
  beforeEach(() => {
    useChatStore.setState({
      route: 'chat',
      activeThreadId: 'thr_1',
      workspaceRoot: '/workspace/kun',
      threads: [{ id: 'thr_1', workspace: '/workspace/kun' }] as never,
      extensionComposerContexts: []
    })
  })

  afterEach(() => {
    useChatStore.setState({ extensionComposerContexts: [] })
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('round-trips worker and todo references while keeping path-like text schema-safe', async () => {
    const workerAttachment = await createTrayReferenceAttachment({
      workspaceRoot: '/workspace/kun',
      threadId: 'thr_1',
      draft: {
        targetKind: 'worker',
        targetId: 'w_research',
        title: 'Data analyst',
        statusLabel: 'Needs you',
        tone: 'waiting',
        seat: 2,
        color: '#0f766e',
        note: '/Users/demo/report.md needs confirmation'
      }
    })
    expect(() => ComposerContextAttachmentSchema.parse(workerAttachment)).not.toThrow()
    expect(trayReferenceFromComposerContext(workerAttachment)).toEqual({
      targetKind: 'worker',
      targetId: 'w_research',
      badge: '@',
      title: 'Data analyst',
      statusLabel: 'Needs you',
      tone: 'waiting',
      note: '/Users/demo/report.md needs confirmation',
      seat: 2,
      color: '#0f766e'
    })

    const todoAttachment = await createTrayReferenceAttachment({
      workspaceRoot: '/workspace/kun',
      threadId: 'thr_1',
      draft: {
        targetKind: 'todo',
        targetId: 'todo_2',
        stepIndex: 2,
        totalSteps: 4,
        title: '/api/v1/sessions endpoint check',
        statusLabel: 'In progress',
        tone: 'running',
        note: 'file:///tmp/trace.log inspected',
        ownerLabel: 'Unit tester',
        sourceLabel: 'plans/session-ui.md'
      }
    })
    expect(() => ComposerContextAttachmentSchema.parse(todoAttachment)).not.toThrow()
    expect(trayReferenceFromComposerContext(todoAttachment)).toEqual({
      targetKind: 'todo',
      targetId: 'todo_2',
      badge: '#2',
      title: '/api/v1/sessions endpoint check',
      statusLabel: 'In progress',
      tone: 'running',
      note: 'file:///tmp/trace.log inspected',
      stepIndex: 2,
      totalSteps: 4,
      ownerLabel: 'Unit tester',
      sourceLabel: 'plans/session-ui.md'
    })
  })

  it('attaches multiple references, focuses the composer, and toggles off on repeat click', async () => {
    let focusRequests = 0
    const onFocus = (): void => { focusRequests += 1 }
    window.addEventListener(COMPOSER_FOCUS_REQUEST_EVENT, onFocus)

    expect(await toggleTrayReference({
      targetKind: 'todo',
      targetId: 'todo_1',
      stepIndex: 1,
      totalSteps: 3,
      title: 'Inspect tray layout',
      statusLabel: 'In progress',
      tone: 'running'
    })).toBe('attached')

    expect(await toggleTrayReference({
      targetKind: 'worker',
      targetId: 'w_1',
      title: 'Code reviewer',
      statusLabel: 'Done',
      tone: 'done',
      seat: 0,
      color: '#4561e0'
    })).toBe('attached')

    expect(useChatStore.getState().extensionComposerContexts).toHaveLength(2)
    expect(focusRequests).toBe(2)

    expect(await toggleTrayReference({
      targetKind: 'todo',
      targetId: 'todo_1',
      stepIndex: 1,
      totalSteps: 3,
      title: 'Inspect tray layout',
      statusLabel: 'In progress',
      tone: 'running'
    })).toBe('removed')

    expect(useChatStore.getState().extensionComposerContexts).toHaveLength(1)
    window.removeEventListener(COMPOSER_FOCUS_REQUEST_EVENT, onFocus)
  })

  it('resolves context-aware composer placeholders for open sheets and attached references', () => {
    const t = (key: string): string => `i18n:${key}`
    const base = {
      canEditComposer: true,
      busy: false,
      runtimeReady: true,
      goalInputMode: false,
      goalPanelOpen: false,
      route: 'chat',
      hasTrayReference: false,
      openTrayKind: null,
      t
    }

    expect(resolveComposerTrayPlaceholder(base)).toBeNull()
    expect(resolveComposerTrayPlaceholder({ ...base, openTrayKind: 'workers' }))
      .toBe('i18n:composerTray.sheetPlaceholder.workers')
    expect(resolveComposerTrayPlaceholder({ ...base, openTrayKind: 'todo' }))
      .toBe('i18n:composerTray.sheetPlaceholder.todo')
    expect(resolveComposerTrayPlaceholder({ ...base, openTrayKind: 'todo', hasTrayReference: true }))
      .toBe('i18n:composerTray.referencePlaceholder')
    expect(resolveComposerTrayPlaceholder({ ...base, busy: true, hasTrayReference: true }))
      .toBeNull()
    expect(resolveComposerTrayPlaceholder({ ...base, route: 'claw', openTrayKind: 'workers' }))
      .toBeNull()
  })
})
