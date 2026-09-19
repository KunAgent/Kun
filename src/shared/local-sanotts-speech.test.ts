import { describe, expect, it } from 'vitest'
import { SANOTTS_SPEAK_MAX_TEXT_CHARS, decodeSanottsPcm16 } from './local-sanotts-speech'
import { KOKORO_MAX_CHUNK_CHARS } from './kokoro-text'
import { widenSanottsF16 } from './local-sanotts-weights'
import {
  encodeWav,
  isLocalSanottsTrackKey,
  localSanottsTrackKey,
  readWavSampleRate
} from './local-sanotts-tracks'

function encodePcm16(samples: Float32Array): string {
  const pcm = new Int16Array(samples.length)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }
  return Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64')
}

describe('decodeSanottsPcm16', () => {
  it('round-trips samples within 16-bit quantization error', () => {
    const samples = Float32Array.from([0, 0.5, -0.5, 0.999, -0.999, 0.0001])
    const decoded = decodeSanottsPcm16(encodePcm16(samples))
    expect(decoded).toHaveLength(samples.length)
    for (let index = 0; index < samples.length; index += 1) {
      expect(Math.abs(decoded[index] - samples[index])).toBeLessThan(1 / 32_000)
    }
  })

  it('returns no samples for an empty payload', () => {
    expect(decodeSanottsPcm16('')).toHaveLength(0)
  })
})

describe('SANOTTS_SPEAK_MAX_TEXT_CHARS', () => {
  it('leaves headroom above the chunk size the renderer sends', () => {
    expect(SANOTTS_SPEAK_MAX_TEXT_CHARS).toBeGreaterThan(KOKORO_MAX_CHUNK_CHARS)
  })
})

describe('widenSanottsF16', () => {
  it('copies the header and widens half-floats', () => {
    const header = Uint8Array.from([1, 2, 3, 4])
    const halves = new Uint8Array(4)
    new DataView(halves.buffer).setUint16(0, 0x3c00, true)
    new DataView(halves.buffer).setUint16(2, 0xbc00, true)
    const bytes = new Uint8Array(header.length + halves.length)
    bytes.set(header)
    bytes.set(halves, header.length)
    const widened = widenSanottsF16(bytes, { meta_bytes: 4, weight_floats: 2 })
    expect(widened.subarray(0, 4)).toEqual(header)
    const view = new DataView(widened.buffer, 4)
    expect(view.getFloat32(0, true)).toBe(1)
    expect(view.getFloat32(4, true)).toBe(-1)
  })
})

describe('localSanottsTrackKey', () => {
  it('changes when the voice or speed changes', () => {
    const text = 'Hello there'
    const first = localSanottsTrackKey({ text, voiceId: 'amy', speed: 1 })
    expect(isLocalSanottsTrackKey(first)).toBe(true)
    expect(localSanottsTrackKey({ text, voiceId: 'chinese', speed: 1 })).not.toBe(first)
    expect(localSanottsTrackKey({ text, voiceId: 'amy', speed: 1.25 })).not.toBe(first)
  })

  it('records the sample rate used to encode a WAV', () => {
    const wav = encodeWav(new Uint8Array(4), 22_050)
    expect(readWavSampleRate(wav)).toBe(22_050)
  })
})
