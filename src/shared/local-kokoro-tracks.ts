/**
 * Stored Speak recordings.
 *
 * When the user asks Kun to keep generated tracks, the audio for an answer is
 * written once and replayed from disk afterwards, so speaking the same answer
 * again costs nothing and the recording can be saved to their device.
 */
import { LOCAL_KOKORO_SAMPLE_RATE } from './local-kokoro'

export const LOCAL_KOKORO_TRACK_EXTENSION = 'wav'

/** Bytes per stored sample: 16-bit mono. */
const BYTES_PER_SAMPLE = 2
const WAV_HEADER_BYTES = 44

export type LocalKokoroTrackIdentity = {
  text: string
  modelId: string
  voiceId: string
  speed: number
}

export type LocalKokoroTrackInfo = {
  key: string
  sizeBytes: number
  durationSeconds: number
  createdAt: string
}

export type LocalKokoroTrackUsage = {
  count: number
  totalBytes: number
}

export type LocalKokoroTrackExportResult =
  | { ok: true; path: string }
  | { ok: false; canceled?: boolean; message?: string }

/**
 * Identity of a recording.
 *
 * Anything that changes the audio has to change the key, so the model, the
 * voice and the speed are folded in alongside the text. FNV-1a is used rather
 * than a cryptographic digest because both processes need the same value
 * synchronously and this is a cache key, not a security boundary.
 */
export function localKokoroTrackKey(identity: LocalKokoroTrackIdentity): string {
  const speed = Number.isFinite(identity.speed) ? Math.round(identity.speed * 100) / 100 : 1
  const canonical = [
    identity.modelId,
    identity.voiceId,
    speed.toFixed(2),
    identity.text.trim().replace(/\s+/g, ' ')
  ].join(' ')
  return `${fnv1a64(canonical)}-${canonical.length.toString(36)}`
}

function fnv1a64(value: string): string {
  // 64-bit FNV-1a, kept in BigInt so both processes agree bit for bit.
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash ^ BigInt(value.charCodeAt(index))) * prime) & mask
  }
  return hash.toString(16).padStart(16, '0')
}

/** True when a value looks like a key this module produced. */
export function isLocalKokoroTrackKey(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{16}-[0-9a-z]{1,12}$/.test(value)
}

/** Seconds of audio in a stored track of this size. */
export function localKokoroTrackDurationSeconds(
  sizeBytes: number,
  sampleRate = LOCAL_KOKORO_SAMPLE_RATE
): number {
  const audioBytes = Math.max(0, sizeBytes - WAV_HEADER_BYTES)
  return audioBytes / BYTES_PER_SAMPLE / sampleRate
}

/** File name offered when the recording is saved to the user's device. */
export function localKokoroTrackFileName(createdAt?: string): string {
  const parsed = createdAt ? new Date(createdAt) : new Date()
  const stamp = (Number.isNaN(parsed.getTime()) ? new Date() : parsed)
    .toISOString()
    .replace(/[:.]/g, '-')
  return `Kun-speech-${stamp}.${LOCAL_KOKORO_TRACK_EXTENSION}`
}

/**
 * Wrap 16-bit PCM in a WAV container.
 *
 * WAV is written rather than a compressed format so no encoder ships with the
 * app and every operating system can play the saved file.
 */
export function encodeWav(pcm: Uint8Array, sampleRate = LOCAL_KOKORO_SAMPLE_RATE): Uint8Array {
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
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * BYTES_PER_SAMPLE, true)
  view.setUint16(32, BYTES_PER_SAMPLE, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, pcm.byteLength, true)
  out.set(pcm, WAV_HEADER_BYTES)
  return out
}

/** Strip the WAV container, returning the 16-bit PCM payload. */
export function decodeWavPcm(wav: Uint8Array): Uint8Array {
  if (wav.byteLength <= WAV_HEADER_BYTES) return new Uint8Array(0)
  return wav.subarray(WAV_HEADER_BYTES)
}
