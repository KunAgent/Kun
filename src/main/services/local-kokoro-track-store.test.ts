import { mkdtempSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn() },
  dialog: { showSaveDialog: vi.fn() }
}))

import { app, dialog } from 'electron'
import { decodeWavPcm, localKokoroTrackKey } from '../../shared/local-kokoro-tracks'
import {
  appendLocalKokoroTrackChunk,
  beginLocalKokoroTrackCapture,
  clearLocalKokoroTracks,
  discardLocalKokoroTrackCapture,
  exportLocalKokoroTrack,
  finalizeLocalKokoroTrack,
  getLocalKokoroTrack,
  listLocalKokoroTrackKeys,
  localKokoroTrackDirectory,
  localKokoroTrackUsage,
  readLocalKokoroTrackPcm
} from './local-kokoro-track-store'

const KEY = localKokoroTrackKey({
  text: 'The run finished.',
  modelId: 'kokoro-82m-int8',
  voiceId: 'af_heart',
  speed: 1
})

let userData = ''

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'kun-kokoro-tracks-'))
  vi.mocked(app.getPath).mockReturnValue(userData)
  vi.mocked(dialog.showSaveDialog).mockReset()
})

afterEach(async () => {
  await rm(userData, { recursive: true, force: true })
})

function chunk(byteLength: number, fill: number): Uint8Array {
  return new Uint8Array(byteLength).fill(fill)
}

describe('capture and finalize', () => {
  it('writes the captured chunks as one recording, in order', async () => {
    beginLocalKokoroTrackCapture('req-1')
    appendLocalKokoroTrackChunk('req-1', chunk(4, 1))
    appendLocalKokoroTrackChunk('req-1', chunk(6, 2))

    const info = await finalizeLocalKokoroTrack('req-1', KEY)

    expect(info).toMatchObject({ key: KEY })
    const wav = await readFile(join(localKokoroTrackDirectory(), `${KEY}.wav`))
    const pcm = decodeWavPcm(wav)
    expect([...pcm]).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 2, 2])
    expect(info?.sizeBytes).toBe(wav.byteLength)
  })

  it('keeps nothing when the capture was discarded', async () => {
    beginLocalKokoroTrackCapture('req-2')
    appendLocalKokoroTrackChunk('req-2', chunk(4, 3))
    discardLocalKokoroTrackCapture('req-2')

    expect(await finalizeLocalKokoroTrack('req-2', KEY)).toBeNull()
    expect(await listLocalKokoroTrackKeys()).toEqual([])
  })

  it('ignores chunks for a request that was never opened', async () => {
    appendLocalKokoroTrackChunk('req-unknown', chunk(4, 4))

    expect(await finalizeLocalKokoroTrack('req-unknown', KEY)).toBeNull()
  })

  it('refuses a key that is not one this app produced', async () => {
    beginLocalKokoroTrackCapture('req-3')
    appendLocalKokoroTrackChunk('req-3', chunk(4, 5))

    expect(await finalizeLocalKokoroTrack('req-3', '../escape')).toBeNull()
  })

  it('leaves no partial file behind after a successful write', async () => {
    beginLocalKokoroTrackCapture('req-4')
    appendLocalKokoroTrackChunk('req-4', chunk(8, 6))
    await finalizeLocalKokoroTrack('req-4', KEY)

    expect(await listLocalKokoroTrackKeys()).toEqual([KEY])
  })
})

describe('reading stored recordings', () => {
  beforeEach(async () => {
    beginLocalKokoroTrackCapture('req')
    appendLocalKokoroTrackChunk('req', chunk(48_000, 7))
    await finalizeLocalKokoroTrack('req', KEY)
  })

  it('reports size, duration and creation time', async () => {
    const info = await getLocalKokoroTrack(KEY)

    expect(info?.key).toBe(KEY)
    expect(info?.durationSeconds).toBeCloseTo(1, 3)
    expect(Date.parse(info?.createdAt ?? '')).not.toBeNaN()
  })

  it('returns the raw samples without the container', async () => {
    const base64 = await readLocalKokoroTrackPcm(KEY)

    expect(Buffer.from(base64 ?? '', 'base64')).toHaveLength(48_000)
  })

  it('reports nothing for a recording that is not there', async () => {
    const missing = localKokoroTrackKey({
      text: 'Never spoken.',
      modelId: 'kokoro-82m-int8',
      voiceId: 'af_heart',
      speed: 1
    })

    expect(await getLocalKokoroTrack(missing)).toBeNull()
    expect(await readLocalKokoroTrackPcm(missing)).toBeNull()
  })

  it('sums what the store is using and clears it on request', async () => {
    const before = await localKokoroTrackUsage()
    expect(before.count).toBe(1)
    expect(before.totalBytes).toBeGreaterThan(48_000)

    expect(await clearLocalKokoroTracks()).toEqual({ count: 0, totalBytes: 0 })
    expect(await listLocalKokoroTrackKeys()).toEqual([])
  })

  it('ignores files in the directory that are not recordings', async () => {
    await writeFile(join(localKokoroTrackDirectory(), 'notes.txt'), 'ignored')
    await writeFile(join(localKokoroTrackDirectory(), 'bogus.wav'), 'ignored')

    expect(await listLocalKokoroTrackKeys()).toEqual([KEY])
  })
})

describe('exportLocalKokoroTrack', () => {
  beforeEach(async () => {
    beginLocalKokoroTrackCapture('req')
    appendLocalKokoroTrackChunk('req', chunk(16, 8))
    await finalizeLocalKokoroTrack('req', KEY)
  })

  it('writes the recording where the user chose, adding the extension', async () => {
    const target = join(userData, 'answer')
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: target } as never)

    const result = await exportLocalKokoroTrack({ key: KEY })

    expect(result).toEqual({ ok: true, path: `${target}.wav` })
    expect(decodeWavPcm(await readFile(`${target}.wav`))).toHaveLength(16)
  })

  it('reports a cancelled dialog rather than an error', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: '' } as never)

    expect(await exportLocalKokoroTrack({ key: KEY })).toEqual({ ok: false, canceled: true })
  })

  it('does not open a dialog for a recording that is missing', async () => {
    await clearLocalKokoroTracks()

    const result = await exportLocalKokoroTrack({ key: KEY })

    expect(result).toMatchObject({ ok: false })
    expect(dialog.showSaveDialog).not.toHaveBeenCalled()
  })
})
