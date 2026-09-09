import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Download, Loader2 } from 'lucide-react'
import { localKokoroTrackFileName } from '@shared/local-kokoro-tracks'
import {
  ensureSpeakTrackKeys,
  speakTrackStored,
  useSpeakTrackStore
} from '../../stores/speak-track-store'
import { useSpeakEnabled } from './use-speak-enabled'
import { speakTrackKeyFor } from './speak-controller'
import { loadSpeakSettings, type SpeakSettings } from './speak-assets'

/**
 * Saves the recording kept for an answer to the user's device.
 *
 * It appears only once the audio actually exists on disk, so it is a promise
 * the app can keep: what it saves is the file that was already produced, not a
 * new synthesis.
 */
export function AssistantSpeakTrackButton({
  text,
  createdAt
}: {
  text: string
  createdAt?: string
}): ReactElement | null {
  const { t } = useTranslation('common')
  const speakEnabled = useSpeakEnabled()
  const keys = useSpeakTrackStore((state) => state.keys)
  const [settings, setSettings] = useState<SpeakSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Nothing touches the preload bridge at render time; the settings and the
  // stored keys are both resolved after mount.
  useEffect(() => {
    let cancelled = false
    ensureSpeakTrackKeys()
    void loadSpeakSettings().then((next) => {
      if (!cancelled) setSettings(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!saved) return undefined
    const timer = window.setTimeout(() => setSaved(false), 2_000)
    return () => window.clearTimeout(timer)
  }, [saved])

  const trackKey = settings?.keepTracks ? speakTrackKeyFor(text, settings) : null
  if (speakEnabled !== true || !settings?.keepTracks) return null
  if (!speakTrackStored(keys, trackKey) || !trackKey) return null

  const onClick = async (): Promise<void> => {
    if (saving || typeof window.kunGui?.exportLocalKokoroTrack !== 'function') return
    setSaving(true)
    setError('')
    try {
      const result = await window.kunGui.exportLocalKokoroTrack({
        key: trackKey,
        fileName: localKokoroTrackFileName(createdAt)
      })
      if (result.ok) setSaved(true)
      else if (!result.canceled) setError(result.message ?? '')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSaving(false)
    }
  }

  const label = error
    ? t('speakTrackSaveFailed', { message: error })
    : saved
      ? t('speakTrackSaved')
      : t('speakTrackDownload')

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      title={label}
      aria-label={label}
      data-speak-track-state={error ? 'error' : saved ? 'saved' : saving ? 'saving' : 'ready'}
      className={`flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 transition hover:bg-ds-hover ${
        error ? 'text-rose-400 hover:text-rose-300' : 'text-ds-faint hover:text-ds-muted'
      }`}
    >
      {saving ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
      ) : saved ? (
        <Check className="h-3.5 w-3.5" strokeWidth={2} />
      ) : (
        <Download className="h-3.5 w-3.5" strokeWidth={1.8} />
      )}
      <span>{saved ? t('speakTrackSaved') : t('speakTrackDownload')}</span>
    </button>
  )
}
