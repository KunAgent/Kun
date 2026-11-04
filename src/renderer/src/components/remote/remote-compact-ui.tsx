import { ChevronLeft, ChevronRight, LockKeyhole, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'

export const REMOTE_FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50'
export const REMOTE_DETAIL_TEXT = 'text-[12px] leading-[18px] text-ds-muted'

export function RemoteCompactRow({ icon: Icon, title, subtitle, locked, onOpen, children }: {
  icon?: LucideIcon
  title: string
  subtitle?: ReactNode
  locked?: boolean
  onOpen?: () => void
  children?: ReactNode
}) {
  const content = <>
    {Icon ? <Icon size={17} aria-hidden className={`shrink-0 ${locked ? 'text-ds-faint' : 'text-ds-muted'}`} /> : null}
    <span className="min-w-0 flex-1">
      <span className={`block text-[13px] font-medium leading-5 ${locked ? 'text-ds-faint' : 'text-ds-ink'}`}>{title}</span>
      {subtitle ? <span className="mt-px flex items-start gap-1 text-[12px] leading-4 text-ds-muted">
        {locked ? <LockKeyhole size={11} className="mt-0.5 shrink-0" aria-hidden /> : null}
        <span>{subtitle}</span>
      </span> : null}
    </span>
    {onOpen ? <ChevronRight size={14} aria-hidden className="shrink-0 text-ds-faint" /> : null}
  </>
  return <div className="flex min-h-[56px] items-center gap-2 px-3 py-2">
    {onOpen ? <button type="button" onClick={onOpen} className={`-m-1 flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left ${REMOTE_FOCUS}`}>
      {content}
    </button> : <div className="flex min-w-0 flex-1 items-center gap-3">{content}</div>}
    {children}
  </div>
}

export function RemoteDetailHeader({ title, onBack, children }: { title: string; onBack(): void; children?: ReactNode }) {
  const { t } = useTranslation('common')
  return <header className="flex min-h-8 items-center gap-1">
    <button type="button" onClick={onBack} aria-label={t('remoteCompact.back')}
      className={`-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ds-muted hover:bg-ds-hover ${REMOTE_FOCUS}`}>
      <ChevronLeft size={18} />
    </button>
    <h2 className="min-w-0 flex-1 text-[16px] font-semibold text-ds-ink">{title}</h2>
    {children}
  </header>
}

export function RemoteDisclosure({ title, value, children, open = false }: {
  title: string; value?: string; children: ReactNode; open?: boolean
}) {
  return <details className="group" open={open || undefined}>
    <summary className={`flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-[13px] [&::-webkit-details-marker]:hidden ${REMOTE_FOCUS}`}>
      <span className="flex-1 font-medium text-ds-ink">{title}</span>
      {value ? <span className="min-w-0 max-w-[60%] truncate text-[12px] text-ds-muted">{value}</span> : null}
      <ChevronRight size={14} className="shrink-0 text-ds-faint group-open:rotate-90" aria-hidden />
    </summary>
    <div className="border-t border-ds-border-muted">{children}</div>
  </details>
}
