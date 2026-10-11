import { useCallback, useEffect, useRef, useState } from 'react'
import {
  LOCAL_SANOTTS_LICENSE,
  LOCAL_SANOTTS_MODEL_REPO,
  LOCAL_SANOTTS_RUNTIME_ID,
  LOCAL_SANOTTS_RUNTIME_LABEL,
  LOCAL_SANOTTS_RUNTIME_SIZE_BYTES,
  type LocalSanottsRuntimeStatus,
  type LocalSanottsVoiceStatus
} from '@shared/local-sanotts'
import { LOCAL_SANOTTS_VOICES, localSanottsVoiceById, type LocalSanottsVoiceId } from '@shared/local-sanotts-voices'

type VoiceStatuses = Partial<Record<LocalSanottsVoiceId, LocalSanottsVoiceStatus>>

export function initialSpeakRuntimeStatus(): LocalSanottsRuntimeStatus {
  return {
    runtimeId: LOCAL_SANOTTS_RUNTIME_ID,
    label: LOCAL_SANOTTS_RUNTIME_LABEL,
    source: LOCAL_SANOTTS_MODEL_REPO,
    license: LOCAL_SANOTTS_LICENSE,
    sizeBytes: LOCAL_SANOTTS_RUNTIME_SIZE_BYTES,
    state: 'not_downloaded'
  }
}

export function initialSpeakVoiceStatus(voiceId: LocalSanottsVoiceId): LocalSanottsVoiceStatus {
  return { voiceId, sizeBytes: localSanottsVoiceById(voiceId).sizeBytes, state: 'not_downloaded' }
}

/** Apply byte events locally; only reconcile active transfers at a bounded rate. */
export function useSpeakAssetStatuses(voiceId: LocalSanottsVoiceId) {
  const [runtime, setRuntime] = useState<LocalSanottsRuntimeStatus | null>(null)
  const [voices, setVoices] = useState<VoiceStatuses>({})
  const current = useRef({ runtime, voices })
  const mounted = useRef(false)
  const revisions = useRef(new Map<string, number>())
  const inFlight = useRef(new Map<string, Promise<void>>())

  const updateRuntime = useCallback((status: LocalSanottsRuntimeStatus): void => {
    if (!mounted.current) return
    revisions.current.set('runtime', (revisions.current.get('runtime') ?? 0) + 1)
    current.current.runtime = status
    setRuntime(status)
  }, [])
  const updateVoice = useCallback((status: LocalSanottsVoiceStatus): void => {
    if (!mounted.current) return
    revisions.current.set(status.voiceId, (revisions.current.get(status.voiceId) ?? 0) + 1)
    current.current.voices = { ...current.current.voices, [status.voiceId]: status }
    setVoices(current.current.voices)
  }, [])

  // A read started before a progress event or action result must not roll it back.
  const readStatus = useCallback((key: string, read: () => Promise<void>): Promise<void> => {
    const pending = inFlight.current.get(key)
    if (pending) return pending
    const task = read().catch(() => undefined).finally(() => {
      if (inFlight.current.get(key) === task) inFlight.current.delete(key)
    })
    inFlight.current.set(key, task)
    return task
  }, [])
  const refreshRuntime = useCallback((): Promise<void> => readStatus('runtime', async () => {
    if (typeof window.kunGui?.getLocalSanottsRuntimeStatus !== 'function') return
    const revision = revisions.current.get('runtime')
    const status = await window.kunGui.getLocalSanottsRuntimeStatus()
    if (revisions.current.get('runtime') === revision) updateRuntime(status)
  }), [readStatus, updateRuntime])
  const refreshVoice = useCallback((id: LocalSanottsVoiceId): Promise<void> => readStatus(id, async () => {
    if (typeof window.kunGui?.getLocalSanottsVoiceStatus !== 'function') return
    const revision = revisions.current.get(id)
    const status = await window.kunGui.getLocalSanottsVoiceStatus(id)
    if (revisions.current.get(id) === revision) updateVoice(status)
  }), [readStatus, updateVoice])
  const refreshStatuses = useCallback(async (): Promise<void> => {
    await Promise.all([refreshRuntime(), refreshVoice(voiceId)])
  }, [refreshRuntime, refreshVoice, voiceId])

  useEffect(() => {
    mounted.current = true
    void refreshRuntime()
    for (const voice of LOCAL_SANOTTS_VOICES) void refreshVoice(voice.id)
    const unsubscribe = window.kunGui?.onLocalSanottsAssetProgress?.((progress) => {
      if (progress.asset === 'runtime') {
        updateRuntime({
          ...(current.current.runtime ?? initialSpeakRuntimeStatus()),
          state: 'downloading', message: undefined,
          downloadedBytes: progress.downloadedBytes,
          totalBytes: progress.totalBytes,
          speedBytesPerSecond: progress.speedBytesPerSecond
        })
      } else if (progress.voiceId) {
        updateVoice({
          ...initialSpeakVoiceStatus(progress.voiceId),
          state: 'downloading',
          downloadedBytes: progress.downloadedBytes,
          totalBytes: progress.totalBytes,
          speedBytesPerSecond: progress.speedBytesPerSecond
        })
      }
    })
    return () => { mounted.current = false; unsubscribe?.() }
  }, [refreshRuntime, refreshVoice, updateRuntime, updateVoice])

  useEffect(() => { void refreshVoice(voiceId) }, [refreshVoice, voiceId])

  const activeKeys = [
    ...(runtime?.state === 'downloading' ? ['runtime'] : []),
    ...LOCAL_SANOTTS_VOICES.filter((voice) => voices[voice.id]?.state === 'downloading').map((voice) => voice.id)
  ].join(',')
  useEffect(() => {
    if (!activeKeys) return
    const timer = setInterval(() => {
      if (current.current.runtime?.state === 'downloading') void refreshRuntime()
      for (const voice of LOCAL_SANOTTS_VOICES) {
        if (current.current.voices[voice.id]?.state === 'downloading') void refreshVoice(voice.id)
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [activeKeys, refreshRuntime, refreshVoice])

  return { runtime, voices, refreshStatuses, updateRuntime, updateVoice }
}
