/**
 * Kokoro synthesis worker.
 *
 * `onnxruntime-node` runs inference synchronously on the calling JavaScript
 * thread - its `run` is a blocking native call wrapped in `setImmediate` - so
 * doing this in the Main process froze the window for the length of every
 * chunk. The model, the phonemizer and the voice cache all live here instead,
 * on a worker thread, and Main only exchanges messages with it.
 *
 * Electron APIs are unavailable on a worker thread, so every path is resolved
 * by Main and sent in with the request.
 */
import { parentPort, type Transferable } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import {
  LOCAL_KOKORO_SAMPLE_RATE,
  LOCAL_KOKORO_STYLE_DIMENSION
} from '../../shared/local-kokoro'
import {
  applyKokoroPhonemeRules,
  kokoroTokenSequences,
  splitKokoroSegments
} from '../../shared/kokoro-phonemes'
import type {
  KokoroWorkerRequest,
  KokoroWorkerResponse
} from './local-kokoro-worker-protocol'

const requireFromHere = createRequire(import.meta.url)

type OrtTensor = { data: Float32Array }
type OrtSession = {
  run: (feeds: Record<string, unknown>) => Promise<Record<string, OrtTensor>>
  release?: () => Promise<void>
}
type OrtModule = {
  InferenceSession: { create: (path: string, options?: Record<string, unknown>) => Promise<OrtSession> }
  Tensor: new (type: string, data: ArrayLike<number> | BigInt64Array, dims: number[]) => unknown
}
type Phonemizer = (text: string, language: string) => Promise<string[] | string>

let ortModule: OrtModule | null = null
let phonemizer: Phonemizer | null = null
let loadedSession: { modelPath: string; session: OrtSession } | null = null
const voiceCache = new Map<string, Float32Array>()
const canceled = new Set<string>()

/**
 * ONNX Runtime otherwise starts one intra-op thread per core, which measured no
 * faster on this graph and lets a burst take the whole machine.
 */
export function kokoroThreadOptions(cores = availableParallelism()): {
  intraOpNumThreads: number
  interOpNumThreads: number
} {
  const usable = Number.isFinite(cores) && cores > 0 ? Math.floor(cores) : 1
  return {
    intraOpNumThreads: Math.max(1, Math.min(4, Math.ceil(usable / 2))),
    interOpNumThreads: 1
  }
}

function loadOrt(): OrtModule {
  if (ortModule) return ortModule
  const loaded = requireFromHere('onnxruntime-node') as OrtModule & { default?: OrtModule }
  const resolved = loaded?.InferenceSession ? loaded : loaded?.default
  if (!resolved?.InferenceSession || !resolved?.Tensor) {
    throw new Error('onnxruntime-node module is unavailable')
  }
  ortModule = resolved
  return ortModule
}

async function loadPhonemizer(): Promise<Phonemizer> {
  if (phonemizer) return phonemizer
  const module = (await import('phonemizer')) as unknown as { phonemize: Phonemizer }
  if (typeof module?.phonemize !== 'function') {
    throw new Error('phonemizer module does not expose phonemize()')
  }
  phonemizer = module.phonemize
  return phonemizer
}

async function loadSession(modelPath: string): Promise<OrtSession> {
  if (loadedSession?.modelPath === modelPath) return loadedSession.session
  await releaseSession()
  const ort = loadOrt()
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    logSeverityLevel: 3,
    ...kokoroThreadOptions()
  })
  loadedSession = { modelPath, session }
  return session
}

async function releaseSession(): Promise<void> {
  const session = loadedSession?.session
  loadedSession = null
  voiceCache.clear()
  await session?.release?.().catch(() => undefined)
}

async function loadVoiceStyles(voiceId: string, path: string): Promise<Float32Array> {
  const cached = voiceCache.get(voiceId)
  if (cached) return cached
  const buffer = await readFile(path)
  const styles = new Float32Array(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  )
  voiceCache.set(voiceId, styles)
  return styles
}

async function phonemizeForLanguage(text: string, language: 'en-us' | 'en-gb'): Promise<string> {
  const phonemize = await loadPhonemizer()
  const pieces: string[] = []
  for (const segment of splitKokoroSegments(text)) {
    if (segment.literal) {
      pieces.push(segment.text)
      continue
    }
    const result = await phonemize(segment.text, language)
    pieces.push(Array.isArray(result) ? result.join(' ') : String(result))
  }
  return applyKokoroPhonemeRules(pieces.join(''), language)
}

/**
 * Voice files store one style vector per token count, so the vector is selected
 * by the length of this sequence (excluding the two boundary tokens).
 */
function styleForSequence(styles: Float32Array, tokenCount: number): Float32Array {
  const slots = Math.floor(styles.length / LOCAL_KOKORO_STYLE_DIMENSION)
  const index = Math.min(Math.max(tokenCount, 0), Math.max(slots - 1, 0))
  const offset = index * LOCAL_KOKORO_STYLE_DIMENSION
  return styles.slice(offset, offset + LOCAL_KOKORO_STYLE_DIMENSION)
}

async function runSequence(
  session: OrtSession,
  sequence: number[],
  styles: Float32Array,
  speed: number
): Promise<Float32Array> {
  const ort = loadOrt()
  const outputs = await session.run({
    input_ids: new ort.Tensor(
      'int64',
      BigInt64Array.from(sequence, (token) => BigInt(token)),
      [1, sequence.length]
    ),
    style: new ort.Tensor('float32', styleForSequence(styles, sequence.length - 2), [
      1,
      LOCAL_KOKORO_STYLE_DIMENSION
    ]),
    speed: new ort.Tensor('float32', Float32Array.of(speed), [1])
  })
  const waveform = outputs.waveform?.data ?? Object.values(outputs)[0]?.data
  if (!waveform) throw new Error('Kokoro produced no waveform')
  return waveform instanceof Float32Array ? waveform : Float32Array.from(waveform)
}

function concatSamples(parts: Float32Array[]): Float32Array {
  if (parts.length === 1) return parts[0]
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const merged = new Float32Array(total)
  let offset = 0
  for (const part of parts) {
    merged.set(part, offset)
    offset += part.length
  }
  return merged
}

/** Samples as 16-bit PCM, so the buffer can be transferred instead of copied. */
function toPcm16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }
  return pcm
}

async function synthesize(request: Extract<KokoroWorkerRequest, { type: 'synthesize' }>): Promise<void> {
  const port = parentPort
  if (!port) return
  const reply = (response: KokoroWorkerResponse, transfer?: Transferable[]): void => {
    port.postMessage(response, transfer ?? [])
  }
  try {
    // Loading the model does not depend on the phonemes, and on the first chunk
    // it is the larger of the two costs, so they overlap.
    const assets = Promise.all([
      loadSession(request.modelPath),
      loadVoiceStyles(request.voiceId, request.voicePath)
    ])
    const phonemes = await phonemizeForLanguage(request.text, request.language)
    const sequences = kokoroTokenSequences(phonemes)
    if (sequences.length === 0) {
      await assets.catch(() => undefined)
      reply({ type: 'result', id: request.id, ok: false, message: 'nothing to speak' })
      return
    }
    const [session, styles] = await assets
    if (canceled.has(request.id)) {
      reply({ type: 'result', id: request.id, ok: false, canceled: true })
      return
    }
    const parts: Float32Array[] = []
    for (const sequence of sequences) {
      if (canceled.has(request.id)) {
        reply({ type: 'result', id: request.id, ok: false, canceled: true })
        return
      }
      parts.push(await runSequence(session, sequence, styles, request.speed))
    }
    if (canceled.has(request.id)) {
      reply({ type: 'result', id: request.id, ok: false, canceled: true })
      return
    }
    const pcm = toPcm16(concatSamples(parts))
    // Freshly allocated above, so the buffer is a plain ArrayBuffer and can be
    // handed over rather than copied.
    const buffer = pcm.buffer as ArrayBuffer
    reply(
      {
        type: 'result',
        id: request.id,
        ok: true,
        sampleRate: LOCAL_KOKORO_SAMPLE_RATE,
        sampleCount: pcm.length,
        durationSeconds: pcm.length / LOCAL_KOKORO_SAMPLE_RATE,
        pcm
      },
      [buffer]
    )
  } catch (error) {
    reply({
      type: 'result',
      id: request.id,
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    })
  } finally {
    canceled.delete(request.id)
  }
}

parentPort?.on('message', (message: KokoroWorkerRequest) => {
  if (message?.type === 'synthesize') {
    void synthesize(message)
    return
  }
  if (message?.type === 'cancel') {
    canceled.add(message.id)
    return
  }
  if (message?.type === 'reset') {
    void releaseSession().then(() => parentPort?.postMessage({ type: 'reset-done' }))
  }
})

parentPort?.postMessage({ type: 'ready' } satisfies KokoroWorkerResponse)
