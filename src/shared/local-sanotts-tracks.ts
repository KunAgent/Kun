/**
 * Stored Speak recordings.
 *
 * When the user asks Kun to keep generated tracks, the audio for an answer is
 * written once and replayed from disk afterwards.
 */
import { LOCAL_SANOTTS_SAMPLE_RATE } from './local-sanotts'

export const LOCAL_SANOTTS_TRACK_EXTENSION = 'wav'

/** Bytes per stored sample: 16-bit mono. */
const BYTES_PER_SAMPLE = 2
const WAV_HEADER_BYTES = 44

export type LocalSanottsTrackIdentity = {
  text: string
  voiceId: string
  speed: number
}

export type LocalSanottsTrackInfo = {
  key: string
  sizeBytes: number
  durationSeconds: number
  createdAt: string
}

export type LocalSanottsTrackUsage = {
  count: number
  totalBytes: number
}

export type LocalSanottsTrackExportResult =
  | { ok: true; path: string }
  | { ok: false; canceled?: boolean; message?: string }

/**
 * Identity of a recording.
 *
 * Anything that changes the audio has to change the key, so the voice and the
 * speed are folded in alongside the text.
 */
export function localSanottsTrackKey(identity: LocalSanottsTrackIdentity): string {
  const speed = Number.isFinite(identity.speed) ? Math.round(identity.speed * 100) / 100 : 1
  const canonical = [
    'sanotts',
    identity.voiceId,
    speed.toFixed(2),
    identity.text.trim().replace(/\s+/g, ' ')
  ].join(' ')
  return `${fnv1a64(canonical)}-${canonical.length.toString(36)}`
}

function fnv1a64(value: string): string {
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash ^ BigInt(value.charCodeAt(index))) * prime) & mask
  }
  return hash.toString(16).padStart(16, '0')
}

export function isLocalSanottsTrackKey(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{16}-[0-9a-z]{1,12}$/.test(value)
}

export function localSanottsTrackDurationSeconds(
  sizeBytes: number,
  sampleRate = LOCAL_SANOTTS_SAMPLE_RATE
): number {
  const audioBytes = Math.max(0, sizeBytes - WAV_HEADER_BYTES)
  return audioBytes / BYTES_PER_SAMPLE / sampleRate
}

export function localSanottsTrackFileName(createdAt?: string): string {
  const parsed = createdAt ? new Date(createdAt) : new Date()
  const stamp = (Number.isNaN(parsed.getTime()) ? new Date() : parsed)
    .toISOString()
    .replace(/[:.]/g, '-')
  return `Kun-speech-${stamp}.${LOCAL_SANOTTS_TRACK_EXTENSION}`
}

export function encodeWav(pcm: Uint8Array, sampleRate = LOCAL_SANOTTS_SAMPLE_RATE): Uint8Array {
  const out = new Uint8Array(WAV_HEADER_BYTES + pcm.byteLength)
  const view = new DataView(out.buffer)
  const writeAscii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      out[offset + index] = text.charCodeAt(index)
    }
  }
  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + pcm.byteLength, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * BYTES_PER_SAMPLE, true)
  view.setUint16(32, BYTES_PER_SAMPLE, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, pcm.byteLength, true)
  out.set(pcm, WAV_HEADER_BYTES)
  return out
}

export function decodeWavPcm(wav: Uint8Array): Uint8Array {
  if (wav.byteLength <= WAV_HEADER_BYTES) return new Uint8Array(0)
  return wav.subarray(WAV_HEADER_BYTES)
}

export function readWavSampleRate(wav: Uint8Array): number {
  if (wav.byteLength < 28) return LOCAL_SANOTTS_SAMPLE_RATE
  return new DataView(wav.buffer, wav.byteOffset, wav.byteLength).getUint32(24, true) || LOCAL_SANOTTS_SAMPLE_RATE
}
