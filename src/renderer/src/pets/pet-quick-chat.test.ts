import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PetOverlayBridge } from '@shared/pets'
import { PetQuickChat } from './pet-quick-chat'

const capture = vi.hoisted(() => ({
  onText: (_text: string): void => undefined,
  voice: { status: 'idle', error: null, cancel: vi.fn(), clearError: vi.fn(), toggle: vi.fn() }
}))
vi.mock('../components/chat/use-voice-capture', () => ({
  useVoiceCapture: (options: { onText: (text: string) => void }) => {
    capture.onText = options.onText
    return capture.voice
  }
}))

let renderer: ReactTestRenderer | undefined
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('navigator', { language: 'zh-CN' })
  vi.stubGlobal('window', { setInterval, clearInterval })
  capture.voice.status = 'idle'
  vi.clearAllMocks()
})
afterEach(() => {
  if (renderer) act(() => renderer!.unmount())
  renderer = undefined
  vi.unstubAllGlobals()
})

async function mount(available = false, revealed = true) {
  const startChat = vi.fn(async (_prompt: string) => ({ ok: true as boolean, message: '' }))
  const toggle = vi.fn()
  const bridge = {
    startChat, getVoiceInputAvailable: async () => available,
    onMainWindowFocused: () => () => undefined, transcribeSpeech: vi.fn()
  } as unknown as PetOverlayBridge
  const props = {
    bridge, notificationCount: 2, bubblesHidden: true,
    revealed, onToggleBubbles: toggle, onInteractiveChange: vi.fn()
  }
  await act(async () => { renderer = create(createElement(PetQuickChat, props)) })
  return { startChat, toggle, reveal: (value: boolean) => renderer!.update(createElement(PetQuickChat, { ...props, revealed: value })) }
}
const button = (label: string) => renderer!.root.findAllByType('button').find((node) => node.props['aria-label'] === label)!
const input = () => renderer!.root.findByType('input')

describe('pet toolbar and quick composer', () => {
  it('collapses to the handle off-hover but keeps the composer visible while editing', async () => {
    const { reveal } = await mount(false, false)
    const toolbar = () => renderer!.root.findByProps({ role: 'toolbar' })
    expect(toolbar().props['aria-hidden']).toBe(true)
    expect(toolbar().props.inert).toBe(true)
    act(() => reveal(true))
    expect(toolbar().props['aria-hidden']).toBe(false)
    act(() => button('直接对话').props.onClick())
    act(() => input().props.onChange({ target: { value: 'Keep editing' } }))
    act(() => reveal(false))
    expect(renderer!.root.findAllByProps({ role: 'toolbar' })).toHaveLength(0)
    expect(input().props.value).toBe('Keep editing')
    act(() => button('收起输入框').props.onClick())
    expect(toolbar().props['aria-hidden']).toBe(true)
  })
  it('shows new chat and the notification bell, hiding voice when unavailable', async () => {
    const { toggle } = await mount()
    expect(button('直接对话')).toBeDefined()
    expect(button('语音输入')).toBeUndefined()
    expect(button('展开通知 (2)')).toBeDefined()
    act(() => button('展开通知 (2)').props.onClick())
    expect(toggle).toHaveBeenCalledOnce()
  })

  it('offers configured voice input and inserts the transcript for review before sending', async () => {
    const { startChat } = await mount(true)
    act(() => button('语音输入').props.onClick())
    expect(capture.voice.toggle).toHaveBeenCalledOnce()
    act(() => capture.onText('Voice draft'))
    expect(input().props.value).toBe('Voice draft')
    expect(startChat).not.toHaveBeenCalled()
    await act(async () => renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }))
    expect(startChat).toHaveBeenCalledExactlyOnceWith('Voice draft')
    expect(renderer!.root.findAllByType('input')).toHaveLength(0)
  })

  it('preserves failed drafts and prevents duplicate sends while waiting for acceptance', async () => {
    const { startChat } = await mount()
    let finish!: (value: { ok: boolean; message: string }) => void
    startChat.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    act(() => button('直接对话').props.onClick())
    act(() => input().props.onChange({ target: { value: 'Keep this draft' } }))
    await act(async () => {
      const form = renderer!.root.findByType('form')
      form.props.onSubmit({ preventDefault: vi.fn() })
      form.props.onSubmit({ preventDefault: vi.fn() })
    })
    expect(startChat).toHaveBeenCalledOnce()
    await act(async () => finish({ ok: false, message: 'Offline' }))
    expect(input().props.value).toBe('Keep this draft')
    expect(renderer!.root.findByProps({ role: 'alert' }).children).toContain('Offline')
    act(() => button('收起输入框').props.onClick())
    expect(capture.voice.cancel).toHaveBeenCalled()
  })
})
