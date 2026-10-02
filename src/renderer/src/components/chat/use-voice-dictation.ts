import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CUSTOM_SPEECH_TO_TEXT_PROVIDER_ID,
  resolveKunSpeechToTextSettings,
  type AppSettingsV1,
  type KunPromptOptimizationSettingsV1,
  type KunSpeechToTextSettingsV1
} from '@shared/app-settings'
import { getKunRuntimeSettings } from '@shared/app-settings-kun-defaults'
import { SPEECH_TRANSCRIPTION_MAX_DURATION_MS } from '@shared/speech-to-text'
import { SETTINGS_CHANGED_EVENT } from '../../lib/keyboard-shortcut-settings'
import {
  connectionCredentialStateById,
  fetchSharedModelConnectionCredentialStates,
  providerHasUsableCredential
} from '../../lib/provider-credential-readiness'

export type VoiceDictationStatus = 'idle' | 'starting' | 'recording' | 'transcribing'

/** What to do with the transcript once it lands: insert into the input, or send right away. */
export type VoiceDictationIntent = 'insert' | 'send'

const TRANSCRIPTION_SAMPLE_RATE = 16_000
const MIN_RECORDING_MS = 500
const VOICE_ERROR_AUTO_DISMISS_MS = 10_000
const RECORDER_MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']

export type SpeechToTextSettingsState = {
  speechToText: KunSpeechToTextSettingsV1 | null
  /** True when the bound shared provider has usable Registry credentials. */
  credentialReady: boolean
}

function speechProviderCredentialReady(
  speechToText: KunSpeechToTextSettingsV1 | null,
  connectionUsable: boolean
): boolean {
  if (!speechToText) return false
  if (speechToText.apiKey.trim()) return true
  const providerId = speechToText.providerId.trim()
  if (!providerId || providerId === CUSTOM_SPEECH_TO_TEXT_PROVIDER_ID) return false
  if (
    speechToText.protocol === 'local-whisper' ||
    speechToText.protocol === 'gemini-cli-audio'
  ) {
    return false
  }
  return connectionUsable
}

/** Resolved speech-to-text settings, kept in sync with the settings screen. */
export function useSpeechToTextSettings(): SpeechToTextSettingsState {
  const [speechToText, setSpeechToText] = useState<KunSpeechToTextSettingsV1 | null>(null)
  const [credentialReady, setCredentialReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const refreshCredentialReady = (next: KunSpeechToTextSettingsV1): void => {
      const providerId = next.providerId.trim()
      if (
        !providerId ||
        providerId === CUSTOM_SPEECH_TO_TEXT_PROVIDER_ID ||
        next.protocol === 'local-whisper' ||
        next.protocol === 'gemini-cli-audio' ||
        next.apiKey.trim()
      ) {
        if (!cancelled) {
          setCredentialReady(speechProviderCredentialReady(next, false))
        }
        return
      }
      void fetchSharedModelConnectionCredentialStates()
        .then((states) => {
          if (cancelled) return
          const usable = providerHasUsableCredential(
            { id: providerId, apiKey: next.apiKey },
            connectionCredentialStateById(states, providerId)
          )
          setCredentialReady(speechProviderCredentialReady(next, usable))
        })
        .catch(() => {
          if (!cancelled) setCredentialReady(false)
        })
    }
    const apply = (settings: AppSettingsV1): void => {
      if (cancelled) return
      const resolved = resolveKunSpeechToTextSettings(settings)
      setSpeechToText(resolved)
      refreshCredentialReady(resolved)
    }
    if (typeof window.kunGui?.getSettings === 'function') {
      void window.kunGui.getSettings().then(apply).catch(() => undefined)
    }
    const onSettingsChanged = (event: Event): void => {
      apply((event as CustomEvent<AppSettingsV1>).detail)
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => {
      cancelled = true
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    }
  }, [])

  return { speechToText, credentialReady }
}

export function usePromptOptimizationSettings(): KunPromptOptimizationSettingsV1 | null {
  const [promptOptimization, setPromptOptimization] = useState<KunPromptOptimizationSettingsV1 | null>(null)

  useEffect(() => {
    let cancelled = false
    const apply = (settings: AppSettingsV1): void => {
      if (!cancelled) setPromptOptimization(getKunRuntimeSettings(settings).promptOptimization)
    }
    if (typeof window.kunGui?.getSettings === 'function') {
      void window.kunGui.getSettings().then(apply).catch(() => undefined)
    }
    const onSettingsChanged = (event: Event): void => {
      apply((event as CustomEvent<AppSettingsV1>).detail)
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => {
      cancelled = true
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    }
  }, [])

  return promptOptimization
}

export function useVoiceDictation({
  onText,
  speechToText
}: {
  onText: (text: string, intent: VoiceDictationIntent) => void
  speechToText?: KunSpeechToTextSettingsV1 | null
}): {
  status: VoiceDictationStatus
  error: string | null
  clearError: () => void
  startedAtMs: number
  start: () => void
  stop: (intent?: VoiceDictationIntent) => void
  toggle: () => void
  /** Discard this capture/result; an already dispatched IPC request cannot be recalled. */
  cancel: () => void
  /** Current microphone level (0..1) for waveform rendering. Safe to call every frame. */
  getLevel: () => number
} {
  const { t } = useTranslation('common')
  const [status, setStatus] = useState<VoiceDictationStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [startedAtMs, setStartedAtMs] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const levelDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null)
  const stopIntentRef = useRef<VoiceDictationIntent>('insert')
  const maxDurationTimerRef = useRef<number | null>(null)
  const errorTimerRef = useRef<number | null>(null)
  const startedAtRef = useRef(0)
  const onTextRef = useRef(onText)
  const mountedRef = useRef(true)
  const sessionRef = useRef(0)
  const statusRef = useRef<VoiceDictationStatus>('idle')
  const updateStatus = useCallback((next: VoiceDictationStatus): void => {
    statusRef.current = next
    if (mountedRef.current) setStatus(next)
  }, [])
  const isCurrent = useCallback((session: number) =>
    mountedRef.current && sessionRef.current === session, [])

  useEffect(() => {
    onTextRef.current = onText
  }, [onText])

  const clearError = useCallback((): void => {
    if (errorTimerRef.current != null) {
      window.clearTimeout(errorTimerRef.current)
      errorTimerRef.current = null
    }
    setError(null)
  }, [])

  // 错误条不允许永久驻留:可手动关闭,超时也会自动消失。
  const showError = useCallback((message: string): void => {
    setError(message)
    if (errorTimerRef.current != null) window.clearTimeout(errorTimerRef.current)
    errorTimerRef.current = window.setTimeout(() => {
      errorTimerRef.current = null
      if (mountedRef.current) setError(null)
    }, VOICE_ERROR_AUTO_DISMISS_MS)
  }, [])

  const releaseStream = useCallback((): void => {
    if (maxDurationTimerRef.current != null) {
      window.clearTimeout(maxDurationTimerRef.current)
      maxDurationTimerRef.current = null
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    recorderRef.current = null
    analyserRef.current = null
    levelDataRef.current = null
    void audioContextRef.current?.close().catch(() => undefined)
    audioContextRef.current = null
  }, [])

  const getLevel = useCallback((): number => {
    const analyser = analyserRef.current
    const data = levelDataRef.current
    if (!analyser || !data) return 0
    analyser.getByteTimeDomainData(data)
    let sumSquares = 0
    for (let i = 0; i < data.length; i += 1) {
      const value = (data[i] - 128) / 128
      sumSquares += value * value
    }
    return Math.min(1, Math.sqrt(sumSquares / data.length) * 3)
  }, [])

  const cancel = useCallback((): void => {
    sessionRef.current += 1
    const recorder = recorderRef.current
    // Detach before stop: stop dispatches an asynchronous event, which must not
    // send cancelled audio or release a newer recording's stream.
    if (recorder) {
      recorder.onstop = null
      recorder.ondataavailable = null
      if (recorder.state !== 'inactive') recorder.stop()
    }
    releaseStream()
    updateStatus('idle')
  }, [releaseStream, updateStatus])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cancel()
      if (errorTimerRef.current != null) {
        window.clearTimeout(errorTimerRef.current)
        errorTimerRef.current = null
      }
    }
  }, [cancel])

  const transcribeBlob = useCallback(async (blob: Blob, durationMs: number,
    intent: VoiceDictationIntent, session: number): Promise<void> => {
    try {
      if (!isCurrent(session)) return
      const wav = await encodeBlobAsWav(blob)
      // Encoding is asynchronous too. Do not dispatch audio after cancellation
      // or after navigating away from the composer that owns this capture.
      if (!isCurrent(session)) return
      const result = await window.kunGui.transcribeSpeech({
        audioBase64: wav.base64,
        mimeType: 'audio/wav',
        durationMs: Math.min(durationMs, SPEECH_TRANSCRIPTION_MAX_DURATION_MS),
        ...(speechToText ? { speechToText } : {})
      })
      if (!isCurrent(session)) return
      if (result.ok) onTextRef.current(result.text, intent)
      else showError(t('composerVoiceFailed', { message: result.message }))
    } catch (cause) {
      if (isCurrent(session)) {
        showError(t('composerVoiceFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
      }
    } finally {
      if (isCurrent(session)) updateStatus('idle')
    }
  }, [isCurrent, showError, speechToText, t, updateStatus])

  const start = useCallback((): void => {
    if (!mountedRef.current || statusRef.current !== 'idle') return
    const session = ++sessionRef.current
    updateStatus('starting')
    clearError()
    void (async () => {
      let stream: MediaStream | undefined
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (!isCurrent(session)) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        const mimeType = RECORDER_MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate))
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
        recorderRef.current = recorder
        const chunks: Blob[] = []
        recorder.ondataavailable = (event) => {
          if (isCurrent(session) && event.data.size > 0) chunks.push(event.data)
        }
        recorder.onstop = () => {
          if (!isCurrent(session)) return
          const durationMs = Date.now() - startedAtRef.current
          const intent = stopIntentRef.current
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
          releaseStream()
          if (durationMs < MIN_RECORDING_MS || blob.size === 0) {
            updateStatus('idle')
            showError(t('composerVoiceTooShort'))
            return
          }
          updateStatus('transcribing')
          void transcribeBlob(blob, durationMs, intent, session)
        }
        recorder.onerror = () => {
          if (!isCurrent(session)) return
          cancel()
          showError(t('composerVoiceFailed', { message: t('composerVoiceCaptureFailed') }))
        }
        try {
          const audioContext = new AudioContext()
          audioContextRef.current = audioContext
          const analyser = audioContext.createAnalyser()
          analyser.fftSize = 512
          analyser.smoothingTimeConstant = 0.55
          audioContext.createMediaStreamSource(stream).connect(analyser)
          analyserRef.current = analyser
          levelDataRef.current = new Uint8Array(new ArrayBuffer(analyser.fftSize))
        } catch {
          // The waveform is optional; a missing analyser must not block capture.
        }
        stopIntentRef.current = 'insert'
        startedAtRef.current = Date.now()
        setStartedAtMs(startedAtRef.current)
        recorder.start()
        updateStatus('recording')
        maxDurationTimerRef.current = window.setTimeout(() => {
          if (isCurrent(session) && recorder.state === 'recording') recorder.stop()
        }, SPEECH_TRANSCRIPTION_MAX_DURATION_MS)
      } catch (cause) {
        if (!isCurrent(session)) return
        cancel()
        const denied = cause instanceof DOMException &&
          (cause.name === 'NotAllowedError' || cause.name === 'SecurityError')
        showError(denied ? t('composerVoiceMicDenied')
          : t('composerVoiceFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
      }
    })()
  }, [cancel, clearError, isCurrent, releaseStream, showError, t, transcribeBlob, updateStatus])

  const stop = useCallback((intent: VoiceDictationIntent = 'insert'): void => {
    if (recorderRef.current?.state === 'recording') {
      stopIntentRef.current = intent
      recorderRef.current.stop()
    }
  }, [])

  const toggle = useCallback((): void => {
    if (statusRef.current === 'recording') stop()
    else if (statusRef.current === 'idle') start()
  }, [start, stop])

  return { status, error, clearError, startedAtMs, start, stop, toggle, cancel, getLevel }
}

/**
 * MediaRecorder yields webm/opus, but speech providers expect a plain
 * audio file. Decode and resample to mono 16 kHz 16-bit WAV, the common
 * denominator for OpenAI transcriptions and MiMo ASR.
 */
async function encodeBlobAsWav(blob: Blob): Promise<{ base64: string }> {
  const compressed = await blob.arrayBuffer()
  const decodeContext = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await decodeContext.decodeAudioData(compressed)
  } finally {
    void decodeContext.close()
  }
  const frameCount = Math.max(1, Math.ceil(decoded.duration * TRANSCRIPTION_SAMPLE_RATE))
  const offline = new OfflineAudioContext(1, frameCount, TRANSCRIPTION_SAMPLE_RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  const rendered = await offline.startRendering()
  const wavBytes = encodeWavPcm16(rendered.getChannelData(0), TRANSCRIPTION_SAMPLE_RATE)
  return { base64: bytesToBase64(wavBytes) }
}

function encodeWavPcm16(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataLength = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)
  const writeAscii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
  }
  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, dataLength, true)
  let offset = 44
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
    offset += 2
  }
  return new Uint8Array(buffer)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}
