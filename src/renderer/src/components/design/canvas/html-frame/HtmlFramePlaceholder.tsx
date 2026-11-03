import { Brush, RotateCcw } from 'lucide-react'

type GenerationFailedNoticeProps = {
  onRetry?: () => void
  retryDisabled?: boolean
}

/** A screen whose generation turn failed: say so and offer a way out. */
export function GenerationFailedNotice({
  onRetry,
  retryDisabled
}: GenerationFailedNoticeProps): React.JSX.Element {
  return (
    <div className="pointer-events-auto flex flex-col items-center gap-2 text-center">
      <span className="text-[12px] font-semibold text-red-600 dark:text-red-300">
        生成失败，页面没有写入完整内容
      </span>
      {onRetry ? (
        <button
          type="button"
          disabled={retryDisabled}
          onClick={(event) => {
            event.stopPropagation()
            onRetry()
          }}
          className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-white/90 px-3 py-1 text-[11px] font-semibold text-accent transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#20252e] dark:text-[#aeb8ff]"
        >
          <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
          重新生成此屏幕
        </button>
      ) : null}
    </div>
  )
}

type Props = {
  transparentGeneratingSurface: boolean
  drawingActive: boolean
  placeholderPreview: boolean
  previewError: string
  failedMessage: string
  hasArtifact: boolean
  drawingLabel: string
  screenWidth: number
  generationFailed?: boolean
  onRetry?: () => void
  retryDisabled?: boolean
}

export function HtmlFramePlaceholder({
  transparentGeneratingSurface,
  drawingActive,
  placeholderPreview,
  previewError,
  failedMessage,
  hasArtifact,
  drawingLabel,
  screenWidth,
  generationFailed,
  onRetry,
  retryDisabled
}: Props): React.JSX.Element {
  if (generationFailed) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <GenerationFailedNotice onRetry={onRetry} retryDisabled={retryDisabled} />
      </div>
    )
  }
  return (
    <div
      className={
        transparentGeneratingSurface
          ? 'flex h-full w-full items-start justify-center p-3 text-ds-muted'
          : 'flex h-full w-full items-center justify-center text-ds-faint'
      }
    >
      <div
        className={
          transparentGeneratingSurface
            ? 'flex max-w-[70%] items-center gap-1.5 rounded-full border border-accent/25 bg-white/90 px-3 py-1.5 text-center text-[11px] font-semibold text-accent shadow-[0_10px_30px_rgba(20,47,95,0.12)] backdrop-blur-md dark:border-accent/45 dark:bg-[#20252e] dark:text-[#aeb8ff]'
            : 'flex flex-col items-center gap-2 text-center'
        }
        style={{ fontSize: Math.min(16, Math.max(12, screenWidth * 0.018)) }}
      >
        {drawingActive ? (
          <Brush className="h-5 w-5 animate-pulse text-accent" strokeWidth={1.8} aria-hidden="true" />
        ) : null}
        <span>
          {previewError || failedMessage || (hasArtifact ? (drawingActive ? drawingLabel : (placeholderPreview ? 'Preview generation is incomplete' : 'No preview content')) : 'No content')}
        </span>
      </div>
    </div>
  )
}
