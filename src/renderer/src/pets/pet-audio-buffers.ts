import { TYPING_SOUND_WAV_B64, type TypingSoundSlot } from './typing-sound-data'

const ALL_TYPING_SLOTS = Object.keys(TYPING_SOUND_WAV_B64) as TypingSoundSlot[]

function decodeBase64Bytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

/** Synchronously decodes standard 16-bit mono/stereo RIFF PCM WAV into a WebAudio AudioBuffer. */
export function decodePcmWavToAudioBuffer(ctx: BaseAudioContext, wavBytes: Uint8Array): AudioBuffer | null {
  if (wavBytes.byteLength < 44) return null
  const view = new DataView(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength)
  // 'RIFF' (0x52494646) & 'WAVE' (0x57415645)
  if (view.getUint32(0, false) !== 0x52494646 || view.getUint32(8, false) !== 0x57415645) return null
  let offset = 12
  let channels = 1
  let sampleRate = 44100
  let bitsPerSample = 16
  let audioFormat = 1
  let dataOffset = -1
  let dataLength = 0

  while (offset + 8 <= wavBytes.byteLength) {
    const chunkId = view.getUint32(offset, false)
    const chunkSize = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (chunkId === 0x666d7420 && body + 16 <= wavBytes.byteLength) {
      audioFormat = view.getUint16(body, true)
      channels = Math.max(1, view.getUint16(body + 2, true))
      sampleRate = view.getUint32(body + 4, true)
      bitsPerSample = view.getUint16(body + 14, true)
    } else if (chunkId === 0x64617461) {
      dataOffset = body
      dataLength = Math.min(chunkSize, wavBytes.byteLength - body)
      break
    }
    offset = body + chunkSize + (chunkSize & 1)
  }

  if (audioFormat !== 1 || bitsPerSample !== 16 || dataOffset < 0 || dataLength < 2 || sampleRate <= 0) {
    return null
  }
  const frameCount = Math.floor(dataLength / (2 * channels))
  if (frameCount <= 0) return null
  const buffer = ctx.createBuffer(channels, frameCount, sampleRate)
  for (let ch = 0; ch < channels; ch++) {
    const out = buffer.getChannelData(ch)
    let p = dataOffset + ch * 2
    const stride = channels * 2
    for (let i = 0; i < frameCount; i++, p += stride) {
      out[i] = view.getInt16(p, true) / 32768
    }
  }
  return buffer
}

export function decodeAllTypingBuffers(ctx: BaseAudioContext): Map<TypingSoundSlot, AudioBuffer> {
  const map = new Map<TypingSoundSlot, AudioBuffer>()
  for (const slot of ALL_TYPING_SLOTS) {
    try {
      const bytes = decodeBase64Bytes(TYPING_SOUND_WAV_B64[slot])
      const buf = decodePcmWavToAudioBuffer(ctx, bytes)
      if (buf) map.set(slot, buf)
    } catch { /* ignore malformed slot */ }
  }
  return map
}

/**
 * Dual-phase glottal-pulse cat purr synthesis (~3.4 s seamless loop) adapted from KuroCat (MIT License).
 */
export function buildGlottalPurrBuffer(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate
  const cycleDur = 1.85
  const totalDur = cycleDur * 2
  const len = Math.max(2048, Math.floor(sr * totalDur))
  const tmp = new Float32Array(len)

  let phase = 0
  let lp1 = 0
  let lp2 = 0
  let lp3 = 0
  let hp = 0
  let prevIn = 0
  let jitter = 0

  for (let i = 0; i < len; i++) {
    const t = i / sr
    const cycPos = (t % cycleDur) / cycleDur
    let env = 0.05
    let isExhale = false
    if (cycPos < 0.46) {
      env = Math.pow(Math.sin((cycPos / 0.46) * Math.PI), 0.65) * 0.86
    } else if (cycPos >= 0.52 && cycPos < 0.95) {
      isExhale = true
      env = Math.pow(Math.sin(((cycPos - 0.52) / 0.43) * Math.PI), 0.58)
    }
    jitter = jitter * 0.9992 + (Math.random() * 2 - 1) * 0.045
    phase += ((isExhale ? 27.6 : 25.2) + jitter * 1.4) / sr
    if (phase >= 1) phase -= 1

    let glottal = 0
    if (phase < 0.38) {
      glottal = 0.5 * (1 - Math.cos(Math.PI * (phase / 0.38)))
    } else if (phase < 0.54) {
      glottal = Math.cos(0.5 * Math.PI * ((phase - 0.38) / 0.16))
    }
    const click = phase > 0.48 && phase < 0.62 ? Math.sin(((phase - 0.48) / 0.14) * Math.PI) * 0.3 : 0
    const air = (Math.random() * 2 - 1) * (0.07 + 0.14 * glottal) * (isExhale ? 1.15 : 0.85)
    const raw = ((glottal - 0.28) * 1.15 + click + air) * env

    lp1 += (raw - lp1) * 0.065
    lp2 += (lp1 - lp2) * 0.11
    lp3 += (raw - lp3) * 0.24
    const shaped = lp2 * 1.55 + (lp3 - lp2) * 0.48
    hp = 0.996 * (hp + shaped - prevIn)
    prevIn = shaped
    tmp[i] = hp
  }

  const xf = Math.min(Math.floor(sr * 0.35), Math.floor(len * 0.2))
  const loopLen = len - xf
  const outBuf = ctx.createBuffer(1, loopLen, sr)
  const out = outBuf.getChannelData(0)
  let sumSq = 0
  for (let i = 0; i < loopLen; i++) {
    let s = tmp[i]
    if (i < xf) {
      const a = (i / xf) * Math.PI * 0.5
      s = s * Math.sin(a) + tmp[loopLen + i] * Math.cos(a)
    }
    out[i] = s
    sumSq += s * s
  }
  const rms = Math.sqrt(sumSq / loopLen + 1e-12)
  const gain = 0.14 / rms
  for (let i = 0; i < loopLen; i++) {
    out[i] = Math.max(-0.92, Math.min(0.92, out[i] * gain))
  }
  return outBuf
}
