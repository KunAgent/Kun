import { describe, expect, it } from 'vitest'
import { localKokoroTrackKey } from '@shared/local-kokoro-tracks'
import { speakTrackStored } from '../../stores/speak-track-store'
import { speakTrackKeyFor } from './speak-controller'

const SETTINGS = {
  enabled: true,
  keepTracks: true,
  model: 'kokoro-82m-int8' as const,
  voice: 'af_heart' as const,
  speed: 1,
  downloadSource: 'huggingface' as const,
  autoDownload: true
}

const ANSWER = [
  '## Remaining limitations',
  '',
  'The run finished and every suite passed.',
  '',
  '```sh',
  'npm test',
  '```'
].join('\n')

describe('speakTrackKeyFor', () => {
  // The key is built from the spoken text, so markdown that never reaches the
  // model - a fenced code block, a heading marker - cannot invalidate a
  // recording that would sound identical.
  it('ignores markdown that is not spoken', () => {
    const withCode = speakTrackKeyFor(ANSWER, SETTINGS)
    const withoutCode = speakTrackKeyFor(
      '## Remaining limitations\n\nThe run finished and every suite passed.\n',
      SETTINGS
    )

    expect(withCode).toBe(withoutCode)
  })

  it('matches the shared key for the text that will be spoken', () => {
    expect(speakTrackKeyFor('One sentence.', SETTINGS)).toBe(
      localKokoroTrackKey({
        text: 'One sentence.',
        modelId: SETTINGS.model,
        voiceId: SETTINGS.voice,
        speed: SETTINGS.speed
      })
    )
  })

  it('changes when the voice settings change', () => {
    expect(speakTrackKeyFor(ANSWER, { ...SETTINGS, voice: 'bm_george' }))
      .not.toBe(speakTrackKeyFor(ANSWER, SETTINGS))
    expect(speakTrackKeyFor(ANSWER, { ...SETTINGS, speed: 1.25 }))
      .not.toBe(speakTrackKeyFor(ANSWER, SETTINGS))
  })
})

describe('speakTrackStored', () => {
  it('is false until the stored keys have been read', () => {
    expect(speakTrackStored(null, 'abc')).toBe(false)
  })

  it('is true only for a key the store knows about', () => {
    const keys = new Set(['kept'])

    expect(speakTrackStored(keys, 'kept')).toBe(true)
    expect(speakTrackStored(keys, 'other')).toBe(false)
    expect(speakTrackStored(keys, null)).toBe(false)
  })
})
