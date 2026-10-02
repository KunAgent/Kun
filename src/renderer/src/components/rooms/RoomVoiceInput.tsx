import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react'
import { LoaderCircle, Mic, Square, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSpeechToTextSettings, useVoiceDictation } from '../chat/use-voice-dictation'
import { shouldShowVoiceDictation } from '../chat/floating-composer-policy'
import { VoiceRecordingStrip } from '../chat/VoiceRecordingStrip'
import { ComposerInlineError } from '../chat/ComposerInlineError'
import type { RoomRichInputHandle } from './RoomRichInput'

export function useRoomVoiceInput(editor: RefObject<RoomRichInputHandle | null>, disabled: boolean) {
  const { speechToText, credentialReady } = useSpeechToTextSettings()
  const enabled = shouldShowVoiceDictation(speechToText, credentialReady)
  const allowed = useRef(enabled && !disabled)
  allowed.current = enabled && !disabled
  const [insertionPending, setInsertionPending] = useState(false)
  const dictation = useVoiceDictation({ speechToText, onText: (text) => {
    // This surface only inserts. It never uses Code's optional stop-and-send action.
    if (allowed.current) editor.current?.appendDictation(text)
  } })
  const cancel = dictation.cancel
  useEffect(() => {
    if (!enabled || disabled) {
      cancel()
      editor.current?.cancelDictation()
    }
  }, [cancel, disabled, editor, enabled])
  return { ...dictation, enabled, insertionPending, setInsertionPending,
    cancel: () => { cancel(); editor.current?.cancelDictation() } }
}

type VoiceInput = ReturnType<typeof useRoomVoiceInput>
export function RoomVoiceButton({ voice, disabled }: { voice: VoiceInput; disabled: boolean }): ReactElement | null {
  const { t } = useTranslation('common')
  if (!voice.enabled) return null
  const label = voice.status === 'recording' ? t('composerVoiceStop')
    : voice.status === 'starting' ? t('composerVoicePreparing')
      : voice.status === 'transcribing' ? t('composerVoiceTranscribing') : t('composerVoiceStart')
  return <button type="button" className="rooms-composer-voice" aria-label={label} title={label}
    aria-pressed={voice.status === 'recording'}
    disabled={disabled || voice.status === 'starting' || voice.status === 'transcribing'}
    onClick={() => voice.status === 'recording' ? voice.stop('insert') : voice.start()}>
    {voice.status === 'recording' ? <Square size={15} fill="currentColor" />
      : voice.status === 'idle' ? <Mic size={17} /> : <LoaderCircle size={17} className="animate-spin" />}
  </button>
}

export function RoomVoiceStatus({ voice }: { voice: VoiceInput }): ReactElement | null {
  const { t } = useTranslation('common')
  if (voice.status === 'idle' && !voice.error) return null
  return <div className="rooms-voice-status">
    {voice.status !== 'idle' ? <div className="rooms-voice-progress">
      <span role="status">{t(voice.status === 'recording' ? 'composerVoiceRecording'
        : voice.status === 'starting' ? 'composerVoicePreparing' : 'composerVoiceTranscribing')}</span>
      {voice.status === 'recording' ? <VoiceRecordingStrip getLevel={voice.getLevel} startedAtMs={voice.startedAtMs} /> : null}
      <button type="button" className="rooms-voice-cancel" onClick={voice.cancel}
        aria-label={t('composerVoiceCancel')} title={t('composerVoiceCancel')}><X size={16} /></button>
    </div> : null}
    {voice.error ? <ComposerInlineError message={voice.error} onDismiss={voice.clearError} dismissLabel={t('composerDismissError')} /> : null}
  </div>
}
