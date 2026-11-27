import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { COLAB_ACCELERATOR_SPECS, COLAB_RESOURCE_INTERVAL_MS, type ColabSessionView } from '@shared/colab/colab-types'

export function ColabResourceSummary({ session, onDetails }: {
  session: ColabSessionView
  onDetails: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), COLAB_RESOURCE_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])
  const history = session.resourceHistory
  const sample = history?.[history.length - 1]
  const stale = sample && now - sample.at > COLAB_RESOURCE_INTERVAL_MS * 3
  const capacity = (used?: number | null, total?: number | null): string =>
    used == null ? '—' : `${used.toFixed(1)} / ${total == null ? '—' : total.toFixed(1)} GiB`
  const rows = COLAB_ACCELERATOR_SPECS[session.accelerator].kind === 'gpu'
    ? [[t('colab.gpuLoad'), sample?.gpuPct == null ? '—' : `${sample.gpuPct}%`],
       ['GPU VRAM', capacity(sample?.vramUsedGiB, sample?.vramTotalGiB)]] : []
  rows.push(['RAM', capacity(sample?.ramUsedGiB, sample?.ramTotalGiB)])
  return <section className="my-2 space-y-1.5 border-y border-ds-border py-2 text-xs">
    <dl className="space-y-1">{rows.map(([label, value]) => <div key={label} className="flex justify-between gap-2">
      <dt className="text-ds-muted">{label}</dt><dd className="font-mono text-ds-ink">{value}</dd>
    </div>)}</dl>
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="text-ds-muted">{sample ? `${stale ? t('colab.staleSample') : t('colab.lastSample')} · ${new Date(sample.at).toLocaleTimeString()}` : t('colab.awaitSample')}</span>
      <button type="button" className="inline-flex items-center gap-1 rounded text-accent hover:underline" onClick={onDetails}>{t('colab.resourceTrends')}<ChevronRight size={12} aria-hidden="true" /></button>
    </div>
  </section>
}
