import type { ReactElement, ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { pageWindow } from './plugin-pagination'

type Translate = (key: string, values?: Record<string, unknown>) => string

const AVATAR_TONES = [
  'bg-[#eef2ff] text-[#3651cf] dark:bg-[#26304d] dark:text-[#b7c4ff]',
  'bg-[#f1edff] text-[#5443c2] dark:bg-[#2f2850] dark:text-[#c9bfff]',
  'bg-[#e8f6ef] text-[#0f7a42] dark:bg-[#1f3a2d] dark:text-[#8fe0b4]',
  'bg-[#fff3e3] text-[#a35a00] dark:bg-[#3d2f1c] dark:text-[#ffc985]',
  'bg-[#eaf4fb] text-[#1f6a96] dark:bg-[#1d3442] dark:text-[#9fd2f2]',
  'bg-[#fbecef] text-[#a8344c] dark:bg-[#40232b] dark:text-[#f5a9b9]'
]

function hashId(id: string): number {
  let hash = 0
  for (let index = 0; index < id.length; index++) hash = (hash * 31 + id.charCodeAt(index)) >>> 0
  return hash
}

/** Rounded-square initial avatar with a stable per-id tone. */
export function PluginAvatar({ id, title, size = 38 }: { id: string; title: string; size?: number }): ReactElement {
  const initial = Array.from(title.trim() || id)[0]?.toUpperCase() ?? '?'
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center font-bold ${AVATAR_TONES[hashId(id) % AVATAR_TONES.length]}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.27), fontSize: Math.round(size * 0.4) }}
    >
      {initial}
    </span>
  )
}

export type BadgeTone = 'market' | 'kun' | 'muted' | 'warn' | 'ok'

const BADGE_TONES: Record<BadgeTone, string> = {
  market: 'bg-ds-skill-soft text-[#5443c2] dark:text-[#c9bfff]',
  kun: 'bg-accent-soft text-[#3651cf] dark:text-[#b7c4ff]',
  muted: 'bg-ds-subtle text-ds-muted',
  warn: 'bg-[rgba(240,162,63,0.16)] text-[#a35a00] dark:text-[#ffc985]',
  ok: 'bg-ds-success-soft text-[#0f7a42] dark:text-[#8fe0b4]'
}

export function PluginBadge({ tone, children, title }: { tone: BadgeTone; children: ReactNode; title?: string }): ReactElement {
  return (
    <span title={title} className={`inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-md px-1.5 text-[11px] font-semibold ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  )
}

export type PillTone = 'ok' | 'warn' | 'error' | 'off'

const PILL_TONES: Record<PillTone, { box: string; dot: string }> = {
  ok: { box: 'bg-ds-success-soft text-[#0f7a42] dark:text-[#8fe0b4]', dot: 'bg-[#12a05a]' },
  warn: { box: 'bg-[rgba(240,162,63,0.16)] text-[#a35a00] dark:text-[#ffc985]', dot: 'bg-[#d97706]' },
  error: { box: 'bg-ds-danger-soft text-[#b8352c] dark:text-[#ffaaa3]', dot: 'bg-ds-danger' },
  off: { box: 'bg-ds-subtle text-ds-muted', dot: 'bg-ds-faint' }
}

export function StatusPill({ tone, children }: { tone: PillTone; children: ReactNode }): ReactElement {
  const style = PILL_TONES[tone]
  return (
    <span className={`inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-semibold ${style.box}`}>
      <span className={`h-[7px] w-[7px] rounded-full ${style.dot}`} />
      {children}
    </span>
  )
}

export function PluginSwitch({
  checked,
  disabled,
  label,
  title,
  tone = 'ink',
  onChange
}: {
  checked: boolean
  disabled?: boolean
  label: string
  title?: string
  tone?: 'ink' | 'skill'
  onChange: (next: boolean) => void
}): ReactElement {
  const on = tone === 'skill' ? 'bg-ds-skill' : 'bg-ds-ink'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-45 ${checked ? on : 'bg-[#d5d9e1] dark:bg-ds-border'}`}
    >
      <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-sm transition-all ${checked ? 'left-[19px]' : 'left-[3px]'}`} />
    </button>
  )
}

export function PluginPager({
  t,
  page,
  pageCount,
  start,
  end,
  total,
  pageSize,
  compact,
  onPage
}: {
  t: Translate
  page: number
  pageCount: number
  start: number
  end: number
  total: number
  pageSize: number
  compact?: boolean
  onPage: (page: number) => void
}): ReactElement | null {
  if (total === 0) return null
  const button = 'inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-ds-border bg-ds-card px-2 text-[13px] tabular-nums text-ds-ink transition hover:bg-ds-hover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-ds-card'
  return (
    <nav className="mt-4 flex flex-wrap items-center justify-between gap-3" aria-label={t('pluginsPagination')}>
      <span className="text-[12px] text-ds-muted">
        {t('pluginsRange', { start: start + 1, end, total })} · {t('pluginsPerPage', { count: pageSize })}
      </span>
      {pageCount > 1 ? (
        <div className="flex items-center gap-1">
          <button type="button" className={button} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('pluginsPrevPage')}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          {compact ? (
            <span className="px-2 text-[12.5px] tabular-nums text-ds-muted">{page} / {pageCount}</span>
          ) : (
            pageWindow(page, pageCount).map((token, index) => token === 'gap' ? (
              <span key={`gap-${index}`} className="px-1 text-ds-faint">…</span>
            ) : (
              <button
                key={token}
                type="button"
                aria-current={token === page ? 'page' : undefined}
                onClick={() => onPage(token)}
                className={token === page ? `${button} border-ds-ink bg-ds-ink text-white hover:bg-ds-ink dark:text-ds-main` : button}
              >
                {token}
              </button>
            ))
          )}
          <button type="button" className={button} disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label={t('pluginsNextPage')}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </nav>
  )
}

export const pluginButton = {
  base: 'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border border-ds-border bg-ds-card px-3.5 text-[13px] font-semibold text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55',
  dark: 'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border border-ds-ink bg-ds-ink px-3.5 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:border-[#c7cbd4] disabled:bg-[#c7cbd4] disabled:opacity-100 dark:text-ds-main',
  small: 'inline-flex h-[30px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-55',
  soft: 'bg-ds-subtle text-ds-ink hover:bg-ds-hover',
  warn: 'bg-[rgba(240,162,63,0.16)] text-[#a35a00] hover:opacity-85 dark:text-[#ffc985]',
  up: 'bg-accent-soft text-[#3651cf] hover:opacity-85 dark:text-[#b7c4ff]',
  done: 'bg-transparent text-ds-muted hover:bg-ds-subtle',
  danger: 'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-[10px] px-2.5 text-[13px] font-semibold text-ds-danger transition hover:bg-ds-danger-soft'
}
