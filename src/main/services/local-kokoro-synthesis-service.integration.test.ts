/**
 * End-to-end synthesis against the real Kokoro weights.
 *
 * The weights are a 92 MB download, so this suite only runs when
 * KUN_KOKORO_TEST_ASSETS points at a directory holding `model_quantized.onnx`
 * and `af_heart.bin` (the files the download service would fetch). Everything
 * else about the pipeline - phonemization, tokenization, style selection,
 * inference and PCM encoding - is exercised for real.
 */
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const assetDir = process.env.KUN_KOKORO_TEST_ASSETS
  ? resolve(process.env.KUN_KOKORO_TEST_ASSETS)
  : ''
const MODEL_FILE = 'model_quantized.onnx'
const VOICE_FILE = 'af_heart.bin'
const assetsPresent = Boolean(
  assetDir && existsSync(join(assetDir, MODEL_FILE)) && existsSync(join(assetDir, VOICE_FILE))
)

const userDataDir = { path: '' }

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => userDataDir.path),
    getVersion: vi.fn(() => 'test')
  }
}))

import { decodeKokoroPcm16 } from '../../shared/local-kokoro-speech'
import { LOCAL_KOKORO_SAMPLE_RATE } from '../../shared/local-kokoro'
import { getLocalKokoroReadiness } from './local-kokoro-download-service'
import { localKokoroModelPath, localKokoroVoicePath } from './local-kokoro-assets'
import {
  LOCAL_KOKORO_SESSION_IDLE_RELEASE_MS,
  cancelLocalKokoroSpeech,
  localKokoroSessionState,
  resetLocalKokoroSession,
  shutdownLocalKokoroSynthesis,
  synthesizeLocalKokoroSpeech
} from './local-kokoro-synthesis-service'

describe.skipIf(!assetsPresent)('local Kokoro synthesis (real weights)', () => {
  beforeAll(async () => {
    userDataDir.path = await mkdtemp(join(tmpdir(), 'kun-kokoro-e2e-'))
    const modelTarget = localKokoroModelPath('kokoro-82m-int8')
    await mkdir(dirname(modelTarget), { recursive: true })
    await symlink(join(assetDir, MODEL_FILE), modelTarget)
    const voiceTarget = localKokoroVoicePath('af_heart')
    await mkdir(dirname(voiceTarget), { recursive: true })
    await symlink(join(assetDir, VOICE_FILE), voiceTarget)
    return async () => {
      await shutdownLocalKokoroSynthesis()
    }
  })

  it('sees the linked assets as ready', async () => {
    const readiness = await getLocalKokoroReadiness('kokoro-82m-int8', 'af_heart')

    expect(readiness.ready).toBe(true)
  })

  it('renders speech for a sentence at 24 kHz', async () => {
    const result = await synthesizeLocalKokoroSpeech({
      text: 'Hello, this is a test of the selected voice.',
      requestId: 'itest-1',
      modelId: 'kokoro-82m-int8',
      voiceId: 'af_heart',
      speed: 1
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sampleRate).toBe(LOCAL_KOKORO_SAMPLE_RATE)
    expect(result.durationSeconds).toBeGreaterThan(1)
    expect(result.durationSeconds).toBeLessThan(10)

    const samples = decodeKokoroPcm16(result.pcm16Base64)
    expect(samples).toHaveLength(result.sampleCount)
    const peak = samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0)
    expect(peak).toBeGreaterThan(0.05)
    expect(peak).toBeLessThanOrEqual(1)
  }, 120_000)

  it('keeps the session resident with an idle release armed, and releases on demand', async () => {
    await synthesizeLocalKokoroSpeech({
      text: 'Session residency check.',
      requestId: 'itest-session',
      modelId: 'kokoro-82m-int8',
      voiceId: 'af_heart',
      speed: 1
    })

    const afterRun = localKokoroSessionState()
    // The worker stays alive for the next chunk, but not for the rest of the
    // process lifetime: an idle timer is armed to hand the memory back.
    expect(afterRun.resident).toBe(true)
    expect(afterRun.pendingRuns).toBe(0)
    expect(afterRun.idleReleaseScheduled).toBe(true)
    expect(LOCAL_KOKORO_SESSION_IDLE_RELEASE_MS).toBeGreaterThan(0)

    await resetLocalKokoroSession()

    const afterReset = localKokoroSessionState()
    expect(afterReset.resident).toBe(false)
    expect(afterReset.idleReleaseScheduled).toBe(false)
  }, 120_000)

  it('produces shorter audio at a higher speed', async () => {
    const text = 'The quick brown fox jumps over the lazy dog.'
    const slow = await synthesizeLocalKokoroSpeech({
      text,
      requestId: 'itest-slow',
      modelId: 'kokoro-82m-int8',
      voiceId: 'af_heart',
      speed: 0.8
    })
    const fast = await synthesizeLocalKokoroSpeech({
      text,
      requestId: 'itest-fast',
      modelId: 'kokoro-82m-int8',
      voiceId: 'af_heart',
      speed: 1.5
    })

    expect(slow.ok && fast.ok).toBe(true)
    if (!slow.ok || !fast.ok) return
    expect(fast.durationSeconds).toBeLessThan(slow.durationSeconds)
  }, 180_000)

  it('drops a request that was canceled before synthesis started', async () => {
    cancelLocalKokoroSpeech('itest-canceled')

    const result = await synthesizeLocalKokoroSpeech({
      text: 'This should never be spoken.',
      requestId: 'itest-canceled',
      modelId: 'kokoro-82m-int8',
      voiceId: 'af_heart'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.canceled).toBe(true)
  }, 60_000)

  it('reports a missing voice instead of throwing', async () => {
    const result = await synthesizeLocalKokoroSpeech({
      text: 'Hello.',
      requestId: 'itest-missing-voice',
      modelId: 'kokoro-82m-int8',
      voiceId: 'bm_lewis'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.missing).toBe('voice')
  })

  it('refuses text with nothing speakable in it', async () => {
    const result = await synthesizeLocalKokoroSpeech({
      text: '   ',
      requestId: 'itest-empty',
      modelId: 'kokoro-82m-int8',
      voiceId: 'af_heart'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toBe('nothing to speak')
  })
})
