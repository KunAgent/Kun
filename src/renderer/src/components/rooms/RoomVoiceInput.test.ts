import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RoomVoiceButton } from './RoomVoiceInput'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
type Voice = Parameters<typeof RoomVoiceButton>[0]['voice']
const voice = (enabled: boolean, status = 'idle') =>
  ({ enabled, status, start: vi.fn(), stop: vi.fn() }) as unknown as Voice

describe('room voice button', () => {
  let renderer: ReactTestRenderer
  beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })
  afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.unstubAllGlobals() })

  it('keeps the mic visible and opens setup when speech-to-text is not configured', () => {
    const onSetup = vi.fn()
    act(() => { renderer = create(createElement(RoomVoiceButton, { voice: voice(false), disabled: false, onSetup })) })
    const button = renderer.root.findByType('button')
    expect(button.props['aria-label']).toBe('composerVoiceSetup')
    expect(button.props['data-voice-setup']).toBe(true)
    act(() => button.props.onClick())
    expect(onSetup).toHaveBeenCalledOnce()
  })

  it('hides the mic where no setup is offered and dictates once configured', () => {
    act(() => { renderer = create(createElement(RoomVoiceButton, { voice: voice(false), disabled: false })) })
    expect(renderer.toJSON()).toBeNull()
    const ready = voice(true)
    act(() => renderer.update(createElement(RoomVoiceButton, { voice: ready, disabled: false, onSetup: vi.fn() })))
    const button = renderer.root.findByType('button')
    expect(button.props['aria-label']).toBe('composerVoiceStart')
    act(() => button.props.onClick())
    expect(ready.start).toHaveBeenCalledOnce()
  })
})
