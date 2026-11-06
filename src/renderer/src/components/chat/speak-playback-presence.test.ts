import { afterEach, describe, expect, it, vi } from 'vitest'
import { SpeakPlayer } from './speak-playback'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('speech playback pet feedback', () => {
  it('uses output amplitude and clears speaking on buffer drain and stop', () => {
    vi.useFakeTimers()
    const send = vi.fn(), sources: Array<{ onended: (() => void) | null }> = []
    let amplitude = 32
    class Context {
      state = 'running'; currentTime = 0; destination = {}
      createGain() { return { gain: { value: 0 }, connect: vi.fn() } }
      createAnalyser() { return { fftSize: 256, getByteTimeDomainData: (data: Uint8Array) => data.fill(128 + amplitude) } }
      createBuffer(_channels: number, length: number, rate: number) { return { duration: length / rate, getChannelData: () => new Float32Array(length) } }
      createBufferSource() {
        const source = { onended: null as (() => void) | null, buffer: null, start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }
        sources.push(source); return source
      }
      resume() { return Promise.resolve() }
      close() { return Promise.resolve() }
    }
    vi.stubGlobal('window', { AudioContext: Context, kunGui: { pets: { updatePetPresence: send } } })
    const player = new SpeakPlayer(16000)
    player.enqueue(new Float32Array(16000))
    expect(send.mock.lastCall?.[0]).toMatchObject({ kind: 'speaking', level: .75 })
    amplitude = 0
    vi.advanceTimersByTime(125)
    expect(send.mock.lastCall?.[0]).toMatchObject({ kind: 'speaking', level: 0 })
    sources[0].onended?.()
    expect(send.mock.lastCall?.[0].kind).toBe('idle')
    expect(vi.getTimerCount()).toBe(0)
    player.enqueue(new Float32Array(16000))
    player.stop()
    expect(send.mock.lastCall?.[0].kind).toBe('idle')
    expect(vi.getTimerCount()).toBe(0)
  })
})
