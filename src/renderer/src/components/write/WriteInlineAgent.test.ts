import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WriteInlineAgent } from './WriteInlineAgent'

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string): string => key
  })
}))

describe('WriteInlineAgent', () => {
  const action = {
    left: 200,
    width: 280,
    anchorLeft: 300,
    anchorRight: 500,
    coordinateScale: 1,
    anchorTop: 220,
    anchorBottom: 260
  }

  beforeEach(() => {
    vi.stubGlobal('window', {
      innerWidth: 1200,
      innerHeight: 900,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the selection instruction field and routes Enter to review and Mod-Enter to chat', async () => {
    const edit = vi.fn(), chat = vi.fn()
    vi.stubGlobal('navigator', { platform: 'MacIntel' })
    let renderer: ReactTestRenderer
    await act(async () => { renderer = create(createElement(WriteInlineAgent, {
      action, editEnabled: true, onAskEdit: edit, onAskChat: chat
    })) })
    const input = () => renderer!.root.findByType('input')
    await act(async () => { input().props.onChange({ target: { value: 'Make it clearer' } }) })
    const key = (metaKey = false, isComposing = false) => ({ key: 'Enter', metaKey, ctrlKey: false,
      nativeEvent: { isComposing }, preventDefault: vi.fn(), stopPropagation: vi.fn() })
    await act(async () => { input().props.onKeyDown(key(false, true)) })
    expect(edit).not.toHaveBeenCalled()
    await act(async () => { input().props.onKeyDown(key()) })
    expect(edit).toHaveBeenCalledWith('Make it clearer')
    await act(async () => { input().props.onChange({ target: { value: 'Explain' } }) })
    await act(async () => { input().props.onKeyDown(key(true)) })
    expect(chat).toHaveBeenCalledWith('Explain')
    await act(async () => renderer!.unmount())
  })

  it('keeps quote and configured selection actions available', async () => {
    const onQuoteSelection = vi.fn()
    const onQuickAction = vi.fn()
    const quickAction = {
      id: 'polish',
      label: 'Polish',
      prompt: 'Polish the selection',
      mode: 'edit' as const
    }
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(WriteInlineAgent, {
        action,
        onQuoteSelection,
        quickActions: [quickAction],
        onQuickAction
      }))
    })

    renderer!.root.findByProps({ 'aria-label': 'writeSelectionQuote' }).props.onClick({ nativeEvent: {} })
    renderer!.root.findByProps({ 'aria-label': quickAction.label }).props.onClick({ nativeEvent: {} })

    expect(onQuoteSelection).toHaveBeenCalledOnce()
    expect(onQuickAction).toHaveBeenCalledWith(quickAction)
  })
})
