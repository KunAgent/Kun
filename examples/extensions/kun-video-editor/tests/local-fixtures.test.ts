import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { importTranscript } from '../src/engine/index.js'
import {
  FIXTURE_DURATION_SECONDS,
  FIXTURE_SAMPLE_RATE,
  FIXTURE_WAV_SHA256,
  buildFixtureWav,
  validateFixtureWav
} from '../fixtures/generate-local-fixture.mjs'

const asset = {
  id: 'fixture-asset',
  name: 'talking-head.wav',
  kind: 'audio' as const,
  mediaHandleId: 'fixture_media_handle',
  durationUs: FIXTURE_DURATION_SECONDS * 1_000_000,
  container: 'wav',
  audio: { codec: 'pcm_s16le', sampleRate: FIXTURE_SAMPLE_RATE, channels: 1 },
  transcriptIds: []
}

describe('deterministic local fixtures', () => {
  it('generates a byte-stable PCM WAV without FFmpeg, ASR, or network access', () => {
    const first = buildFixtureWav()
    const second = buildFixtureWav()
    expect(first).toEqual(second)
    expect(validateFixtureWav(first)).toEqual({
      byteLength: 32_044,
      sha256: FIXTURE_WAV_SHA256
    })
  })

  it.each(['srt', 'vtt', 'json'] as const)('imports the committed timed %s transcript', async (format) => {
    const source = await readFile(new URL(`../fixtures/talking-head.${format}`, import.meta.url), 'utf8')
    const transcript = importTranscript(source, {
      format,
      transcriptId: `fixture-${format}`,
      asset,
      language: 'en'
    })
    expect(transcript.segments).toHaveLength(3)
    expect(transcript.segments[1]).toMatchObject({
      startUs: 900_000,
      endUs: 1_150_000,
      text: 'um'
    })
    expect(transcript.segments.every((segment) => segment.endUs <= asset.durationUs)).toBe(true)
  })

  it('declares no remote or generative dependency in the example package', async () => {
    const manifest = JSON.parse(await readFile(new URL('../kun-extension.json', import.meta.url), 'utf8'))
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    expect(manifest.permissions.some((permission: string) => permission.startsWith('network:'))).toBe(false)
    const dependencies = Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies })
    expect(dependencies.some((name) => /openai|anthropic|replicate|assemblyai|deepgram|whisper-api/i.test(name)))
      .toBe(false)
  })
})
