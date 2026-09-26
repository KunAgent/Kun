import { describe, expect, it } from 'vitest'
import { LOCAL_SANOTTS_SAMPLE_RATE } from './local-sanotts'
import {
  decodeWavPcm,
  encodeWav,
  isLocalSanottsTrackKey,
  localSanottsTrackDurationSeconds,
  localSanottsTrackFileName,
  localSanottsTrackKey,
  readWavSampleRate
} from './local-sanotts-tracks'

const IDENTITY = {
  text: 'The run finished and every suite passed.',
  voiceId: 'amy',
  speed: 1
}

describe('localSanottsTrackKey', () => {
  it('is stable for the same answer and settings', () => {
    expect(localSanottsTrackKey(IDENTITY)).toBe(localSanottsTrackKey({ ...IDENTITY }))
  })

  it('ignores surrounding and repeated whitespace', () => {
    expect(localSanottsTrackKey({ ...IDENTITY, text: `  ${IDENTITY.text}\n\n` }))
      .toBe(localSanottsTrackKey(IDENTITY))
  })

  it('changes with the text, the voice and the speed', () => {
    const base = localSanottsTrackKey(IDENTITY)

    expect(localSanottsTrackKey({ ...IDENTITY, text: 'Something else entirely.' })).not.toBe(base)
    expect(localSanottsTrackKey({ ...IDENTITY, voiceId: 'chinese' })).not.toBe(base)
    expect(localSanottsTrackKey({ ...IDENTITY, speed: 1.5 })).not.toBe(base)
  })

  it('treats speeds that round together as one recording', () => {
    expect(localSanottsTrackKey({ ...IDENTITY, speed: 1.234 }))
      .toBe(localSanottsTrackKey({ ...IDENTITY, speed: 1.2349 }))
  })

  it('falls back to the natural rate for an unusable speed', () => {
    expect(localSanottsTrackKey({ ...IDENTITY, speed: Number.NaN }))
      .toBe(localSanottsTrackKey({ ...IDENTITY, speed: 1 }))
  })

  it('produces a key the payload validator accepts', () => {
    expect(isLocalSanottsTrackKey(localSanottsTrackKey(IDENTITY))).toBe(true)
    expect(isLocalSanottsTrackKey('../../etc/passwd')).toBe(false)
    expect(isLocalSanottsTrackKey('')).toBe(false)
    expect(isLocalSanottsTrackKey(undefined)).toBe(false)
  })
})

describe('encodeWav', () => {
  const pcm = new Uint8Array([0, 0, 0x10, 0x20, 0xff, 0x7f])

  it('writes a RIFF/WAVE header describing 22.05 kHz mono 16-bit audio', () => {
    const wav = encodeWav(pcm)
    const view = new DataView(wav.buffer)
    const ascii = (offset: number, length: number): string =>
      String.fromCharCode(...wav.subarray(offset, offset + length))

    expect(ascii(0, 4)).toBe('RIFF')
    expect(ascii(8, 4)).toBe('WAVE')
    expect(ascii(12, 4)).toBe('fmt ')
    expect(ascii(36, 4)).toBe('data')
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(LOCAL_SANOTTS_SAMPLE_RATE)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(pcm.byteLength)
    expect(view.getUint32(4, true)).toBe(36 + pcm.byteLength)
    expect(readWavSampleRate(wav)).toBe(LOCAL_SANOTTS_SAMPLE_RATE)
  })

  it('round-trips the samples byte for byte', () => {
    expect([...decodeWavPcm(encodeWav(pcm))]).toEqual([...pcm])
  })

  it('reports no samples for a file too short to hold a header', () => {
    expect(decodeWavPcm(new Uint8Array(10))).toHaveLength(0)
  })
})

describe('localSanottsTrackDurationSeconds', () => {
  it('discounts the header when reading a duration off a file size', () => {
    const seconds = 2
    const wav = encodeWav(new Uint8Array(LOCAL_SANOTTS_SAMPLE_RATE * 2 * seconds))

    expect(localSanottsTrackDurationSeconds(wav.byteLength)).toBeCloseTo(seconds, 5)
  })

  it('never reports negative audio', () => {
    expect(localSanottsTrackDurationSeconds(0)).toBe(0)
  })
})

describe('localSanottsTrackFileName', () => {
  it('names the download after the answer timestamp', () => {
    expect(localSanottsTrackFileName('2026-06-07T08:09:10.500Z'))
      .toBe('Kun-speech-2026-06-07T08-09-10-500Z.wav')
  })

  it('falls back to now when the timestamp is unusable', () => {
    expect(localSanottsTrackFileName('not a date')).toMatch(/^Kun-speech-.+\.wav$/)
  })
})
