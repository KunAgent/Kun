import { existsSync, statSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))

vi.mock('node:child_process', () => ({ spawn: spawnMock }))
vi.mock('../../../kun/src/process/owned-process', () => ({
  spawnOwnedProcess: async (...args: unknown[]) => spawnMock(...args),
  stopOwnedProcess: async (child: { kill(signal: string): void }) => { child.kill('SIGKILL') }
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(),
    getVersion: vi.fn(() => 'test')
  }
}))

import { app } from 'electron'
import { LOCAL_WHISPER_MODELS, LOCAL_WHISPER_SMALL_MODEL_ID, localWhisperModelById } from '../../shared/local-whisper'
import {
  _internals,
  getLocalWhisperModelStatus,
  shutdownLocalWhisperService
} from './local-whisper-service'

describe('local-whisper-service helpers', () => {
  let rootDir = ''

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'kun-local-whisper-'))
    vi.mocked(app.getPath).mockReturnValue(rootDir)
    _internals.setLocalWhisperDownloadStateForTest(null)
    _internals.resetShutdownForTest()
    spawnMock.mockReset()
  })

  it('keeps checksum metadata for every downloadable model', () => {
    for (const model of LOCAL_WHISPER_MODELS) {
      expect(model.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(new URL(model.downloadUrl).origin).toBe('https://huggingface.co')
      expect(model.downloadMirrors.some((mirror) => (
        new URL(mirror.downloadUrl).origin === 'https://hf-mirror.com'
      ))).toBe(true)
      expect(model.downloadMirrors.some((mirror) => (
        new URL(mirror.downloadUrl).origin === 'https://hf-cdn.sufy.com'
      ))).toBe(true)
    }
  })

  it('resolves the selected model download source', () => {
    const model = localWhisperModelById(LOCAL_WHISPER_SMALL_MODEL_ID)

    expect(_internals.localWhisperDownloadUrl(model, 'huggingface')).toBe(model.downloadUrl)
    expect(new URL(_internals.localWhisperDownloadUrl(model, 'hf-mirror')).origin)
      .toBe('https://hf-mirror.com')
    expect(new URL(_internals.localWhisperDownloadUrl(model, 'hf-sufy')).origin)
      .toBe('https://hf-cdn.sufy.com')
  })

  it('bundles Whisper runners for supported desktop platforms', () => {
    const runners = [
      ['darwin-arm64', 'whisper-cli'],
      ['win32-x64', 'whisper-cli.exe'],
      ['linux-x64', 'whisper-cli'],
      ['linux-arm64', 'whisper-cli']
    ] as const

    for (const [platformDir, executable] of runners) {
      const runnerDir = join(process.cwd(), 'resources', 'whisper', platformDir)
      const runnerPath = join(runnerDir, executable)
      expect(existsSync(join(runnerDir, 'runner.json'))).toBe(true)
      expect(existsSync(runnerPath)).toBe(true)
      expect(statSync(runnerPath).size).toBeGreaterThan(64 * 1024)
    }
  })

  it('computes sha256 checksums for downloaded files', async () => {
    const path = join(rootDir, 'sample.bin')
    await writeFile(path, 'abc', 'utf8')

    await expect(_internals.fileSha256(path)).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })

  it('reports ready when the model file exists even if the last progress is complete', async () => {
    const model = localWhisperModelById(LOCAL_WHISPER_SMALL_MODEL_ID)
    const path = _internals.localWhisperModelPath(model.id)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, 'ready', 'utf8')
    _internals.setLocalWhisperDownloadStateForTest({
      modelId: model.id,
      downloadedBytes: model.sizeBytes,
      totalBytes: model.sizeBytes,
      speedBytesPerSecond: 1024
    })

    const status = await getLocalWhisperModelStatus(model.id)

    expect(status.state).toBe('ready')
    expect(status.path).toBe(path)
  })

  it('kills and awaits an active Whisper runner during shutdown', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      kill: ReturnType<typeof vi.fn>
    }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = vi.fn((signal: string) => {
      queueMicrotask(() => { child.emit('exit', null, signal); child.emit('close', null, signal) })
      return true
    })
    spawnMock.mockReturnValue(child)

    const run = _internals.runWhisper('whisper-cli', [], 60_000)
    const rejected = expect(run).rejects.toThrow('local Whisper exited with code null')
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1))

    await shutdownLocalWhisperService()

    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    await rejected
  })
})
