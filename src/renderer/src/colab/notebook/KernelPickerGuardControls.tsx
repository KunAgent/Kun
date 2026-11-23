import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ChevronDown, Shield } from 'lucide-react'
import type { ColabAccelerator, ColabUntrackedSession } from '@shared/colab/colab-types'
import { useColabNotebookStore } from './colab-notebook-store'

const selectField =
  'w-full rounded-[7px] border border-ds-border bg-ds-card px-2 py-1 text-[11.5px] text-ds-ink focus:border-accent focus:outline-none'
const numField =
  'w-full rounded-[7px] border border-ds-border bg-ds-card px-2 py-1 font-mono text-[11.5px] text-ds-ink placeholder:font-sans placeholder:text-ds-faint focus:border-accent focus:outline-none'

const RUNTIME_HOUR_OPTIONS = [0, 1, 2, 4, 8] as const
const IDLE_MINUTE_OPTIONS = [0, 15, 30, 60] as const

export function KernelLaunchGuardControls({
  accelerator,
  disabled
}: {
  accelerator: ColabAccelerator
  disabled: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const opts = useColabNotebookStore((s) => s.launchOptions)
  const patch = useColabNotebookStore((s) => s.patchLaunchOptions)
  const [expanded, setExpanded] = useState(false)

  const summaryParts: string[] = []
  if (opts.highMem) summaryParts.push(t('colabNb.guardsSummaryHighMem'))
  if (accelerator === 'A100' && opts.requireA10080Gb) {
    summaryParts.push(t('colabNb.guardsSummary80Gb'))
  }
  if (opts.maxRuntimeHours > 0) {
    summaryParts.push(t('colabNb.guardsSummaryMaxHours', { hours: opts.maxRuntimeHours }))
  }
  if (opts.idleAutoStopMinutes > 0) {
    summaryParts.push(t('colabNb.guardsSummaryIdleMin', { minutes: opts.idleAutoStopMinutes }))
  }
  if (opts.maxSpendCu != null && opts.maxSpendCu > 0) {
    summaryParts.push(t('colabNb.guardsSummarySpendCap', { cu: opts.maxSpendCu }))
  }
  if (opts.minBalanceCu != null && opts.minBalanceCu > 0) {
    summaryParts.push(t('colabNb.guardsSummaryFloor', { cu: opts.minBalanceCu }))
  }
  const summary =
    summaryParts.length > 0 ? summaryParts.join(' · ') : t('colabNb.guardsSummaryDefault')

  return (
    <div className="mt-2 rounded-[9px] border border-ds-border/80 bg-ds-main/50">
      <button
        type="button"
        data-colab-guards-toggle
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[11.5px] hover:bg-ds-hover/60"
      >
        <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-ds-ink">
          <Shield className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
          <span className="shrink-0">{t('colabNb.guardsToggleLabel')}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1 text-[11px] text-ds-muted">
          <span className="max-w-[185px] truncate">{summary}</span>
          <ChevronDown
            className={`h-3 w-3 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </span>
      </button>

      {expanded ? (
        <div
          data-colab-guards-panel
          className="space-y-2 border-t border-ds-border/70 px-2.5 py-2 text-[11.5px]"
        >
          <label className="flex cursor-pointer items-center justify-between gap-2">
            <span className="text-ds-ink">{t('colabNb.highMemLabel')}</span>
            <input
              type="checkbox"
              disabled={disabled}
              checked={opts.highMem}
              onChange={(e) => patch({ highMem: e.target.checked })}
              className="accent-accent"
            />
          </label>

          {accelerator === 'A100' ? (
            <label className="block space-y-1">
              <span className="text-[11px] text-ds-muted">{t('colabNb.minVramLabel')}</span>
              <select
                disabled={disabled}
                value={opts.requireA10080Gb ? '80' : 'any'}
                onChange={(e) => patch({ requireA10080Gb: e.target.value === '80' })}
                className={selectField}
              >
                <option value="any">{t('colabNb.minVramAny')}</option>
                <option value="80">{t('colabNb.minVram80Gb')}</option>
              </select>
            </label>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className="text-[11px] text-ds-muted">{t('colabNb.maxRuntimeLabel')}</span>
              <select
                disabled={disabled}
                value={String(opts.maxRuntimeHours)}
                onChange={(e) => patch({ maxRuntimeHours: Number(e.target.value) })}
                className={selectField}
              >
                {RUNTIME_HOUR_OPTIONS.map((hours) => (
                  <option key={hours} value={String(hours)}>
                    {hours === 0
                      ? t('colabNb.runtimeUnlimited')
                      : t('colabNb.runtimeHoursOpt', { hours })}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] text-ds-muted">{t('colabNb.idleStopLabel')}</span>
              <select
                disabled={disabled}
                value={String(opts.idleAutoStopMinutes)}
                onChange={(e) => patch({ idleAutoStopMinutes: Number(e.target.value) })}
                className={selectField}
              >
                {IDLE_MINUTE_OPTIONS.map((minutes) => (
                  <option key={minutes} value={String(minutes)}>
                    {minutes === 0
                      ? t('colabNb.idleStopOff')
                      : t('colabNb.idleMinutesOpt', { minutes })}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className="text-[11px] text-ds-muted">{t('colabNb.spendCapLabel')}</span>
              <input
                type="number"
                min={0.5}
                step={0.5}
                disabled={disabled}
                placeholder={t('colabNb.optionalPlaceholder')}
                value={opts.maxSpendCu ?? ''}
                onChange={(e) => {
                  const val = e.target.value.trim()
                  const parsed = val ? Number(val) : null
                  patch({
                    maxSpendCu: parsed !== null && Number.isFinite(parsed) && parsed > 0 ? parsed : null
                  })
                }}
                className={numField}
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] text-ds-muted">{t('colabNb.balanceFloorLabel')}</span>
              <input
                type="number"
                min={1}
                step={1}
                disabled={disabled}
                placeholder={t('colabNb.optionalPlaceholder')}
                value={opts.minBalanceCu ?? ''}
                onChange={(e) => {
                  const val = e.target.value.trim()
                  const parsed = val ? Number(val) : null
                  patch({
                    minBalanceCu:
                      parsed !== null && Number.isFinite(parsed) && parsed > 0 ? parsed : null
                  })
                }}
                className={numField}
              />
            </label>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function KernelUntrackedRuntimesSection({
  untracked,
  workspaceRoot
}: {
  untracked: ColabUntrackedSession[]
  workspaceRoot: string
}): ReactElement | null {
  const { t } = useTranslation('common')
  if (untracked.length === 0) return null
  return (
    <div
      data-colab-untracked-list
      className="mx-1.5 mt-1.5 space-y-1.5 rounded-[10px] border border-amber-500/35 bg-amber-500/[0.08] p-2.5 text-[11.5px]"
    >
      <div className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-200">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{t('colabNb.untrackedSectionTitle')}</span>
      </div>
      {untracked.map((item) => (
        <div
          key={`${item.connectionId}:${item.endpoint}`}
          className="flex items-center justify-between gap-2 rounded-lg bg-ds-card/80 px-2 py-1.5"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-ds-ink">
              {item.connectionName} · {item.accelerator}
            </div>
            <div className="truncate font-mono text-[10.5px] text-ds-muted">{item.remoteLabel}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {workspaceRoot ? (
              <button
                type="button"
                onClick={() =>
                  void window.kunGui.colabAdoptUntrackedSession({
                    connectionId: item.connectionId,
                    endpoint: item.endpoint,
                    workspaceRoot
                  })
                }
                className="rounded-md border border-ds-border bg-ds-card px-2 py-0.5 text-[11px] font-medium text-ds-ink hover:bg-ds-hover"
              >
                {t('colabNb.adoptShort')}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() =>
                void window.kunGui.colabStopUntrackedSession({
                  connectionId: item.connectionId,
                  endpoint: item.endpoint
                })
              }
              className="rounded-md bg-red-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-red-700"
            >
              {t('colabNb.stopBillingShort')}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
