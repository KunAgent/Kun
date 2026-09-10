import { describe, expect, it } from 'vitest'
import { LOCAL_KOKORO_SAMPLE_RATE } from './local-kokoro'
import {
  decodeWavPcm,
  encodeWav,
  isLocalKokoroTrackKey,
  localKokoroTrackDurationSeconds,
  localKokoroTrackFileName,
  localKokoroTrackKey
} from './local-kokoro-tracks'

const IDENTITY = {
  text: 'The run finished and every suite passed.',
  modelId: 'kokoro-82m-int8',
  voiceId: 'af_heart',
  speed: 1
}

describe('localKokoroTrackKey', () => {
  it('is stable for the same answer and settings', () => {
    expect(localKokoroTrackKey(IDENTITY)).toBe(localKokoroTrackKey({ ...IDENTITY }))
  })

  it('ignores surrounding and repeated whitespace', () => {
    expect(localKokoroTrackKey({ ...IDENTITY, text: `  ${IDENTITY.text}\n\n` }))
      .toBe(localKokoroTrackKey(IDENTITY))
  })

  // Every one of these changes the audio, so none may reuse a stored file.
  it('changes with the text, the model, the voice and the speed', () => {
    const base = localKokoroTrackKey(IDENTITY)

    expect(localKokoroTrackKey({ ...IDENTITY, text: 'Something else entirely.' })).not.toBe(base)
    expect(localKokoroTrackKey({ ...IDENTITY, modelId: 'kokoro-82m-fp16' })).not.toBe(base)
    expect(localKokoroTrackKey({ ...IDENTITY, voiceId: 'am_adam' })).not.toBe(base)
    expect(localKokoroTrackKey({ ...IDENTITY, speed: 1.5 })).not.toBe(base)
  })

  it('treats speeds that round together as one recording', () => {
    expect(localKokoroTrackKey({ ...IDENTITY, speed: 1.234 }))
      .toBe(localKokoroTrackKey({ ...IDENTITY, speed: 1.2349 }))
  })

  it('falls back to the natural rate for an unusable speed', () => {
    expect(localKokoroTrackKey({ ...IDENTITY, speed: Number.NaN }))
      .toBe(localKokoroTrackKey({ ...IDENTITY, speed: 1 }))
  })

  it('produces a key the payload validator accepts', () => {
    expect(isLocalKokoroTrackKey(localKokoroTrackKey(IDENTITY))).toBe(true)
    expect(isLocalKokoroTrackKey('../../etc/passwd')).toBe(false)
    expect(isLocalKokoroTrackKey('')).toBe(false)
    expect(isLocalKokoroTrackKey(undefined)).toBe(false)
  })
})

describe('encodeWav', () => {
  const pcm = new Uint8Array([0, 0, 0x10, 0x20, 0xff, 0x7f])

  it('writes a RIFF/WAVE header describing 24 kHz mono 16-bit audio', () => {
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
    expect(view.getUint32(24, true)).toBe(LOCAL_KOKORO_SAMPLE_RATE)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(pcm.byteLength)
    expect(view.getUint32(4, true)).toBe(36 + pcm.byteLength)
  })

  it('round-trips the samples byte for byte', () => {
    expect([...decodeWavPcm(encodeWav(pcm))]).toEqual([...pcm])
  })

  it('reports no samples for a file too short to hold a header', () => {
    expect(decodeWavPcm(new Uint8Array(10))).toHaveLength(0)
  })
})

describe('localKokoroTrackDurationSeconds', () => {
  it('discounts the header when reading a duration off a file size', () => {
    const seconds = 2
    const wav = encodeWav(new Uint8Array(LOCAL_KOKORO_SAMPLE_RATE * 2 * seconds))

    expect(localKokoroTrackDurationSeconds(wav.byteLength)).toBeCloseTo(seconds, 5)
  })

  it('never reports negative audio', () => {
    expect(localKokoroTrackDurationSeconds(0)).toBe(0)
  })
})

describe('localKokoroTrackFileName', () => {
  it('names the download after the answer timestamp', () => {
    expect(localKokoroTrackFileName('2026-06-07T08:09:10.500Z'))
      .toBe('Kun-speech-2026-06-07T08-09-10-500Z.wav')
  })

  it('falls back to now when the timestamp is unusable', () => {
    expect(localKokoroTrackFileName('not a date')).toMatch(/^Kun-speech-.+\.wav$/)
  })
})
