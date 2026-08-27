import type { ReactElement } from 'react'
import { AlertTriangle, X } from 'lucide-react'

/**
 * Dismissible inline error row for the composer (voice dictation, prompt
 * optimization). Long upstream messages clamp to two lines; the full text
 * stays available via the title tooltip.
 */
export function ComposerInlineError({
  message,
  onDismiss,
  dismissLabel
}: {
  message: string
  onDismiss: () => void
  dismissLabel: string
}): ReactElement {
  return (
    <div className="px-1" role="alert">
      <div className="flex items-start gap-1.5">
        <AlertTriangle
          className="mt-[1px] h-3.5 w-3.5 shrink-0 text-red-500 dark:text-red-300"
          strokeWidth={2}
          aria-hidden
        />
        <span
          className="line-clamp-2 min-w-0 flex-1 break-words text-[12px] font-medium leading-[1.45] text-red-600 dark:text-red-300"
          title={message}
        >
          {message}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          title={dismissLabel}
          className="ds-no-drag -mr-0.5 shrink-0 rounded-full p-0.5 text-red-400/90 transition hover:bg-red-500/10 hover:text-red-600 dark:text-red-300/70 dark:hover:text-red-200"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
