import type { ReactElement } from 'react'
import type { CoreMemoryDiagnosticsJson } from '../agent/kun-contract'
import { SettingRow } from './settings-controls'

type Props = {
  diagnostics: CoreMemoryDiagnosticsJson | null | undefined
  fallbackRecordCount: number
  t: (key: string) => string
}

export function MemoryDiagnosticsPanel({ diagnostics, fallbackRecordCount, t }: Props): ReactElement {
  const retrieval = diagnostics?.lastRetrieval
  const rankings = retrieval?.rankings.slice(0, 8) ?? []
  const indexState = diagnostics?.indexState ?? 'filesystem'
  return (
    <>
      <SettingRow
        title={t('memoryOverview')}
        description={t('memoryOverviewDesc')}
        wideControl
        control={
          <div className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
            <Metric label={t('memoryActiveCount')} value={diagnostics?.activeCount ?? fallbackRecordCount} />
            <Metric label={t('memoryTombstoneCount')} value={diagnostics?.tombstoneCount ?? 0} />
            <Metric label={t('memoryIndexState')} value={t(`memoryIndexState_${indexState}`)} />
            <Metric
              label={t('memoryIndexCoverage')}
              value={`${diagnostics?.indexedCount ?? 0}/${diagnostics?.canonicalCount ?? fallbackRecordCount}`}
            />
          </div>
        }
      />

      {diagnostics?.backfill?.running || diagnostics?.degradedReason ? (
        <SettingRow
          title={diagnostics.degradedReason ? t('memoryDegraded') : t('memoryBackfill')}
          description={diagnostics.degradedReason ?? t('memoryBackfillDesc')}
          wideControl
          control={
            diagnostics.degradedReason ? (
              <div className="rounded-lg border border-amber-300/60 bg-amber-50/70 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-700/50 dark:bg-amber-500/10 dark:text-amber-200">
                {diagnostics.degradedReason}
              </div>
            ) : (
              <div className="font-mono text-[12px] text-ds-faint">
                {diagnostics.backfill?.scanned ?? 0} / {(diagnostics.backfill?.scanned ?? 0) + (diagnostics.backfill?.remaining ?? 0)}
              </div>
            )
          }
        />
      ) : null}

      {retrieval ? (
        <SettingRow
          title={t('memoryLastRetrieval')}
          description={`${retrieval.mode} · ${retrieval.selectedCharacters}/${retrieval.promptCharacterBudget} ${t('memoryCharacters')}`}
          wideControl
          control={
            <div className="space-y-1.5">
              {rankings.length === 0 ? (
                <div className="text-[12px] text-ds-faint">{t('memoryNoRankings')}</div>
              ) : rankings.map((ranking) => (
                <div
                  key={ranking.memoryId}
                  className={`grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-lg border px-2.5 py-2 text-[11px] ${ranking.selected ? 'border-ds-ink/25 bg-ds-hover/50' : 'border-ds-border-muted bg-ds-main/30'}`}
                >
                  <div className="min-w-0">
                    <div className="truncate font-mono text-ds-ink">{ranking.memoryId}</div>
                    <div className="mt-0.5 text-ds-faint">
                      {ranking.channel} · L {ranking.features.lexical.toFixed(2)} · F {ranking.features.freshness.toFixed(2)} · C {ranking.features.confidence.toFixed(2)} · I {ranking.features.importance.toFixed(2)}
                    </div>
                  </div>
                  <div className="font-mono font-semibold text-ds-ink">
                    {ranking.features.finalScore.toFixed(3)}
                  </div>
                </div>
              ))}
            </div>
          }
        />
      ) : null}

      {diagnostics?.lastInjectedIds?.length ? (
        <SettingRow
          title={t('memoryLastInjected')}
          description={t('memoryLastInjectedDesc')}
          wideControl
          control={
            <div className="flex flex-wrap gap-1.5">
              {diagnostics.lastInjectedIds.map((id) => (
                <span key={id} className="rounded-lg bg-ds-hover/50 px-2 py-0.5 font-mono text-[11px] text-ds-faint">
                  {id.slice(0, 12)}
                </span>
              ))}
            </div>
          }
        />
      ) : null}
    </>
  )
}

function Metric({ label, value }: { label: string; value: string | number }): ReactElement {
  return (
    <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
      <div className="text-ds-faint">{label}</div>
      <div className="mt-0.5 truncate font-mono text-[15px] font-semibold text-ds-ink">{value}</div>
    </div>
  )
}
