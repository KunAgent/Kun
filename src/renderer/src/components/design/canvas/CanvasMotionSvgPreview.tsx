import { FileCode2, Pause, Play, Repeat2, RotateCcw } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  controlSvgAnimationPreview,
  type SvgAnimationPreviewState
} from '../../../design/svg/svg-animation-preview-store'

function formatTime(timeMs: number): string {
  if (timeMs >= 1_000) return `${(timeMs / 1_000).toFixed(1)}s`
  return `${Math.round(timeMs)}ms`
}

export function CanvasMotionSvgPreview({
  preview,
  reducedMotion
}: {
  preview: SvgAnimationPreviewState
  reducedMotion: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const hasAnimations = preview.status === 'ready' && preview.animationCount > 0
  const displayedTime = preview.loopsIndefinitely
    ? preview.currentTimeMs % preview.durationMs
    : Math.min(preview.currentTimeMs, preview.durationMs)
  const status = preview.status === 'loading'
    ? t('canvasMotionSvgInspecting', 'Inspecting SVG animation…')
    : preview.status === 'missing'
      ? t('canvasMotionSvgMissing', 'The SVG source is missing.')
      : preview.status === 'invalid'
        ? t('canvasMotionSvgInvalid', 'The SVG animation could not be inspected.')
        : preview.animationCount === 0
          ? t('canvasMotionSvgNone', 'No internal SVG animation was detected.')
          : ''
  const guidance = t(
    'canvasMotionSvgGuidance',
    'Preview-only content animation. Container Motion presets move, scale, rotate, or fade the whole SVG.'
  )

  return (
    <section
      aria-label={t('canvasMotionSvgLane', 'SVG internal animation')}
      className="border-b border-ds-border-muted"
      data-motion-track-kind="svg-content"
    >
      <div className="grid h-6 grid-cols-[184px_minmax(420px,1fr)] bg-[linear-gradient(90deg,rgba(91,77,255,.06),rgba(56,189,248,.035))]">
        <div className="sticky left-0 z-[2] flex min-w-0 items-center gap-1.5 border-r border-ds-border-muted bg-white/96 px-2.5 dark:bg-ds-card/96">
          <FileCode2 className="h-3 w-3 shrink-0 text-accent" />
          <span className="truncate text-[9px] font-semibold uppercase tracking-[0.06em] text-ds-muted">
            {t('canvasMotionSvgLane', 'SVG internal animation')}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2 px-3 text-[9.5px] text-ds-faint">
          {hasAnimations ? (
            <>
              <span className="rounded-full bg-white/70 px-1.5 py-0.5 font-medium text-ds-muted dark:bg-white/8">
                {t('canvasMotionSvgCount', '{{count}} animations', { count: preview.animationCount })}
              </span>
              {preview.loopsIndefinitely ? (
                <span className="inline-flex items-center gap-1">
                  <Repeat2 className="h-2.5 w-2.5" />
                  {t('canvasMotionSvgLooping', 'Looping')}
                </span>
              ) : null}
              <span className="tabular-nums">
                {t('canvasMotionSvgCycle', '{{duration}} representative cycle', {
                  duration: formatTime(preview.durationMs)
                })}
              </span>
            </>
          ) : (
            <span className="truncate">{status}</span>
          )}
        </div>
      </div>

      <div className="grid h-10 grid-cols-[184px_minmax(420px,1fr)] bg-white/35 dark:bg-white/[0.015]">
        <div className="sticky left-0 z-[2] flex min-w-0 items-center gap-1.5 border-r border-ds-border-muted bg-white/96 px-2 dark:bg-ds-card/96">
          {hasAnimations ? (
            <>
              <button
                type="button"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px] text-ds-muted hover:bg-accent-soft hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => controlSvgAnimationPreview(preview.shapeId, {
                  type: preview.playing ? 'pause' : 'play'
                })}
                disabled={reducedMotion}
                title={reducedMotion
                  ? t('canvasMotionReducedShort', 'Automatic playback is disabled by reduced motion.')
                  : preview.playing
                    ? t('canvasMotionSvgPause', 'Pause SVG internal animation')
                    : t('canvasMotionSvgPlay', 'Play SVG internal animation')}
                aria-label={preview.playing
                  ? t('canvasMotionSvgPause', 'Pause SVG internal animation')
                  : t('canvasMotionSvgPlay', 'Play SVG internal animation')}
              >
                {preview.playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px] text-ds-faint hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => controlSvgAnimationPreview(preview.shapeId, { type: 'restart' })}
                disabled={reducedMotion}
                title={t('canvasMotionSvgRestart', 'Restart SVG internal animation')}
                aria-label={t('canvasMotionSvgRestart', 'Restart SVG internal animation')}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-ds-ink" title={preview.title}>
                {preview.title}
              </span>
              <span
                aria-label={guidance}
                className="shrink-0 rounded-full bg-ds-hover/60 px-1.5 py-0.5 text-[8.5px] font-medium uppercase tracking-[0.04em] text-ds-faint"
                title={guidance}
              >
                {t('canvasMotionSvgPreviewOnly', 'Preview only')}
              </span>
            </>
          ) : (
            <span className="truncate text-[10px] text-ds-muted" title={preview.title}>{preview.title}</span>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-2 px-3">
          {hasAnimations ? (
            <>
              <span className="w-[82px] shrink-0 text-right text-[9.5px] tabular-nums text-ds-faint">
                {formatTime(displayedTime)} / {formatTime(preview.durationMs)}
              </span>
              <input
                type="range"
                min={0}
                max={preview.durationMs}
                step={10}
                value={displayedTime}
                onChange={(event) => controlSvgAnimationPreview(preview.shapeId, {
                  type: 'seek',
                  timeMs: Number(event.target.value)
                })}
                className="canvas-inspector-range min-w-[120px] flex-1"
                aria-label={t('canvasMotionSvgPlayhead', 'SVG internal animation playhead')}
              />
              <select
                value={preview.rate}
                onChange={(event) => controlSvgAnimationPreview(preview.shapeId, {
                  type: 'set-rate',
                  rate: Number(event.target.value)
                })}
                className="h-6 rounded-[7px] bg-ds-hover/60 px-2 text-[10px] text-ds-muted outline-none"
                aria-label={t('canvasMotionSvgRate', 'SVG internal animation rate')}
              >
                <option value={0.5}>0.5×</option>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
              </select>
            </>
          ) : (
            <span className="truncate text-[10px] text-ds-faint">{status}</span>
          )}
        </div>
      </div>
    </section>
  )
}
