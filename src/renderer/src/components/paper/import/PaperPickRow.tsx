import type { ReactElement, ReactNode } from 'react'
import { Check, Minus } from 'lucide-react'

/** Square checkbox shared by the recommendation card, the paper pool and group headers. */
export function PaperCheck({
  state,
  onToggle,
  label,
  disabled = false
}: {
  state: 'on' | 'off' | 'some'
  onToggle: () => void
  label: string
  disabled?: boolean
}): ReactElement {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === 'some' ? 'mixed' : state === 'on'}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      className={`grid h-[15px] w-[15px] shrink-0 place-items-center rounded-[4px] border-[1.5px] transition disabled:opacity-50 ${
        state === 'off'
          ? 'border-ds-border-strong bg-ds-main hover:border-[var(--ds-accent)]'
          : 'border-[var(--ds-accent)] bg-[var(--ds-accent)] text-white'
      }`}
    >
      {state === 'on' ? <Check className="h-2.5 w-2.5" strokeWidth={3.2} /> : null}
      {state === 'some' ? <Minus className="h-2.5 w-2.5" strokeWidth={3.2} /> : null}
    </button>
  )
}

export const PRIORITY_TONE: Record<string, string> = {
  must: 'bg-[var(--ds-accent-soft)] text-[var(--ds-accent)]',
  should: 'bg-ds-subtle text-ds-muted',
  optional: 'bg-ds-subtle/60 text-ds-faint'
}

/**
 * One paper in a pick list (card or pool): checkbox, priority + title, one
 * meta line, an optional one-line reason, an import-state line and hover-only
 * actions. `children` is the expanded detail.
 */
export function PaperPickRow({
  checked,
  onToggle,
  checkLabel,
  priority,
  title,
  meta,
  reason,
  status,
  actions,
  onOpen,
  open = false,
  highlighted = false,
  children
}: {
  checked: boolean
  onToggle: () => void
  checkLabel: string
  priority?: { label: string; tone: string }
  title: string
  meta: string
  reason?: string
  status?: ReactNode
  actions?: ReactNode
  onOpen?: () => void
  open?: boolean
  highlighted?: boolean
  children?: ReactNode
}): ReactElement {
  return (
    <li
      className={`group/row relative border-t border-ds-border-muted/70 px-3 py-2 transition first:border-t-0 ${
        open || highlighted ? 'bg-ds-subtle/60' : 'hover:bg-ds-hover/60'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-[3px]">
          <PaperCheck state={checked ? 'on' : 'off'} onToggle={onToggle} label={checkLabel} />
        </span>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onOpen ?? onToggle}
            aria-expanded={onOpen ? open : undefined}
            className="block w-full text-left"
          >
            <span className="line-clamp-2 text-[13px] font-medium leading-[18px] text-ds-ink">
              {priority ? (
                <span className={`mr-1.5 inline-block rounded px-1 align-[1px] text-[10.5px] font-semibold leading-[16px] ${priority.tone}`}>
                  {priority.label}
                </span>
              ) : null}
              {title}
            </span>
          </button>
          {meta ? <p className="mt-0.5 truncate text-[11.5px] text-ds-faint" title={meta}>{meta}</p> : null}
          {reason ? <p className="mt-0.5 truncate text-[12px] leading-[17px] text-ds-muted" title={reason}>{reason}</p> : null}
          {status ? <div className="mt-0.5 flex min-w-0 items-center">{status}</div> : null}
        </div>
        {actions ? (
          <div className="absolute right-2 top-1.5 hidden items-center gap-1 rounded-md bg-ds-main/95 group-hover/row:flex group-focus-within/row:flex">
            {actions}
          </div>
        ) : null}
      </div>
      {open && children ? <div className="mt-2 pl-[25px]">{children}</div> : null}
    </li>
  )
}
