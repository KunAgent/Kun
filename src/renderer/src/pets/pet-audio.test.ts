import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { updatePetTyping } from '@shared/pets-typing'
import { PetAudioEngine } from './pet-audio'

type PlayedBuffer = {
  frames: number
  sampleRate: number
  gain: number
  playbackRate: number
  pan: number | null
}

function installFakeAudioContext() {
  const played: PlayedBuffer[] = []
  const purrStarts: Array<{ loop: boolean; rate: number }> = []
  const purrGains: number[] = []
  const oscStarts: number[] = []

  class FakeAudioContext {
    state: AudioContextState = 'running'
    sampleRate = 44100
    currentTime = 1.0
    destination = {}
    onstatechange: (() => void) | null = null

    resume = vi.fn(async () => {
      this.state = 'running'
    })
    close = vi.fn(async () => {
      this.state = 'closed'
    })

    createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
      const chData = Array.from({ length: channels }, () => new Float32Array(length))
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: (c: number) => chData[c]
      } as unknown as AudioBuffer
    }

    createBufferSource(): AudioBufferSourceNode {
      let connectedGain: { gain: { value: number }; pan: number | null } | null = null
      let connectedFilter = false
      const node = {
        buffer: null as AudioBuffer | null,
        loop: false,
        playbackRate: { value: 1, setTargetAtTime: vi.fn() },
        onended: null as (() => void) | null,
        connect: (dest: unknown) => {
          const d = dest as { __kind?: string; gain?: { value: number }; pan?: number | null }
          if (d.__kind === 'gain') connectedGain = d as { gain: { value: number }; pan: number | null }
          if (d.__kind === 'filter') connectedFilter = true
          return dest
        },
        disconnect: vi.fn(),
        start: vi.fn(() => {
          if (connectedFilter || node.loop) {
            purrStarts.push({ loop: node.loop, rate: node.playbackRate.value })
          } else if (node.buffer && connectedGain) {
            played.push({
              frames: node.buffer.length,
              sampleRate: node.buffer.sampleRate,
              gain: connectedGain.gain.value,
              playbackRate: node.playbackRate.value,
              pan: connectedGain.pan
            })
          }
        }),
        stop: vi.fn()
      }
      return node as unknown as AudioBufferSourceNode
    }

    createGain(): GainNode {
      const node = {
        __kind: 'gain',
        pan: null as number | null,
        gain: {
          value: 1,
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
          setTargetAtTime: vi.fn((target: number) => {
            purrGains.push(target)
          })
        },
        connect: (dest: unknown) => {
          const d = dest as { __kind?: string; pan?: { value: number } }
          if (d.__kind === 'panner' && d.pan) node.pan = d.pan.value
          return dest
        },
        disconnect: vi.fn()
      }
      return node as unknown as GainNode
    }

    createStereoPanner(): StereoPannerNode {
      return {
        __kind: 'panner',
        pan: { value: 0 },
        connect: (dest: unknown) => dest,
        disconnect: vi.fn()
      } as unknown as StereoPannerNode
    }

    createBiquadFilter(): BiquadFilterNode {
      return {
        __kind: 'filter',
        type: 'lowpass',
        frequency: { value: 3200, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn() },
        Q: { value: 0.7 },
        connect: (dest: unknown) => dest,
        disconnect: vi.fn()
      } as unknown as BiquadFilterNode
    }

    createOscillator(): OscillatorNode {
      return {
        type: 'sine',
        frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        onended: null,
        connect: (dest: unknown) => dest,
        disconnect: vi.fn(),
        start: vi.fn((when: number) => { oscStarts.push(when) }),
        stop: vi.fn()
      } as unknown as OscillatorNode
    }
  }

  vi.stubGlobal('AudioContext', FakeAudioContext)
  return { played, purrStarts, purrGains, oscStarts }
}

describe('pet audio engine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('decodes lossless WAV slots synchronously and plays key-down, spacebar, and key-up with stereo pan', () => {
    const { played } = installFakeAudioContext()
    const engine = new PetAudioEngine()

    // Initial mount hydration does not fire a sound
    engine.noteTyping(undefined)
    expect(played).toHaveLength(0)

    // Left-hand key down (col 0) -> negative pan, key-down sample (~36-47ms = 1600..2100 frames)
    let typing = updatePetTyping(undefined, 1, 1, 1000, { col: 0, row: 1 })
    engine.noteTyping(typing)
    expect(played).toHaveLength(1)
    expect(played[0].sampleRate).toBe(44100)
    expect(played[0].frames).toBeGreaterThan(1500)
    expect(played[0].pan).toBeLessThan(-0.2)

    // Key release -> shorter key-up sample (~23-26ms = 1000..1200 frames)
    typing = updatePetTyping(typing, 0, 0, 1060, { col: 0, row: 1 })
    engine.noteTyping(typing)
    expect(played).toHaveLength(2)
    expect(played[1].frames).toBeLessThan(1300)

    // Spacebar chord (tap === 3) -> longer thocky space sample (>2200 frames)
    typing = updatePetTyping(typing, 3, 3, 1120, { col: 2, row: 2 })
    engine.noteTyping(typing)
    expect(played).toHaveLength(3)
    expect(played[2].frames).toBeGreaterThan(2200)
  })

  it('plays mouse micro-switch down and up on desk clicks while ignoring clicks over the mascot', () => {
    const { played } = installFakeAudioContext()
    const engine = new PetAudioEngine()

    const baseSample = {
      nx: 0.5, ny: 0.5, gx: -0.4, gy: 0.2, buttons: 0,
      wheelSeq: 0, wheelDir: 0 as const, clickSeq: 0, clickMask: 0,
      deskActiveAt: 1000, active: true, overMascot: false
    }
    engine.noteCursor(baseSample)
    expect(played).toHaveLength(0)

    // Left click press & release on external app
    engine.noteCursor({ ...baseSample, buttons: 1, clickSeq: 1, clickMask: 1, clickedAt: Date.now() })
    expect(played).toHaveLength(1)
    expect(played[0].pan).toBeCloseTo(-0.22)

    engine.noteCursor({ ...baseSample, buttons: 0, clickSeq: 1, clickMask: 1 })
    expect(played).toHaveLength(2)

    // Click over mascot itself does not fire desk mouse click audio
    engine.noteCursor({ ...baseSample, buttons: 1, clickSeq: 2, clickMask: 1, overMascot: true })
    expect(played).toHaveLength(2)
  })

  it('drives seamless cat purring during head-pats and mutes cleanly when disabled', () => {
    const { played, purrStarts, purrGains, oscStarts } = installFakeAudioContext()
    const engine = new PetAudioEngine()

    engine.playPatBoop()
    expect(oscStarts).toHaveLength(1)

    engine.setPurrIntensity(0.85, true)
    expect(purrStarts).toHaveLength(1)
    expect(purrStarts[0].loop).toBe(true)
    expect(purrGains.at(-1)).toBeGreaterThan(0.3)

    // Disabling sound stops purr and suppresses subsequent typing/clicks
    engine.setSoundEnabled(false)
    expect(purrGains.at(-1)).toBeLessThan(0.001)

    const typing = updatePetTyping(undefined, 1, 1, 2000, { col: 3, row: 1 })
    engine.noteTyping(typing)
    expect(played).toHaveLength(0)

    engine.dispose()
  })
})
