import type { ReactElement } from 'react'
import { Pause, Play, RotateCcw, Sparkles, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CanvasMotionPlaybackMode } from '../../../design/motion'
import { useCanvasMotionStore } from '../../../design/motion/canvas-motion-store'

type CanvasMotionTransportProps = {
  frameName: string
  playing: boolean
  reducedMotion: boolean
  hasTimeline: boolean
  currentTimeMs: number
  durationMs: number
  playback: CanvasMotionPlaybackMode
  rate: number
  timelineZoom: number
  autoKey: boolean
  onTogglePlayback: () => void
  onConfigure: (configuration: {
    durationMs?: number
    playback?: CanvasMotionPlaybackMode
  }) => void
}

export function CanvasMotionTransport({
  frameName,
  playing,
  reducedMotion,
  hasTimeline,
  currentTimeMs,
  durationMs,
  playback,
  rate,
  timelineZoom,
  autoKey,
  onTogglePlayback,
  onConfigure
}: CanvasMotionTransportProps): ReactElement {
  const { t } = useTranslation('common')

  return (
    <>
      <header
        className="flex h-12 shrink-0 items-center gap-1.5 border-b border-ds-border-muted px-2.5"
        data-motion-transport="container"
      >
        <div className="flex w-[148px] shrink-0 items-center gap-2 px-1">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px] bg-accent-soft text-accent">
            <Sparkles className="h-3 w-3" />
          </span>
          <div className="min-w-0 leading-tight">
            <div className="text-[10px] font-semibold text-ds-ink">{t('canvasMotionMode', 'Motion')}</div>
            <div className="truncate text-[8.5px] text-ds-faint" title={frameName}>{frameName}</div>
          </div>
        </div>
        <span className="mx-0.5 h-5 w-px shrink-0 bg-ds-border-muted" />
        <button
          type="button"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] bg-accent text-white shadow-sm hover:opacity-90 disabled:bg-ds-hover disabled:text-ds-faint disabled:shadow-none"
          onClick={onTogglePlayback}
          disabled={!hasTimeline || reducedMotion}
          title={playing ? t('canvasMotionPause', 'Pause') : t('canvasMotionPlay', 'Play')}
          aria-label={playing ? t('canvasMotionPause', 'Pause') : t('canvasMotionPlay', 'Play')}
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-ds-faint hover:bg-ds-hover hover:text-ds-ink"
          onClick={() => {
            useCanvasMotionStore.getState().setPlaying(false)
            useCanvasMotionStore.getState().setDirection(1)
            useCanvasMotionStore.getState().setCurrentTimeMs(0)
          }}
          title={t('canvasMotionReset', 'Reset')}
          aria-label={t('canvasMotionReset', 'Reset')}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <span className="w-[94px] shrink-0 text-center text-[10px] tabular-nums text-ds-muted">
          {Math.round(currentTimeMs)} / {Math.round(durationMs)} ms
        </span>
        <input
          type="range"
          min={0}
          max={durationMs}
          step={1}
          value={Math.min(currentTimeMs, durationMs)}
          onChange={(event) => {
            useCanvasMotionStore.getState().setPlaying(false)
            useCanvasMotionStore.getState().setCurrentTimeMs(Number(event.target.value))
          }}
          className="canvas-inspector-range min-w-[100px] flex-1"
          aria-label={t('canvasMotionPlayhead', 'Motion playhead')}
        />
        <label className="hidden shrink-0 items-center gap-1 min-[980px]:flex">
          <span className="hidden text-[9px] text-ds-faint min-[1180px]:inline">
            {t('canvasMotionDuration', 'Duration')}
          </span>
          <span className="flex h-7 items-center rounded-[7px] bg-ds-hover/55 px-1.5">
            <input
              key={durationMs}
              type="number"
              min={1}
              max={600000}
              defaultValue={durationMs}
              onBlur={(event) => onConfigure({ durationMs: Number(event.target.value) })}
              className="w-[52px] bg-transparent text-right text-[10px] tabular-nums text-ds-ink outline-none"
            />
            <span className="ml-1 text-[8.5px] text-ds-faint">ms</span>
          </span>
        </label>
        <select
          value={playback}
          onChange={(event) => onConfigure({ playback: event.target.value as CanvasMotionPlaybackMode })}
          className="hidden h-7 shrink-0 rounded-[7px] bg-ds-hover/55 px-2 text-[10px] text-ds-muted outline-none min-[900px]:block"
          aria-label={t('canvasMotionPlaybackMode', 'Playback mode')}
        >
          <option value="once">{t('canvasMotionOnce', 'Once')}</option>
          <option value="loop">{t('canvasMotionLoop', 'Loop')}</option>
          <option value="ping-pong">{t('canvasMotionPingPong', 'Ping-pong')}</option>
        </select>
        <select
          value={rate}
          onChange={(event) => useCanvasMotionStore.getState().setRate(Number(event.target.value))}
          className="hidden h-7 shrink-0 rounded-[7px] bg-ds-hover/55 px-2 text-[10px] text-ds-muted outline-none min-[820px]:block"
          aria-label={t('canvasMotionPlaybackRate', 'Playback rate')}
        >
          <option value={0.5}>0.5×</option>
          <option value={1}>1×</option>
          <option value={2}>2×</option>
        </select>
        <label className="hidden shrink-0 items-center gap-1 text-[9px] text-ds-faint min-[1120px]:flex">
          <span>{t('canvasMotionZoom', 'Zoom')}</span>
          <input
            type="range"
            min={0.5}
            max={4}
            step={0.25}
            value={timelineZoom}
            onChange={(event) => useCanvasMotionStore.getState().setTimelineZoom(Number(event.target.value))}
            className="w-14"
            aria-label={t('canvasMotionTimelineZoom', 'Timeline zoom')}
          />
        </label>
        <button
          type="button"
          className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[8px] px-2 text-[9.5px] font-medium transition ${
            autoKey ? 'bg-accent-soft text-accent' : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
          }`}
          onClick={() => useCanvasMotionStore.getState().setAutoKey(!autoKey)}
          aria-pressed={autoKey}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${autoKey ? 'bg-accent' : 'bg-ds-faint/60'}`} />
          {t('canvasMotionAutoKey', 'Auto-key')}
        </button>
        <button
          type="button"
          className="grid h-7 w-7 place-items-center rounded-[8px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
          onClick={() => useCanvasMotionStore.getState().setOpen(false)}
          title={t('canvasMotionClose', 'Close Motion')}
          aria-label={t('canvasMotionClose', 'Close Motion')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      {reducedMotion ? (
        <div className="shrink-0 border-b border-ds-border-muted bg-amber-500/8 px-3 py-1 text-[10px] text-amber-700 dark:text-amber-300">
          {t('canvasMotionReduced', 'Reduced motion is enabled. Scrubbing remains available; automatic playback is paused.')}
        </div>
      ) : null}
    </>
  )
}
