import { create } from 'zustand'
import type { LocalKokoroModelProgress } from '@shared/local-kokoro'

export type SpeakPhase =
  /** Nothing is speaking. */
  | 'idle'
  /** Preparing text, checking assets. */
  | 'preparing'
  /** Model or voice files are downloading. */
  | 'downloading'
  /** Synthesizing the first chunk; no audio yet. */
  | 'synthesizing'
  /** Audio is playing. */
  | 'speaking'

export type SpeakDownloadState = {
  asset: LocalKokoroModelProgress['asset']
  /** Human label for the asset being fetched. */
  label: string
  downloadedBytes: number
  totalBytes?: number
  percent?: number
  speedBytesPerSecond?: number
}

type SpeakStoreState = {
  /**
   * Whether the Speak answer action is turned on in settings. `null` until the
   * first settings read lands, so the action stays hidden rather than flashing.
   */
  enabled: boolean | null
  /** Assistant block currently owning playback; only one speaks at a time. */
  activeBlockId: string | null
  phase: SpeakPhase
  /** Progress card contents while assets download; null hides the card. */
  download: SpeakDownloadState | null
  /** Last failure, surfaced next to the Speak action. */
  error: string | null
  errorBlockId: string | null
  recordingNotice: string | null
  setRecordingNotice: (notice: string | null) => void
  /** Chunks finished / total, used for the inline progress hint. */
  progress: { spoken: number; total: number } | null
  setEnabled: (enabled: boolean) => void
  start: (blockId: string) => void
  setPhase: (phase: SpeakPhase) => void
  setDownload: (download: SpeakDownloadState | null) => void
  setProgress: (progress: { spoken: number; total: number } | null) => void
  fail: (error: string, blockId?: string) => void
  clearError: () => void
  reset: () => void
}

const IDLE = {
  activeBlockId: null,
  phase: 'idle' as SpeakPhase,
  download: null,
  progress: null
}

export const useSpeakStore = create<SpeakStoreState>((set) => ({
  ...IDLE,
  enabled: null,
  error: null,
  errorBlockId: null,
  recordingNotice: null,
  setRecordingNotice: (recordingNotice) => set({ recordingNotice }),
  setEnabled: (enabled) => set({ enabled }),
  start: (blockId) =>
    set({ activeBlockId: blockId, phase: 'preparing', download: null, progress: null, error: null, recordingNotice: null }),
  setPhase: (phase) => set((state) => (state.activeBlockId ? { phase } : state)),
  setDownload: (download) => set({ download }),
  setProgress: (progress) => set({ progress }),
  fail: (error, blockId) => set({ ...IDLE, error, errorBlockId: blockId ?? null }),
  clearError: () => set({ error: null }),
  reset: () => set({ ...IDLE })
}))

/** True when this block is the one currently being spoken. */
export function speakBusyPhase(phase: SpeakPhase): boolean {
  return phase !== 'idle'
}
