import type { LocalKokoroModelId } from './local-kokoro'
import type { LocalKokoroVoiceId } from './local-kokoro-voices'

/**
 * Upper bound accepted for one synthesis request. Chunking normally keeps text
 * far below this; the cap only stops an unbounded payload from reaching the
 * model.
 */
export const KOKORO_SPEAK_MAX_TEXT_CHARS = 4_000

export type LocalKokoroSpeakRequest = {
  /** Collect this chunk into the recording being kept for the answer. */
  keepTrack?: boolean
  /** One speakable chunk, already stripped of Markdown. */
  text: string
  /**
   * Correlates cancellation with an in-flight synthesis. The renderer reuses
   * one id for a whole answer so stopping playback drops every queued chunk.
   */
  requestId: string
  modelId?: LocalKokoroModelId
  voiceId?: LocalKokoroVoiceId
  /** 0.5 - 2.0; values outside the range are clamped. */
  speed?: number
}

export type LocalKokoroSpeakResult =
  | {
      ok: true
      sampleRate: number
      sampleCount: number
      durationSeconds: number
      /** Mono 16-bit little-endian PCM, base64 encoded. */
      pcm16Base64: string
    }
  | {
      ok: false
      /** True when the chunk was dropped because playback was stopped. */
      canceled?: boolean
      /** Set when synthesis failed only because an asset is still missing. */
      missing?: 'model' | 'voice'
      message?: string
    }

/** Decode a synthesis result into Web Audio samples. */
export function decodeKokoroPcm16(pcm16Base64: string): Float32Array {
  const bytes = typeof atob === 'function'
    ? Uint8Array.from(atob(pcm16Base64), (character) => character.charCodeAt(0))
    : new Uint8Array(0)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const samples = new Float32Array(Math.floor(bytes.byteLength / 2))
  for (let index = 0; index < samples.length; index += 1) {
    const value = view.getInt16(index * 2, true)
    samples[index] = value < 0 ? value / 0x8000 : value / 0x7fff
  }
  return samples
}
