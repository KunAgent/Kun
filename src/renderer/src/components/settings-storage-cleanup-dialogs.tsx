import type { StorageCleanupPlan } from '@shared/storage-cleanup'
import { LoaderCircle, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { settingsButtonClass } from './settings-button'
import {
  STORAGE_REVIEW_ROWS_PER_KIND,
  formatBytes,
  formatStorageDay,
  groupPlanItems,
  selectedBytes
} from './settings-storage-cleanup-support'

type TranslateFn = (key: string, options?: Record<string, unknown>) => string

function DialogFrame({ title, onClose, closeLabel, children, footer, wide = false }: {
  title: string
  onClose: () => void
  closeLabel: string
  children: ReactNode
  footer: ReactNode
  wide?: boolean
}): ReactElement {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      className="ds-no-drag fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-sm dark:bg-black/55"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={`flex max-h-[90vh] w-full flex-col rounded-2xl border border-ds-border bg-ds-main shadow-2xl ${wide ? 'max-w-4xl' : 'max-w-xl'}`}>
        <div className="flex items-center justify-between gap-3 border-b border-ds-border-muted px-5 py-4">
          <div className="min-w-0 text-[17px] font-semibold text-ds-ink">{title}</div>
          <button type="button" className={settingsButtonClass({ variant: 'ghost', size: 'icon' })} onClick={onClose} aria-label={closeLabel}>
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ds-border-muted px-5 py-4">{footer}</div>
      </div>
    </div>
  )
}

export function StorageCleanupConsentDialog({ t, days, plan, busy, onCancel, onConfirm, onReview }: {
  t: TranslateFn
  days: number
  plan: StorageCleanupPlan | null
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
  onReview: () => void
}): ReactElement {
  const [agreed, setAgreed] = useState(false)
  const groups = plan ? groupPlanItems(plan) : []
  return (
    <DialogFrame
      title={t('storageCleanupConsentTitle')}
      onClose={onCancel}
      closeLabel={t('storageCleanupClose')}
      footer={(
        <>
          <button type="button" className={settingsButtonClass({ variant: 'link' })} onClick={onReview} disabled={!plan}>
            {t('storageCleanupPreview')}
          </button>
          <div className="flex gap-2">
            <button type="button" className={settingsButtonClass()} onClick={onCancel}>{t('storageCleanupCancel')}</button>
            <button type="button" className={settingsButtonClass({ variant: 'primary' })} disabled={!agreed || busy} onClick={onConfirm}>
              {t('storageCleanupConsentConfirm')}
            </button>
          </div>
        </>
      )}
    >
      <div className="flex flex-col gap-4 text-[13px] leading-5">
        <p className="text-ds-muted">
          {plan
            ? t('storageCleanupConsentBody', { days, size: formatBytes(plan.totalBytes) })
            : t('storageCleanupCalculating')}
        </p>
        <section className="overflow-hidden rounded-xl border border-ds-border">
          <div className="bg-amber-500/10 px-4 py-2 text-[12px] font-semibold text-amber-800 dark:text-amber-200">{t('storageCleanupConsentWill')}</div>
          {[
            { key: 'threadSlim', title: t('storageCleanupRuleThreads'), desc: t('storageCleanupRuleThreadsDesc') },
            { key: 'emptyWorktree', title: t('storageCleanupRuleWorktrees'), desc: t('storageCleanupRuleWorktreesDesc') },
            { key: 'trajectoryRecord', title: t('storageCleanupRuleTraces'), desc: t('storageCleanupRuleTracesDesc') }
          ].map((rule) => {
            const group = groups.find((entry) => entry.kind === rule.key)
            return (
              <div key={rule.key} className="flex justify-between gap-4 border-t border-ds-border-muted px-4 py-2.5">
                <div className="min-w-0">
                  <div className="font-medium text-ds-ink">{rule.title}</div>
                  <div className="text-[12px] text-ds-muted">{rule.desc}</div>
                </div>
                <div className="shrink-0 tabular-nums text-ds-muted">{group ? formatBytes(group.bytes) : plan ? '0 B' : '…'}</div>
              </div>
            )
          })}
        </section>
        <section className="rounded-xl bg-teal-500/10 px-4 py-3">
          <div className="text-[12px] font-semibold text-teal-800 dark:text-teal-200">{t('storageCleanupConsentWont')}</div>
          <div className="mt-1 text-ds-ink">{t('storageCleanupConsentWontBody')}</div>
        </section>
        <label className="flex items-start gap-2.5">
          <input type="checkbox" className="mt-1" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
          <span className="font-medium text-ds-ink">{t('storageCleanupConsentAgree')}</span>
        </label>
        <p className="text-[12px] text-ds-muted">{t('storageCleanupConsentReask')}</p>
      </div>
    </DialogFrame>
  )
}

export function StorageCleanupReviewDialog({ t, locale, days, plan, busy, onClose, onRun }: {
  t: TranslateFn
  locale: string
  days: number
  plan: StorageCleanupPlan | null
  busy: boolean
  onClose: () => void
  onRun: (itemIds: string[]) => void
}): ReactElement {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  useEffect(() => { setSelected(new Set(plan?.items.map((item) => item.id) ?? [])) }, [plan])
  const groups = useMemo(() => (plan ? groupPlanItems(plan) : []), [plan])
  const bytes = selectedBytes(plan, selected)
  const toggle = (ids: string[], on: boolean): void => {
    setSelected((current) => {
      const next = new Set(current)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }
  const skipped = plan?.skipped
  const skippedTotal = skipped ? skipped.pinned + skipped.active + skipped.room + skipped.goal : 0
  return (
    <DialogFrame
      wide
      title={t('storageCleanupReviewTitle', { days })}
      onClose={onClose}
      closeLabel={t('storageCleanupClose')}
      footer={(
        <>
          <div className="text-[14px] font-semibold text-ds-ink">{t('storageCleanupReviewSelected', { size: formatBytes(bytes) })}</div>
          <div className="flex gap-2">
            <button type="button" className={settingsButtonClass()} onClick={onClose}>{t('storageCleanupCancel')}</button>
            <button
              type="button"
              className={settingsButtonClass({ variant: 'primary' })}
              disabled={busy || selected.size === 0}
              onClick={() => onRun([...selected])}
            >
              {busy ? t('storageCleanupRunning') : t('storageCleanupReviewRun', { size: formatBytes(bytes) })}
            </button>
          </div>
        </>
      )}
    >
      {!plan ? (
        <div className="flex items-center gap-2 py-10 text-[13px] text-ds-muted">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          {t('storageCleanupCalculating')}
        </div>
      ) : (
        <div className="flex flex-col gap-4 text-[13px]">
          <p className="text-ds-muted">{t('storageCleanupReviewDesc')}</p>
          {skippedTotal > 0 ? (
            <div className="rounded-xl bg-teal-500/10 px-3 py-2 text-[12px] text-teal-800 dark:text-teal-200">
              {t('storageCleanupReviewSkipped', skipped)}
            </div>
          ) : null}
          {plan.truncated ? <div className="text-[12px] text-ds-muted">{t('storageCleanupReviewTruncated')}</div> : null}
          {groups.length === 0 ? <div className="py-6 text-ds-muted">{t('storageCleanupReviewEmpty')}</div> : null}
          {groups.map((group) => {
            const ids = group.items.map((item) => item.id)
            const allOn = ids.every((id) => selected.has(id))
            const hidden = group.items.length - STORAGE_REVIEW_ROWS_PER_KIND
            return (
              <section key={group.kind} className="overflow-hidden rounded-xl border border-ds-border">
                <label className="flex items-center justify-between gap-3 bg-ds-subtle/50 px-4 py-2.5">
                  <span className="flex items-center gap-2.5 font-semibold text-ds-ink">
                    <input type="checkbox" checked={allOn} onChange={(event) => toggle(ids, event.target.checked)} />
                    {t(`storageCleanupKind_${group.kind}`)}
                    <span className="font-normal text-ds-muted">{group.items.length}</span>
                  </span>
                  <span className="tabular-nums font-semibold text-ds-ink">{formatBytes(group.bytes)}</span>
                </label>
                <ul className="max-h-72 divide-y divide-ds-border-muted overflow-y-auto">
                  {group.items.slice(0, STORAGE_REVIEW_ROWS_PER_KIND).map((item) => (
                    <li key={item.id}>
                      <label className="grid grid-cols-[20px_minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-2">
                        <input type="checkbox" checked={selected.has(item.id)} onChange={(event) => toggle([item.id], event.target.checked)} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ds-ink">{item.title}</span>
                          {item.detail ? <span className="block truncate text-[12px] text-ds-muted">{item.detail}</span> : null}
                        </span>
                        <span className="text-[12px] text-ds-muted">{formatStorageDay(item.updatedAt, locale)}</span>
                        <span className="w-20 text-right tabular-nums text-ds-ink">{formatBytes(item.bytes)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                {hidden > 0 ? (
                  <div className="border-t border-ds-border-muted px-4 py-2 text-[12px] text-ds-muted">{t('storageCleanupReviewMore', { n: hidden })}</div>
                ) : null}
              </section>
            )
          })}
        </div>
      )}
    </DialogFrame>
  )
}
