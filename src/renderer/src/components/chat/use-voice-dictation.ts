import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CUSTOM_SPEECH_TO_TEXT_PROVIDER_ID,
  resolveKunSpeechToTextSettings,
  type AppSettingsV1,
  type KunPromptOptimizationSettingsV1,
  type KunSpeechToTextSettingsV1
} from '@shared/app-settings'
import { getKunRuntimeSettings } from '@shared/app-settings-kun-defaults'
import type { SpeechTranscriptionRequest, SpeechTranscriptionResult } from '@shared/speech-to-text'
import { useVoiceCapture, type VoiceDictationIntent } from './use-voice-capture'
export type { VoiceDictationIntent, VoiceDictationStatus } from './use-voice-capture'
import { SETTINGS_CHANGED_EVENT } from '../../lib/keyboard-shortcut-settings'
import {
  connectionCredentialStateById,
  fetchSharedModelConnectionCredentialStates,
  providerHasUsableCredential
} from '../../lib/provider-credential-readiness'

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

export function useVoiceDictation({ onText, speechToText, transcribe }: {
  onText: (text: string, intent: VoiceDictationIntent) => void
  speechToText?: KunSpeechToTextSettingsV1 | null
  transcribe?: (request: SpeechTranscriptionRequest) => Promise<SpeechTranscriptionResult>
}): ReturnType<typeof useVoiceCapture> {
  const { t } = useTranslation('common')
  const transport = useCallback((request: SpeechTranscriptionRequest) =>
    transcribe ? transcribe(request) : window.kunGui.transcribeSpeech({ ...request, ...(speechToText ? { speechToText } : {}) }),
  [transcribe, speechToText])
  const messages = useMemo(() => ({
    failed: (message: string) => t('composerVoiceFailed', { message }),
    tooShort: t('composerVoiceTooShort'), micDenied: t('composerVoiceMicDenied'), captureFailed: t('composerVoiceCaptureFailed')
  }), [t])
  return useVoiceCapture({ onText, transcribe: transport, messages })
}
