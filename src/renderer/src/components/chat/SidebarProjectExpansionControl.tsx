import { ChevronUp } from 'lucide-react'
import type { ReactElement } from 'react'

type T = (key: string, options?: Record<string, unknown>) => string

export type SidebarProjectExpansionControlProps = {
  /** Rows that the next local expansion actually adds; 0 when exhausted. */
  nextThreadCount: number
  /** The project cursor can still serve the next remote page. */
  canLoadMore: boolean
  /** A remote page request for this project is in flight. */
  loading: boolean
  /** The project is currently expanded past its initial stage. */
  canCollapse: boolean
  onShowMore: () => void
  onLoadMore: () => void
  onCollapse: () => void
  t: T
}

const controlButtonClass = 'rounded-md px-2.5 py-1.5 text-[12.5px] text-ds-faint transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-wait disabled:opacity-60'

/**
 * Split the old single sidebar control into two single-purpose actions:
 * the primary "show next batch / load more" action and an independent collapse
 * action that is available whenever the project is past its initial stage,
 * even while a remote page is still loading.
 */
export function SidebarProjectExpansionControl(
  props: SidebarProjectExpansionControlProps
): ReactElement {
  const {
    nextThreadCount, canLoadMore, loading, canCollapse,
    onShowMore, onLoadMore, onCollapse, t
  } = props

  const primary = nextThreadCount > 0
    ? {
        key: 'show-more',
        label: t('sidebarWorkspaceShowMore', { count: nextThreadCount }),
        onClick: onShowMore
      }
    : canLoadMore
      ? {
          key: 'load-more',
          label: t('sidebarWorkspaceLoadMore'),
          onClick: onLoadMore
        }
      : null

  if (!primary && !canCollapse) return <></>

  return (
    <div className="ml-1 mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5">
      {primary ? (
        <button
          type="button"
          data-cursor-spotlight-target
          disabled={loading}
          aria-busy={loading}
          onClick={primary.onClick}
          className={controlButtonClass}
        >
          {loading
            ? t('sidebarWorkspaceLoading')
            : primary.label}
        </button>
      ) : null}
      {canCollapse ? (
        <button
          type="button"
          data-cursor-spotlight-target
          onClick={onCollapse}
          title={t('sidebarWorkspaceShowLess')}
          aria-label={t('sidebarWorkspaceShowLess')}
          className={`${controlButtonClass} inline-flex items-center gap-1`}
        >
          <ChevronUp className="h-3 w-3 shrink-0" strokeWidth={2} />
          <span className="whitespace-nowrap">{t('sidebarWorkspaceShowLess')}</span>
        </button>
      ) : null}
    </div>
  )
}
