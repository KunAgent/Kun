import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePetVoicePresence } from './use-pet-voice-presence'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('microphone pet presence', () => {
  it('waits for recording, follows measured speech, settles into silence and stops on cancellation', async () => {
    vi.useFakeTimers(); vi.setSystemTime(10000)
    const send = vi.fn(), level = vi.fn(() => 0)
    vi.stubGlobal('window', { kunPetOverlay: { updatePetPresence: send } })
    function Voice({ status }: { status: string }) { usePetVoicePresence(status, level); return null }
    let view!: ReturnType<typeof create>
    await act(async () => { view = create(createElement(Voice, { status: 'starting' })) })
    expect(send).not.toHaveBeenCalled()
    await act(async () => view.update(createElement(Voice, { status: 'recording' })))
    expect(send.mock.lastCall?.[0]).toMatchObject({ kind: 'listening', level: 0 })
    level.mockReturnValue(.7)
    await act(async () => { vi.advanceTimersByTime(125) })
    expect(send.mock.lastCall?.[0].level).toBe(.7)
    level.mockReturnValue(0)
    await act(async () => { vi.advanceTimersByTime(125) })
    expect(send.mock.lastCall?.[0].level).toBe(.12)
    await act(async () => { vi.advanceTimersByTime(400) })
    expect(send.mock.lastCall?.[0].level).toBe(0)
    await act(async () => view.update(createElement(Voice, { status: 'transcribing' })))
    expect(send.mock.lastCall?.[0].kind).toBe('transcribing')
    await act(async () => view.update(createElement(Voice, { status: 'idle' })))
    expect(send.mock.lastCall?.[0].kind).toBe('idle')
    expect(vi.getTimerCount()).toBe(0)
    await act(async () => view.unmount())
  })
})
