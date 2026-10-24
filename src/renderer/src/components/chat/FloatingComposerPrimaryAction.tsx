import type { ReactElement } from 'react'
import { ArrowUp, Loader2, Send, Square } from 'lucide-react'
import type { ComposerPrimaryActionKind } from './floating-composer-policy'

type Translate = (key: string, options?: Record<string, unknown>) => string

const BASE_CLASS =
  'ds-composer-primary-action ds-no-drag flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint/45'

/**
 * Composer send / queue / stop control.
 * - interrupt (running, empty draft): quiet grey circle with an ink square,
 *   tooltip "停止（Esc）"; Esc in the editor does the same.
 * - queue (running, draft present): dark circle with ↑; the send queues the
 *   draft (tooltip from `label`, which still reflects slash / goal actions).
 * - submit (idle): dark circle with the send glyph, spinner while connecting.
 */
export function FloatingComposerPrimaryAction({
  kind,
  label,
  disabled,
  loading,
  onInterrupt,
  onSubmit,
  t
}: {
  kind: ComposerPrimaryActionKind
  label: string
  disabled: boolean
  loading: boolean
  onInterrupt: () => void
  onSubmit: () => void
  t: Translate
}): ReactElement {
  if (kind === 'interrupt') {
    return (
      <button
        type="button"
        onClick={onInterrupt}
        data-primary-action="interrupt"
        className={`${BASE_CLASS} ds-composer-stop-action`}
        aria-label={t('interrupt')}
        aria-keyshortcuts="Escape"
        title={t('composerDock.stopWithShortcut')}
      >
        <Square className="h-3 w-3 fill-current" strokeWidth={2.4} aria-hidden="true" />
      </button>
    )
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSubmit}
      data-primary-action={kind}
      className={`${BASE_CLASS} bg-control text-control-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:bg-ds-card disabled:text-ds-faint`}
      aria-label={label}
      title={label}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 motion-safe:animate-spin" strokeWidth={2.2} aria-hidden="true" />
      ) : kind === 'queue' ? (
        <ArrowUp className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
      ) : (
        <Send className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
      )}
    </button>
  )
}
