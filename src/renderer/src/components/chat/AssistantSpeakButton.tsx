import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Square, Volume2 } from 'lucide-react'
import { useSpeakStore, type SpeakPhase } from '../../stores/speak-store'
import { useSpeakEnabled } from './use-speak-enabled'
import { speakAnswer, stopSpeaking } from './speak-controller'

/** Error values the controller reports as locale keys rather than raw text. */
const SPEAK_ERROR_KEYS = new Set([
  'speakUnavailable',
  'speakUnsupportedLanguage',
  'speakTrackNotSaved',
  'speakNothingToRead',
  'speakModelMissing',
  'speakVoiceMissing',
  'speakFailed'
])

export function speakErrorLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  error: string
): string {
  if (!error) return ''
  if (SPEAK_ERROR_KEYS.has(error)) return t(error)
  return t('speakFailed', { message: error })
}

/**
 * The action shows only once the bridge is confirmed and the settings toggle is
 * known to be on. An unresolved toggle keeps it hidden so it cannot flash in
 * and out on startup.
 */
export function speakButtonVisible(available: boolean, enabled: boolean | null): boolean {
  return available && enabled === true
}

function phaseLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  phase: SpeakPhase
): string {
  if (phase === 'downloading') return t('speakDownloading')
  if (phase === 'synthesizing') return t('speakSynthesizing')
  if (phase === 'speaking') return t('speakStop')
  if (phase === 'preparing') return t('speakPreparing')
  return t('speakAnswer')
}

/**
 * Speak action rendered beside the other answer actions. While this answer is
 * the active one the button becomes a stop control, and a spinner sits in the
 * icon slot for as long as speech is still being produced.
 */
export function AssistantSpeakButton({
  blockId,
  text
}: {
  blockId: string
  text: string
}): ReactElement | null {
  const { t } = useTranslation('common')
  const activeBlockId = useSpeakStore((state) => state.activeBlockId)
  const phase = useSpeakStore((state) => state.phase)
  const error = useSpeakStore((state) => state.errorBlockId === blockId ? state.error : null)
  const progress = useSpeakStore((state) => state.progress)
  const clearError = useSpeakStore((state) => state.clearError)
  const speakEnabled = useSpeakEnabled()
  const [available, setAvailable] = useState(false)

  // The bridge is absent in server-rendered tests, so nothing is touched at
  // render time; availability is resolved after mount.
  useEffect(() => {
    setAvailable(typeof window !== 'undefined' && typeof window.kunGui?.synthesizeLocalKokoroSpeech === 'function')
  }, [])

  if (!speakButtonVisible(available, speakEnabled)) return null

  const active = activeBlockId === blockId
  const busy = active && phase !== 'idle'
  const playing = active && phase === 'speaking'
  const showError = Boolean(error) && !busy
  const label = active ? phaseLabel(t, phase) : t('speakAnswer')
  const title = showError ? speakErrorLabel(t, error ?? '') : label

  const onClick = (): void => {
    if (busy) {
      stopSpeaking()
      return
    }
    clearError()
    void speakAnswer(blockId, text)
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-busy={busy && !playing}
      data-speak-state={busy ? phase : showError ? 'error' : 'idle'}
      className={`flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 transition hover:bg-ds-hover ${
        showError
          ? 'text-rose-400 hover:text-rose-300'
          : busy
            ? 'text-accent'
            : 'text-ds-faint hover:text-ds-muted'
      }`}
    >
      {playing ? (
        <Square className="h-3.5 w-3.5" strokeWidth={2} />
      ) : busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
      ) : (
        <Volume2 className="h-3.5 w-3.5" strokeWidth={1.8} />
      )}
      <span>{label}</span>
      {playing && progress && progress.total > 1 ? (
        <span className="tabular-nums text-[10.5px] opacity-70">
          {progress.spoken}/{progress.total}
        </span>
      ) : null}
    </button>
  )
}
