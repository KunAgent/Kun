/**
 * sanoTTS synthesis worker.
 *
 * G2P and piperlite inference run synchronously inside WASM, so they live on a
 * worker thread. Electron APIs are unavailable here; Main resolves every path.
 */
import { parentPort, type Transferable } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  LOCAL_SANOTTS_MAX_PHONEME_IDS,
  LOCAL_SANOTTS_MAX_SAMPLES,
  LOCAL_SANOTTS_SAMPLE_RATE
} from '../../shared/local-sanotts'
import { widenSanottsF16, type SanottsWeightDims } from '../../shared/local-sanotts-weights'
import type {
  SanottsWorkerRequest,
  SanottsWorkerResponse
} from './local-sanotts-worker-protocol'

type EmscriptenModule = {
  HEAPU8: Uint8Array
  HEAP32: Int32Array
  HEAPF32: Float32Array
  _malloc: (bytes: number) => number
  _free: (ptr: number) => void
  cwrap: (
    ident: string,
    returnType: string,
    argTypes: string[]
  ) => (...args: unknown[]) => number
  _snt_g2p_init?: () => number
  _snt_g2p_text_to_ids: (textPtr: number, outPtr: number, maxIds: number) => number
  _snt_voice_synthesize: (
    frontPtr: number,
    decPtr: number,
    idsPtr: number,
    idCount: number,
    lengthScale: number,
    outPtr: number,
    outCap: number
  ) => number
}

type VoiceMeta = {
  espeak_voice?: string | null
  g2p_voice_slot?: number
  length_scale?: number
  sample_rate?: number
  weights?: string
  phoneme_type?: string
  front?: string
  dec?: string
  front_dims?: SanottsWeightDims
  dec_dims?: SanottsWeightDims
}

type LoadedVoice = {
  voiceDir: string
  meta: VoiceMeta
  front: Uint8Array
  dec: Uint8Array
}

type EmscriptenFactory = (options: {
  locateFile: (fileName: string) => string
  printErr?: (text: string) => void
}) => Promise<EmscriptenModule>

const G2P_CHATTER =
  /^(?:Can't read dictionary file|Using phonemetable|Compiling: )|^\s*\d+ entries\s*$|^\s*\d+ rules, \d+ groups|^\s*$/

let runtime: { dir: string; g2p: EmscriptenModule; voice: EmscriptenModule } | null = null
let setVoice: ((espeakVoice: string, slot: number) => number) | null = null
const voiceCache = new Map<string, LoadedVoice>()
const canceled = new Set<string>()

async function loadRuntime(runtimeDir: string): Promise<{ g2p: EmscriptenModule; voice: EmscriptenModule }> {
  if (runtime?.dir === runtimeDir) return runtime
  const requireFromRuntime = createRequire(join(runtimeDir, 'snt_g2p.js'))
  const SaanoG2P = requireFromRuntime(join(runtimeDir, 'snt_g2p.js')) as EmscriptenFactory
  const SaanoVoice = requireFromRuntime(join(runtimeDir, 'snt_voice.js')) as EmscriptenFactory
  const locateFile = (fileName: string): string => join(runtimeDir, fileName)
  const g2p = await SaanoG2P({
    locateFile,
    printErr: (text) => {
      if (!G2P_CHATTER.test(text)) console.error(`g2p: ${text}`)
    }
  })
  const voice = await SaanoVoice({ locateFile })
  const rc = g2p._snt_g2p_init?.() ?? 0
  if (rc !== 0) throw new Error(`snt_g2p_init failed with ${rc}`)
  runtime = { dir: runtimeDir, g2p, voice }
  setVoice = g2p.cwrap('snt_g2p_set_voice', 'number', ['string', 'number'])
  voiceCache.clear()
  return runtime
}

async function loadVoice(voiceId: string, voiceDir: string): Promise<LoadedVoice> {
  const cached = voiceCache.get(voiceId)
  if (cached?.voiceDir === voiceDir) return cached
  const meta = JSON.parse(await readFile(join(voiceDir, 'meta.json'), 'utf8')) as VoiceMeta
  if (meta.phoneme_type === 'pinyin') {
    throw new Error(`${voiceId} uses pinyin G2P, which this build does not ship`)
  }
  let front: Uint8Array = new Uint8Array(await readFile(join(voiceDir, meta.front || 'front_f32.bin')))
  let dec: Uint8Array = new Uint8Array(await readFile(join(voiceDir, meta.dec || 'dec_f32.bin')))
  if (meta.weights === 'f16') {
    front = widenSanottsF16(front, meta.front_dims)
    dec = widenSanottsF16(dec, meta.dec_dims)
  }
  const loaded = { voiceDir, meta, front, dec }
  voiceCache.set(voiceId, loaded)
  return loaded
}

function writeCString(mod: EmscriptenModule, text: string): number {
  const encoded = Buffer.from(text, 'utf8')
  const ptr = mod._malloc(encoded.length + 1)
  mod.HEAPU8.set(encoded, ptr)
  mod.HEAPU8[ptr + encoded.length] = 0
  return ptr
}

function toHeap(mod: EmscriptenModule, bytes: Uint8Array): number {
  const ptr = mod._malloc(bytes.byteLength)
  mod.HEAPU8.set(bytes, ptr)
  return ptr
}

function phonemeIds(g2p: EmscriptenModule, text: string): Int32Array {
  const textPtr = writeCString(g2p, text)
  const outPtr = g2p._malloc(LOCAL_SANOTTS_MAX_PHONEME_IDS * 4)
  try {
    const count = g2p._snt_g2p_text_to_ids(textPtr, outPtr, LOCAL_SANOTTS_MAX_PHONEME_IDS)
    if (count <= 0) throw new Error(`phonemizer returned ${count}`)
    return Int32Array.from(g2p.HEAP32.subarray(outPtr >> 2, (outPtr >> 2) + count))
  } finally {
    g2p._free(textPtr)
    g2p._free(outPtr)
  }
}

function toPcm16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }
  return pcm
}

async function synthesize(request: Extract<SanottsWorkerRequest, { type: 'synthesize' }>): Promise<void> {
  const port = parentPort
  if (!port) return
  const reply = (response: SanottsWorkerResponse, transfer?: Transferable[]): void => {
    port.postMessage(response, transfer ?? [])
  }
  try {
    const { g2p, voice } = await loadRuntime(request.runtimeDir)
    const bundle = await loadVoice(request.voiceId, request.voiceDir)
    if (canceled.has(request.id)) {
      reply({ type: 'result', id: request.id, ok: false, canceled: true })
      return
    }
    const espeakVoice = bundle.meta.espeak_voice
    if (!espeakVoice || !setVoice) {
      throw new Error(`${request.voiceId} has no espeak voice`)
    }
    const slot = Number(bundle.meta.g2p_voice_slot) || 0
    const voiceRc = setVoice(espeakVoice, slot)
    if (voiceRc !== 0) {
      throw new Error(`snt_g2p_set_voice("${espeakVoice}", ${slot}) failed rc=${voiceRc}`)
    }
    const ids = phonemeIds(g2p, request.text)
    if (canceled.has(request.id)) {
      reply({ type: 'result', id: request.id, ok: false, canceled: true })
      return
    }
    const lengthScale = Math.min(2, Math.max(0.5, request.speed)) * (Number(bundle.meta.length_scale) || 1)
    const sampleRate = Number(bundle.meta.sample_rate) || LOCAL_SANOTTS_SAMPLE_RATE
    const frontPtr = toHeap(voice, bundle.front)
    const decPtr = toHeap(voice, bundle.dec)
    const idsBytes = new Uint8Array(ids.buffer, ids.byteOffset, ids.byteLength)
    const idsPtr = toHeap(voice, idsBytes)
    const outPtr = voice._malloc(LOCAL_SANOTTS_MAX_SAMPLES * 4)
    try {
      const count = voice._snt_voice_synthesize(
        frontPtr,
        decPtr,
        idsPtr,
        ids.length,
        lengthScale,
        outPtr,
        LOCAL_SANOTTS_MAX_SAMPLES
      )
      if (count < 0) throw new Error(`snt_voice_synthesize returned ${count}`)
      if (canceled.has(request.id)) {
        reply({ type: 'result', id: request.id, ok: false, canceled: true })
        return
      }
      const samples = new Float32Array(count)
      samples.set(voice.HEAPF32.subarray(outPtr >> 2, (outPtr >> 2) + count))
      const pcm = toPcm16(samples)
      const buffer = pcm.buffer as ArrayBuffer
      reply(
        {
          type: 'result',
          id: request.id,
          ok: true,
          sampleRate,
          sampleCount: pcm.length,
          durationSeconds: pcm.length / sampleRate,
          pcm
        },
        [buffer]
      )
    } finally {
      voice._free(frontPtr)
      voice._free(decPtr)
      voice._free(idsPtr)
      voice._free(outPtr)
    }
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

parentPort?.on('message', (message: SanottsWorkerRequest) => {
  if (message?.type === 'synthesize') {
    void synthesize(message)
    return
  }
  if (message?.type === 'cancel') {
    canceled.add(message.id)
    return
  }
  if (message?.type === 'reset') {
    runtime = null
    setVoice = null
    voiceCache.clear()
    parentPort?.postMessage({ type: 'reset-done' } satisfies SanottsWorkerResponse)
  }
})

parentPort?.postMessage({ type: 'ready' } satisfies SanottsWorkerResponse)
