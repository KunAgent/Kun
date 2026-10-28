import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useSpeakStore } from '../stores/speak-store'
import { stopSpeaking } from './chat/speak-controller'
import { speakErrorLabel } from './chat/AssistantSpeakButton'
import { formatBytes, formatTransferRate } from './settings-section-speech-to-text-support'
import { usePublishedToast } from '../toast/use-published-toast'
import type { ToastInput } from '../toast/toast-types'

/** How long a Speak failure stays in the dock before it clears itself. */
const ERROR_DISMISS_MS = 8_000

/**
 * Publishes Speak to the global dock: first-use asset download progress, the
 * "speaking now" card with its stop control, and failures that would
 * otherwise only appear as a tooltip on a hover-only action.
 */
export function SpeakDownloadToast(): ReactElement | null {
  const { t } = useTranslation('common')
  const phase = useSpeakStore((state) => state.phase)
  const download = useSpeakStore((state) => state.download)
  const error = useSpeakStore((state) => state.error ?? state.recordingNotice)
  const clearError = (): void => {
    useSpeakStore.getState().clearError()
    useSpeakStore.getState().setRecordingNotice(null)
  }

  let input: ToastInput | null = null
  if (download) {
    const percent = download.percent ?? (download.totalBytes
      ? Math.min(100, (download.downloadedBytes / download.totalBytes) * 100)
      : undefined)
    const title = download.asset === 'voice'
      ? t('speakDownloadingVoice', { voice: download.label })
      : t('speakDownloadingRuntime', { runtime: download.label })
    // formatBytes yields an empty string at zero, which would render a bare slash.
    const downloaded = formatBytes(download.downloadedBytes) || '0 MB'
    input = {
      id: 'speak',
      tone: 'running',
      title,
      description: t('speakDownloadingHint'),
      progress: {
        percent,
        label: title,
        detail: download.totalBytes ? `${downloaded} / ${formatBytes(download.totalBytes)}` : downloaded,
        trailing: formatTransferRate(download.speedBytesPerSecond, percent === undefined ? '' : `${Math.round(percent)}%`)
      },
      actions: [{ label: t('cancel'), run: () => stopSpeaking() }],
      durationMs: null
    }
  } else if (error) {
    input = {
      id: 'speak',
      tone: 'error',
      title: speakErrorLabel(t, error),
      durationMs: ERROR_DISMISS_MS,
      // Clearing the error is what closed this card before; keep it on any exit.
      onDismiss: clearError,
      ...(phase === 'idle' ? {} : { actions: [{ label: t('speakStop'), run: () => stopSpeaking() }] })
    }
  } else if (phase !== 'idle') {
    input = {
      id: 'speak',
      tone: 'running',
      title: t(phase === 'speaking' ? 'speakAnswer' : 'speakPreparing'),
      actions: [{ label: t('speakStop'), run: () => stopSpeaking() }],
      durationMs: null
    }
  }

  usePublishedToast(input)
  return null
}
