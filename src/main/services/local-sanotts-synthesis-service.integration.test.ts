/**
 * End-to-end synthesis against cached sanoTTS runtime + amy weights.
 *
 * Skipped unless KUN_SANOTTS_TEST_ASSETS points at a directory holding
 * `runtime/{snt_g2p.js,snt_g2p.wasm,snt_g2p.data,snt_voice.js,snt_voice.wasm}`
 * and `voices/amy/{meta.json,front_f32.bin,dec_f32.bin}`.
 */
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { LOCAL_SANOTTS_RUNTIME_FILES, LOCAL_SANOTTS_SAMPLE_RATE } from '../../shared/local-sanotts'
import { decodeSanottsPcm16 } from '../../shared/local-sanotts-speech'

const assetDir = process.env.KUN_SANOTTS_TEST_ASSETS
  ? resolve(process.env.KUN_SANOTTS_TEST_ASSETS)
  : ''
const AMY_FILES = ['meta.json', 'front_f32.bin', 'dec_f32.bin']
const assetsPresent = Boolean(
  assetDir
    && LOCAL_SANOTTS_RUNTIME_FILES.every((file) => existsSync(join(assetDir, 'runtime', file.fileName)))
    && AMY_FILES.every((fileName) => existsSync(join(assetDir, 'voices', 'amy', fileName)))
)

const userDataDir = { path: '' }

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => userDataDir.path),
    getVersion: vi.fn(() => 'test')
  }
}))

import { getLocalSanottsReadiness } from './local-sanotts-download-service'
import { localSanottsRuntimeDir, localSanottsVoiceDir } from './local-sanotts-assets'
import {
  LOCAL_SANOTTS_SESSION_IDLE_RELEASE_MS,
  cancelLocalSanottsSpeech,
  localSanottsSessionState,
  resetLocalSanottsSession,
  shutdownLocalSanottsSynthesis,
  synthesizeLocalSanottsSpeech
} from './local-sanotts-synthesis-service'

describe.skipIf(!assetsPresent)('local sanoTTS synthesis (real weights)', () => {
  beforeAll(async () => {
    userDataDir.path = await mkdtemp(join(tmpdir(), 'kun-sanotts-e2e-'))
    const runtimeTarget = localSanottsRuntimeDir()
    await mkdir(runtimeTarget, { recursive: true })
    for (const file of LOCAL_SANOTTS_RUNTIME_FILES) {
      await symlink(join(assetDir, 'runtime', file.fileName), join(runtimeTarget, file.fileName))
    }
    const voiceTarget = localSanottsVoiceDir('amy')
    await mkdir(voiceTarget, { recursive: true })
    for (const fileName of AMY_FILES) {
      await symlink(join(assetDir, 'voices', 'amy', fileName), join(voiceTarget, fileName))
    }
    return async () => {
      await shutdownLocalSanottsSynthesis()
    }
  })

  it('sees the linked assets as ready', async () => {
    const readiness = await getLocalSanottsReadiness('amy')
    expect(readiness.ready).toBe(true)
  })

  it('renders speech for a sentence at 22.05 kHz', async () => {
    const result = await synthesizeLocalSanottsSpeech({
      text: 'Hello, this is a test of the selected voice.',
      requestId: 'itest-1',
      voiceId: 'amy',
      speed: 1
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sampleRate).toBe(LOCAL_SANOTTS_SAMPLE_RATE)
    expect(result.durationSeconds).toBeGreaterThan(0.4)
    expect(result.durationSeconds).toBeLessThan(20)

    const samples = decodeSanottsPcm16(result.pcm16Base64)
    expect(samples).toHaveLength(result.sampleCount)
    const peak = samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0)
    expect(peak).toBeGreaterThan(0.05)
    expect(peak).toBeLessThanOrEqual(1)
  }, 120_000)

  it('keeps the session resident with an idle release armed, and releases on demand', async () => {
    await synthesizeLocalSanottsSpeech({
      text: 'Session residency check.',
      requestId: 'itest-session',
      voiceId: 'amy',
      speed: 1
    })

    const afterRun = localSanottsSessionState()
    expect(afterRun.resident).toBe(true)
    expect(afterRun.pendingRuns).toBe(0)
    expect(afterRun.idleReleaseScheduled).toBe(true)
    expect(LOCAL_SANOTTS_SESSION_IDLE_RELEASE_MS).toBeGreaterThan(0)

    await resetLocalSanottsSession()

    const afterReset = localSanottsSessionState()
    expect(afterReset.resident).toBe(false)
    expect(afterReset.idleReleaseScheduled).toBe(false)
  }, 120_000)

  it('produces shorter audio at a higher speed', async () => {
    const text = 'The quick brown fox jumps over the lazy dog.'
    const slow = await synthesizeLocalSanottsSpeech({
      text,
      requestId: 'itest-slow',
      voiceId: 'amy',
      speed: 0.8
    })
    const fast = await synthesizeLocalSanottsSpeech({
      text,
      requestId: 'itest-fast',
      voiceId: 'amy',
      speed: 1.5
    })

    expect(slow.ok && fast.ok).toBe(true)
    if (!slow.ok || !fast.ok) return
    expect(fast.durationSeconds).toBeLessThan(slow.durationSeconds)
  }, 180_000)

  it('drops a request that was canceled before synthesis started', async () => {
    cancelLocalSanottsSpeech('itest-canceled')

    const result = await synthesizeLocalSanottsSpeech({
      text: 'This should never be spoken.',
      requestId: 'itest-canceled',
      voiceId: 'amy'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.canceled).toBe(true)
  }, 60_000)

  it('reports a missing voice instead of throwing', async () => {
    const result = await synthesizeLocalSanottsSpeech({
      text: 'Hello.',
      requestId: 'itest-missing-voice',
      voiceId: 'hindi'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.missing).toBe('voice')
  })

  it('refuses text with nothing speakable in it', async () => {
    const result = await synthesizeLocalSanottsSpeech({
      text: '   ',
      requestId: 'itest-empty',
      voiceId: 'amy'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toBe('nothing to speak')
  })
})
