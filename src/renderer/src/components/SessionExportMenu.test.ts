import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create as createRenderer, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import type { ChatBlock } from '../agent/types'
import { SessionExportMenu } from './SessionExportMenu'

const blocks: ChatBlock[] = [
  { kind: 'user', id: 'user-1', turnId: 'turn-1', text: 'Question' },
  { kind: 'assistant', id: 'assistant-1', turnId: 'turn-1', text: 'Answer' }
]

describe('SessionExportMenu', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders an accessible no-drag title action and disables empty exports', () => {
    const available = renderToStaticMarkup(createElement(SessionExportMenu, {
      title: 'Thread',
      blocks,
      busy: false
    }))
    const empty = renderToStaticMarkup(createElement(SessionExportMenu, {
      title: 'Empty',
      blocks: [],
      busy: false
    }))

    expect(available).toContain('ds-no-drag')
    expect(available).toContain('aria-label="Export conversation"')
    expect(available).toContain('aria-haspopup="menu"')
    expect(available).not.toContain('disabled=""')
    expect(empty).toContain('There is no completed conversation to export')
  })

  it('opens both format choices and exports canonical Markdown', async () => {
    const listeners = new Map<string, EventListener>()
    const exportConversation = vi.fn().mockResolvedValue({
      ok: true,
      path: '/downloads/Thread.md',
      format: 'md',
      exportedAt: '2026-07-19T02:00:00.000Z'
    })
    vi.stubGlobal('document', {
      addEventListener: vi.fn((type: string, listener: EventListener) => listeners.set(type, listener)),
      removeEventListener: vi.fn((type: string) => listeners.delete(type))
    })
    vi.stubGlobal('window', { kunGui: { exportConversation } })

    let renderer: ReactTestRenderer
    act(() => {
      renderer = createRenderer(createElement(SessionExportMenu, {
        title: 'Thread',
        blocks,
        busy: false
      }))
    })
    const trigger = renderer!.root.find((node) => node.type === 'button' && node.props['aria-haspopup'] === 'menu')
    act(() => trigger.props.onClick())

    const items = renderer!.root.findAll((node) => node.type === 'button' && node.props.role === 'menuitem')
    expect(items).toHaveLength(3)
    expect(JSON.stringify(renderer!.toJSON())).toContain('Markdown (.md)')
    expect(JSON.stringify(renderer!.toJSON())).toContain('PDF (.pdf)')
    expect(JSON.stringify(renderer!.toJSON())).toContain('Export multiple conversations')

    act(() => items[0].props.onClick())
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(exportConversation).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Thread',
      format: 'md',
      markdown: expect.stringContaining('## You')
    }))
    expect(renderer!.root.findAll((node) => node.props.role === 'menu')).toHaveLength(0)
    expect(renderer!.root.find((node) => node.type === 'button' && node.props['aria-haspopup'] === 'menu').props['aria-label'])
      .toBe('Conversation exported')
    act(() => renderer!.unmount())
  })

  it('shows the active-turn exclusion hint while busy', () => {
    vi.stubGlobal('document', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
    let renderer: ReactTestRenderer
    act(() => {
      renderer = createRenderer(createElement(SessionExportMenu, {
        title: 'Busy thread',
        blocks: [
          ...blocks,
          { kind: 'user', id: 'user-2', turnId: 'turn-2', text: 'Current question' }
        ],
        busy: true,
        currentTurnId: 'turn-2',
        currentTurnUserId: 'user-2'
      }))
    })
    const trigger = renderer!.root.find((node) => node.type === 'button' && node.props['aria-haspopup'] === 'menu')
    act(() => trigger.props.onClick())
    expect(JSON.stringify(renderer!.toJSON())).toContain('current in-progress turn will not be included')
    act(() => renderer!.unmount())
  })
})
