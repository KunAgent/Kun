import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import type { WriteResourceConversationHistoryModel } from './useWriteResourceConversationHistory'
import { WriteResourceConversationHistoryPopover } from './WriteResourceConversationHistoryPopover'

function model(
  overrides: Partial<WriteResourceConversationHistoryModel> = {}
): WriteResourceConversationHistoryModel {
  return {
    scopeKey: 'file:/work:/work/draft.md',
    resourceKind: 'file',
    resourceLabel: 'draft.md',
    entries: [
      {
        id: 'thread-current',
        title: 'Budget review',
        updatedAt: '2026-08-29T00:00:00.000Z',
        current: true,
        missing: false,
        archived: false
      },
      {
        id: 'thread-earlier',
        title: 'Launch outline',
        updatedAt: '2026-08-28T00:00:00.000Z',
        current: false,
        missing: false,
        archived: false
      }
    ],
    running: false,
    runtimeReady: true,
    workflowLocked: false,
    loadMissingThreads: vi.fn(async () => undefined),
    canStartConversation: vi.fn(async () => true),
    selectConversation: vi.fn(async () => undefined),
    renameConversation: vi.fn(async () => undefined),
    archiveConversation: vi.fn(async () => undefined),
    ...overrides
  }
}

function renderedText(node: ReactTestInstance): string {
  return node.children.map((child) =>
    typeof child === 'string' ? child : renderedText(child)
  ).join('')
}

function buttonWithText(root: ReactTestInstance, text: string): ReactTestInstance {
  const button = root.findAllByType('button').find((candidate) =>
    renderedText(candidate).includes(text)
  )
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}

async function renderHistory(
  history: WriteResourceConversationHistoryModel
): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(WriteResourceConversationHistoryPopover, {
      model: history,
      lockedExternally: false,
      onNewConversation: vi.fn()
    }))
  })
  return renderer
}

describe('WriteResourceConversationHistoryPopover', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads metadata on open and searches conversation titles locally', async () => {
    const history = model()
    const renderer = await renderHistory(history)

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'File conversations' }).props.onClick()
      await Promise.resolve()
    })

    expect(history.loadMissingThreads).toHaveBeenCalledTimes(1)
    expect(renderer.root.findByProps({ 'data-testid': 'write-resource-conversation-history' }))
      .toBeTruthy()
    const search = renderer.root.findByProps({ placeholder: 'Search conversation titles' })
    await act(async () => search.props.onChange({ target: { value: 'launch' } }))

    const rendered = JSON.stringify(renderer.toJSON())
    expect(rendered).toContain('Launch outline')
    expect(rendered).not.toContain('Budget review')
    await act(async () => renderer.unmount())
  })

  it('keeps browsing available but disables mutations while the resource is running', async () => {
    const history = model({ running: true })
    const renderer = await renderHistory(history)

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'File conversations' }).props.onClick()
    })

    expect(buttonWithText(renderer.root, 'New').props.disabled).toBe(true)
    const earlierTitle = renderer.root.findAllByType('button').find((button) =>
      renderedText(button).includes('Launch outline')
    )
    expect(earlierTitle?.props.disabled).toBe(true)
    expect(JSON.stringify(renderer.toJSON())).toContain(
      'Conversation actions are locked while this resource has a running task.'
    )
    await act(async () => renderer.unmount())
  })

  it('keeps workflow whiteboards renameable while locking new, switch, and archive', async () => {
    const history = model({
      scopeKey: 'whiteboard:/work:board-1',
      resourceKind: 'whiteboard',
      resourceLabel: 'Presentation review',
      workflowLocked: true
    })
    const renderer = await renderHistory(history)

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'Whiteboard conversations' }).props.onClick()
    })
    expect(buttonWithText(renderer.root, 'New').props.disabled).toBe(true)
    await act(async () => {
      renderer.root.findAllByProps({ 'aria-label': 'Conversation actions' })[0]?.props.onClick({
        stopPropagation: () => undefined
      })
    })

    expect(buttonWithText(renderer.root, 'Rename thread').props.disabled).toBe(false)
    expect(buttonWithText(renderer.root, 'Archive thread').props.disabled).toBe(true)
    await act(async () => renderer.unmount())
  })
})
