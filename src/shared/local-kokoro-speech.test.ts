import { describe, expect, it } from 'vitest'
import { KOKORO_SPEAK_MAX_TEXT_CHARS, decodeKokoroPcm16 } from './local-kokoro-speech'
import { KOKORO_MAX_CHUNK_CHARS } from './kokoro-text'

/** Mirrors the main-process encoder so the round trip is checked end to end. */
function encodePcm16(samples: Float32Array): string {
  const pcm = new Int16Array(samples.length)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }
  return Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64')
}

describe('decodeKokoroPcm16', () => {
  it('round-trips samples within 16-bit quantization error', () => {
    const samples = Float32Array.from([0, 0.5, -0.5, 0.999, -0.999, 0.0001])

    const decoded = decodeKokoroPcm16(encodePcm16(samples))

    expect(decoded).toHaveLength(samples.length)
    for (let index = 0; index < samples.length; index += 1) {
      expect(Math.abs(decoded[index] - samples[index])).toBeLessThan(1 / 32_000)
    }
  })

  it('clamps out-of-range samples to full scale', () => {
    const decoded = decodeKokoroPcm16(encodePcm16(Float32Array.from([4, -4])))

    expect(decoded[0]).toBeCloseTo(1, 4)
    expect(decoded[1]).toBeCloseTo(-1, 4)
  })

  it('returns no samples for an empty payload', () => {
    expect(decodeKokoroPcm16('')).toHaveLength(0)
  })
})

describe('KOKORO_SPEAK_MAX_TEXT_CHARS', () => {
  it('leaves headroom above the chunk size the renderer sends', () => {
    expect(KOKORO_SPEAK_MAX_TEXT_CHARS).toBeGreaterThan(KOKORO_MAX_CHUNK_CHARS)
  })
})
