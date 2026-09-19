import { mkdtempSync } from 'node:fs'
import { mkdir, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn() },
  dialog: { showSaveDialog: vi.fn() }
}))

import { app, dialog } from 'electron'
import { decodeWavPcm, localSanottsTrackKey } from '../../shared/local-sanotts-tracks'
import {
  appendLocalSanottsTrackChunk,
  localSanottsCaptureUsage,
  LOCAL_SANOTTS_TRACK_MAX_BYTES,
  LOCAL_SANOTTS_TRACK_STORE_MAX_BYTES,
  beginLocalSanottsTrackCapture,
  clearLocalSanottsTracks,
  discardLocalSanottsTrackCapture,
  exportLocalSanottsTrack,
  finalizeLocalSanottsTrack,
  getLocalSanottsTrack,
  listLocalSanottsTrackKeys,
  localSanottsTrackDirectory,
  localSanottsTrackUsage,
  readLocalSanottsTrackPcm
} from './local-sanotts-track-store'

const KEY = localSanottsTrackKey({
  text: 'The run finished.',
  voiceId: 'amy',
  speed: 1
})

let userData = ''

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'kun-sanotts-tracks-'))
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
    beginLocalSanottsTrackCapture('req-1')
    appendLocalSanottsTrackChunk('req-1', chunk(4, 1))
    appendLocalSanottsTrackChunk('req-1', chunk(6, 2))

    const info = await finalizeLocalSanottsTrack('req-1', KEY)

    expect(info).toMatchObject({ key: KEY })
    const wav = await readFile(join(localSanottsTrackDirectory(), `${KEY}.wav`))
    const pcm = decodeWavPcm(wav)
    expect([...pcm]).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 2, 2])
    expect(info?.sizeBytes).toBe(wav.byteLength)
  })

  it('keeps nothing when the capture was discarded', async () => {
    beginLocalSanottsTrackCapture('req-2')
    appendLocalSanottsTrackChunk('req-2', chunk(4, 3))
    discardLocalSanottsTrackCapture('req-2')

    expect(await finalizeLocalSanottsTrack('req-2', KEY)).toBeNull()
    expect(await listLocalSanottsTrackKeys()).toEqual([])
  })

  it('ignores chunks for a request that was never opened', async () => {
    appendLocalSanottsTrackChunk('req-unknown', chunk(4, 4))

    expect(await finalizeLocalSanottsTrack('req-unknown', KEY)).toBeNull()
  })

  it('refuses a key that is not one this app produced', async () => {
    beginLocalSanottsTrackCapture('req-3')
    appendLocalSanottsTrackChunk('req-3', chunk(4, 5))

    expect(await finalizeLocalSanottsTrack('req-3', '../escape')).toBeNull()
  })

  it('leaves no partial file behind after a successful write', async () => {
    beginLocalSanottsTrackCapture('req-4')
    appendLocalSanottsTrackChunk('req-4', chunk(8, 6))
    await finalizeLocalSanottsTrack('req-4', KEY)

    expect(await listLocalSanottsTrackKeys()).toEqual([KEY])
  })
})

describe('reading stored recordings', () => {
  beforeEach(async () => {
    beginLocalSanottsTrackCapture('req')
    appendLocalSanottsTrackChunk('req', chunk(44_100, 7))
    await finalizeLocalSanottsTrack('req', KEY)
  })

  it('reports size, duration and creation time', async () => {
    const info = await getLocalSanottsTrack(KEY)

    expect(info?.key).toBe(KEY)
    expect(info?.durationSeconds).toBeCloseTo(1, 3)
    expect(Date.parse(info?.createdAt ?? '')).not.toBeNaN()
  })

  it('returns the raw samples without the container', async () => {
    const base64 = await readLocalSanottsTrackPcm(KEY)

    expect(Buffer.from(base64 ?? '', 'base64')).toHaveLength(44_100)
  })

  it('reports nothing for a recording that is not there', async () => {
    const missing = localSanottsTrackKey({
      text: 'Never spoken.',
      voiceId: 'amy',
      speed: 1
    })

    expect(await getLocalSanottsTrack(missing)).toBeNull()
    expect(await readLocalSanottsTrackPcm(missing)).toBeNull()
  })

  it('sums what the store is using and clears it on request', async () => {
    const before = await localSanottsTrackUsage()
    expect(before.count).toBe(1)
    expect(before.totalBytes).toBeGreaterThan(44_100)

    expect(await clearLocalSanottsTracks()).toEqual({ count: 0, totalBytes: 0 })
    expect(await listLocalSanottsTrackKeys()).toEqual([])
  })

  it('ignores files in the directory that are not recordings', async () => {
    await writeFile(join(localSanottsTrackDirectory(), 'notes.txt'), 'ignored')
    await writeFile(join(localSanottsTrackDirectory(), 'bogus.wav'), 'ignored')

    expect(await listLocalSanottsTrackKeys()).toEqual([KEY])
  })
})

describe('exportLocalSanottsTrack', () => {
  beforeEach(async () => {
    beginLocalSanottsTrackCapture('req')
    appendLocalSanottsTrackChunk('req', chunk(16, 8))
    await finalizeLocalSanottsTrack('req', KEY)
  })

  it('writes the recording where the user chose, adding the extension', async () => {
    const target = join(userData, 'answer')
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: target } as never)

    const result = await exportLocalSanottsTrack({ key: KEY })

    expect(result).toEqual({ ok: true, path: `${target}.wav` })
    expect(decodeWavPcm(await readFile(`${target}.wav`))).toHaveLength(16)
  })

  it('reports a cancelled dialog rather than an error', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: '' } as never)

    expect(await exportLocalSanottsTrack({ key: KEY })).toEqual({ ok: false, canceled: true })
  })

  it('does not open a dialog for a recording that is missing', async () => {
    await clearLocalSanottsTracks()

    const result = await exportLocalSanottsTrack({ key: KEY })

    expect(result).toMatchObject({ ok: false })
    expect(dialog.showSaveDialog).not.toHaveBeenCalled()
  })
})

it('releases capture memory immediately on overflow and does not keep a truncated recording', async () => {
  beginLocalSanottsTrackCapture('overflow')
  appendLocalSanottsTrackChunk('overflow', chunk(4, 1))
  appendLocalSanottsTrackChunk('overflow', { byteLength: LOCAL_SANOTTS_TRACK_MAX_BYTES } as Uint8Array)
  expect(localSanottsCaptureUsage().bytes).toBe(0)
  appendLocalSanottsTrackChunk('overflow', chunk(4, 2))
  expect(await finalizeLocalSanottsTrack('overflow', KEY)).toBeNull()
})

it('clears in-flight captures as well as disk recordings', async () => {
  beginLocalSanottsTrackCapture('clear-inflight')
  appendLocalSanottsTrackChunk('clear-inflight', chunk(4, 1))
  await clearLocalSanottsTracks()
  appendLocalSanottsTrackChunk('clear-inflight', chunk(4, 2))
  expect(await finalizeLocalSanottsTrack('clear-inflight', KEY)).toBeNull()
  expect(localSanottsCaptureUsage()).toEqual({ count: 0, bytes: 0 })
  expect(await listLocalSanottsTrackKeys()).toEqual([])
})

it('does not publish a recording whose finalize raced with clear', async () => {
  beginLocalSanottsTrackCapture('race-clear')
  appendLocalSanottsTrackChunk('race-clear', chunk(4, 1))
  const writing = finalizeLocalSanottsTrack('race-clear', KEY)
  const clearing = clearLocalSanottsTracks()
  expect(await writing).toBeNull()
  await clearing
  expect(await listLocalSanottsTrackKeys()).toEqual([])
})

it('preserves existing recordings and declines new captures at the total store limit', async () => {
  const dir = localSanottsTrackDirectory()
  await mkdir(dir, { recursive: true })
  const existingKey = localSanottsTrackKey({ text: 'Existing', voiceId: 'amy', speed: 1 })
  const existingPath = join(dir, `${existingKey}.wav`)
  await writeFile(existingPath, new Uint8Array(44))
  await truncate(existingPath, LOCAL_SANOTTS_TRACK_STORE_MAX_BYTES)
  beginLocalSanottsTrackCapture('at-capacity')
  appendLocalSanottsTrackChunk('at-capacity', chunk(4, 1))
  expect(await finalizeLocalSanottsTrack('at-capacity', KEY)).toBeNull()
  expect(await listLocalSanottsTrackKeys()).toEqual([existingKey])
})
