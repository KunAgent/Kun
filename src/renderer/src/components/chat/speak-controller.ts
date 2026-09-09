/**
 * Drives the Speak action: Markdown -> chunks -> Kokoro synthesis -> playback.
 *
 * One answer speaks at a time. Synthesis runs a chunk ahead of playback so the
 * first sentence starts as soon as it is ready instead of after the whole
 * answer is rendered.
 */
import { LOCAL_KOKORO_SAMPLE_RATE, type LocalKokoroModelId } from '@shared/local-kokoro'
import { decodeKokoroPcm16 } from '@shared/local-kokoro-speech'
import {
  KOKORO_FIRST_CHUNK_CHARS,
  KOKORO_MAX_CHUNK_CHARS,
  KOKORO_MIN_CHUNK_CHARS,
  speechSentencesFromAnswer,
  takeSpeechChunk
} from '@shared/kokoro-text'
import { localKokoroVoiceById } from '@shared/local-kokoro-voices'
import { localKokoroTrackKey } from '@shared/local-kokoro-tracks'
import { speechTextFromAnswer } from '@shared/kokoro-text'
import { refreshSpeakTrackKeys, useSpeakTrackStore } from '../../stores/speak-track-store'
import { useSpeakStore } from '../../stores/speak-store'
import { KokoroPlayer } from './kokoro-playback'
import {
  ensureKokoroAssets,
  loadSpeakSettings,
  type SpeakSettings
} from './speak-assets'

/** Floor for how far synthesis stays ahead of playback, in seconds. */
const MIN_SYNTHESIS_LEAD_SECONDS = 6

/**
 * Lead needed before pausing synthesis.
 *
 * Synthesis is not always faster than realtime, so a fixed lead can run the
 * buffer dry on a slow machine: the next chunk has to be produced inside the
 * audio already scheduled. Twice the last chunk's synthesis time leaves room
 * for a chunk that takes longer than the one before it.
 */
export function synthesisLeadSeconds(lastSynthesisSeconds: number): number {
  if (!Number.isFinite(lastSynthesisSeconds) || lastSynthesisSeconds <= 0) {
    return MIN_SYNTHESIS_LEAD_SECONDS
  }
  return Math.max(MIN_SYNTHESIS_LEAD_SECONDS, lastSynthesisSeconds * 2)
}

/** Share of the buffered audio a chunk's synthesis is allowed to consume. */
const CHUNK_BUDGET_SAFETY = 0.7

/**
 * Characters to put in the next chunk.
 *
 * A chunk has to be finished inside the audio already scheduled, or playback
 * gaps. Rather than assume a growth rate, the budget is derived from how long
 * synthesis actually took per character and how much audio is buffered right
 * now, so a slow machine converges on small chunks and a fast one reaches full
 * size. The first chunk has nothing measured yet and is kept short so playback
 * starts quickly.
 */
export function nextChunkBudget(
  bufferedSeconds: number,
  synthesisSecondsPerChar: number
): number {
  if (!Number.isFinite(synthesisSecondsPerChar) || synthesisSecondsPerChar <= 0) {
    return KOKORO_FIRST_CHUNK_CHARS
  }
  const buffered = Number.isFinite(bufferedSeconds) ? Math.max(0, bufferedSeconds) : 0
  const affordable = Math.floor((buffered * CHUNK_BUDGET_SAFETY) / synthesisSecondsPerChar)
  return Math.min(KOKORO_MAX_CHUNK_CHARS, Math.max(KOKORO_MIN_CHUNK_CHARS, affordable))
}

type SpeakSession = {
  blockId: string
  requestId: string
  player: KokoroPlayer
  canceled: boolean
  /** Model tier whose download this session may have started. */
  downloadingModelId: LocalKokoroModelId | null
  /** Recording being captured for this answer, when tracks are kept. */
  trackKey: string | null
}

let session: SpeakSession | null = null
/** Times a stored recording was replayed instead of synthesized. */
let storedPlaybacks = 0

/**
 * Identity of the recording for an answer under the current voice settings.
 *
 * Derived from the spoken text rather than the markdown, so an answer whose
 * formatting changed but whose speech did not still hits the stored file.
 */
export function speakTrackKeyFor(markdown: string, settings: SpeakSettings): string {
  return localKokoroTrackKey({
    text: speechTextFromAnswer(markdown),
    modelId: settings.model,
    voiceId: settings.voice,
    speed: settings.speed
  })
}

export function speakingBlockId(): string | null {
  return session?.blockId ?? null
}

/**
 * How many answers have been played from a stored recording.
 *
 * Exposed so a test can tell replay from synthesis without timing it: replaying
 * a file finishes faster than a repaint, so the visible phase is not a reliable
 * signal.
 */
export function speakStoredPlaybackCount(): number {
  return storedPlaybacks
}

/** Silence inserted so far because synthesis fell behind playback, in seconds. */
export function speakingDroppedSeconds(): number {
  return session?.player.droppedSeconds ?? 0
}

/**
 * Stop playback, drop queued synthesis, and abort an asset download this
 * session started. Safe to call when idle.
 */
export function stopSpeaking(): void {
  const current = session
  session = null
  if (!current) {
    useSpeakStore.getState().reset()
    return
  }
  current.canceled = true
  current.player.stop()
  void window.kunGui?.cancelLocalKokoroSpeech?.(current.requestId).catch(() => undefined)
  if (current.trackKey) {
    // A stopped answer is incomplete; nothing half-spoken gets stored.
    void window.kunGui?.discardLocalKokoroTrack?.(current.requestId).catch(() => undefined)
  }
  if (current.downloadingModelId) {
    // Dismissing the progress card has to stop the transfer too, otherwise it
    // keeps running with nothing on screen reporting it.
    void window.kunGui?.cancelLocalKokoroModel?.(current.downloadingModelId).catch(() => undefined)
    current.downloadingModelId = null
  }
  useSpeakStore.getState().reset()
}

/**
 * Speak one assistant answer. Calling it for the block that is already
 * speaking stops playback, so the button doubles as stop.
 */
export async function speakAnswer(blockId: string, markdown: string): Promise<void> {
  if (session?.blockId === blockId) {
    stopSpeaking()
    return
  }
  stopSpeaking()
  const store = useSpeakStore.getState()
  if (typeof window.kunGui?.synthesizeLocalKokoroSpeech !== 'function') {
    store.fail('speakUnavailable')
    return
  }
  const settings = await loadSpeakSettings()
  if (!settings) {
    store.fail('speakUnavailable')
    return
  }
  if (!settings.enabled) {
    // The action is hidden while the toggle is off; a stale click must not
    // start a download, and there is nothing to report to the user.
    store.reset()
    return
  }
  const sentences = speechSentencesFromAnswer(markdown)
  if (sentences.length === 0) {
    store.fail('speakNothingToRead')
    return
  }
  const current: SpeakSession = {
    blockId,
    requestId: `speak-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    player: new KokoroPlayer(LOCAL_KOKORO_SAMPLE_RATE),
    canceled: false,
    downloadingModelId: null,
    trackKey: settings.keepTracks ? speakTrackKeyFor(markdown, settings) : null
  }
  session = current
  store.start(blockId)
  try {
    const ready = await ensureKokoroAssets(settings, () => current.canceled, (modelId) => {
      current.downloadingModelId = modelId
    })
    current.downloadingModelId = null
    if (current.canceled) return
    if (!ready.ok) {
      finish(current, ready.message)
      return
    }
    if (await playStoredTrack(current)) return
    await runChunks(current, settings, sentences)
  } catch (error) {
    finish(current, error instanceof Error ? error.message : String(error))
  }
}

/**
 * Play the recording kept for this answer, if there is one.
 *
 * Returns false when nothing is stored, so the caller falls through to
 * synthesis. A stored file makes speaking the same answer again free.
 */
async function playStoredTrack(current: SpeakSession): Promise<boolean> {
  const key = current.trackKey
  if (!key || typeof window.kunGui?.readLocalKokoroTrack !== 'function') return false
  if (!useSpeakTrackStore.getState().keys?.has(key)) return false
  const store = useSpeakStore.getState()
  store.setDownload(null)
  store.setPhase('synthesizing')
  const pcm16Base64 = await window.kunGui.readLocalKokoroTrack(key).catch(() => null)
  if (current.canceled) return true
  if (!pcm16Base64) {
    // The file went away since the key list was read; synthesize instead.
    refreshSpeakTrackKeys()
    return false
  }
  const samples = decodeKokoroPcm16(pcm16Base64)
  if (samples.length === 0) return false
  current.player.enqueue(samples, LOCAL_KOKORO_SAMPLE_RATE)
  storedPlaybacks += 1
  store.setPhase('speaking')
  store.setProgress({ spoken: 1, total: 1 })
  await current.player.waitForDrain()
  if (current.canceled) return true
  finish(current, null)
  return true
}

async function runChunks(
  current: SpeakSession,
  settings: SpeakSettings,
  sentences: string[]
): Promise<void> {
  const store = useSpeakStore.getState()
  store.setDownload(null)
  store.setPhase('synthesizing')
  const queue = [...sentences]
  const remainingChars = (): number => queue.reduce((sum, item) => sum + item.length + 1, 0)
  let lastSynthesisSeconds = 0
  let synthesisSecondsPerChar = 0
  let spoken = 0
  store.setProgress({ spoken: 0, total: estimatedChunkTotal(0, remainingChars(), 0) })
  while (queue.length > 0) {
    if (current.canceled) return
    // Keep synthesis ahead of playback without racing far past it.
    const lead = synthesisLeadSeconds(lastSynthesisSeconds)
    while (!current.canceled && current.player.bufferedSeconds > lead) {
      await delay(120)
    }
    if (current.canceled) return
    const budget = nextChunkBudget(current.player.bufferedSeconds, synthesisSecondsPerChar)
    const chunk = takeSpeechChunk(queue, budget)
    if (!chunk) break
    const startedAt = Date.now()
    const result = await window.kunGui.synthesizeLocalKokoroSpeech({
      text: chunk,
      requestId: current.requestId,
      modelId: settings.model,
      voiceId: settings.voice,
      speed: settings.speed,
      keepTrack: Boolean(current.trackKey)
    })
    lastSynthesisSeconds = (Date.now() - startedAt) / 1000
    synthesisSecondsPerChar = lastSynthesisSeconds / chunk.length
    if (current.canceled) return
    if (!result.ok) {
      if (result.canceled) return
      finish(current, result.message || 'speakFailed')
      return
    }
    current.player.enqueue(decodeKokoroPcm16(result.pcm16Base64), result.sampleRate)
    if (useSpeakStore.getState().phase !== 'speaking') store.setPhase('speaking')
    spoken += 1
    store.setProgress({
      spoken,
      total: estimatedChunkTotal(spoken, remainingChars(), chunk.length)
    })
  }
  if (current.canceled) return
  await storeTrack(current)
  await current.player.waitForDrain()
  if (current.canceled) return
  finish(current, null)
}

/**
 * Write the captured audio once every chunk has been produced.
 *
 * Done before waiting for playback to drain so the download action appears as
 * soon as the recording exists, rather than minutes later when it stops.
 */
async function storeTrack(current: SpeakSession): Promise<void> {
  const key = current.trackKey
  if (!key || typeof window.kunGui?.finalizeLocalKokoroTrack !== 'function') return
  const info = await window.kunGui
    .finalizeLocalKokoroTrack({ requestId: current.requestId, key })
    .catch(() => null)
  if (info) useSpeakTrackStore.getState().addKey(info.key)
}

/**
 * Chunk count for the inline progress hint.
 *
 * Chunk boundaries are decided while speaking, so the total is an estimate from
 * the text still queued rather than a fixed count.
 */
export function estimatedChunkTotal(
  spoken: number,
  remainingChars: number,
  lastChunkChars: number
): number {
  if (remainingChars <= 0) return Math.max(1, spoken)
  const size = lastChunkChars > 0 ? lastChunkChars : KOKORO_FIRST_CHUNK_CHARS
  return spoken + Math.max(1, Math.ceil(remainingChars / size))
}

/** Preview a voice with a fixed sample line, used by the settings panel. */
export async function previewKokoroVoice(
  settings: SpeakSettings,
  sampleText: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (typeof window.kunGui?.synthesizeLocalKokoroSpeech !== 'function') {
    return { ok: false, message: 'speakUnavailable' }
  }
  stopSpeaking()
  const current: SpeakSession = {
    blockId: `preview:${localKokoroVoiceById(settings.voice).id}`,
    requestId: `speak-preview-${Date.now()}`,
    player: new KokoroPlayer(LOCAL_KOKORO_SAMPLE_RATE),
    canceled: false,
    downloadingModelId: null,
    trackKey: null
  }
  session = current
  useSpeakStore.getState().start(current.blockId)
  try {
    const ready = await ensureKokoroAssets(settings, () => current.canceled, (modelId) => {
      current.downloadingModelId = modelId
    })
    current.downloadingModelId = null
    if (current.canceled) return { ok: false, message: '' }
    if (!ready.ok) {
      finish(current, ready.message)
      return { ok: false, message: ready.message }
    }
    const previewSentences = speechSentencesFromAnswer(sampleText)
    await runChunks(current, settings, previewSentences.length > 0 ? previewSentences : [sampleText])
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    finish(current, message)
    return { ok: false, message }
  }
}

function finish(current: SpeakSession, error: string | null): void {
  if (session === current) session = null
  current.player.stop()
  const store = useSpeakStore.getState()
  if (error) store.fail(error)
  else store.reset()
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
