import type { ReactElement } from 'react'
import { CircleCheck, Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { settingsButtonClass } from '../components/settings-button'
import { SettingRow } from '../components/settings-controls'
import { useColabStore } from './colab-store'

export function ColabRuntimeSetup({ inPanel = false }: { inPanel?: boolean }): ReactElement | null {
  const { t } = useTranslation('settings')
  const cli = useColabStore((state) => state.snapshot.cli)
  const hydrated = useColabStore((state) => state.hydrated)
  const prepareCli = useColabStore((state) => state.prepareCli)
  const ready = cli.state === 'ready'
  const installing = cli.state === 'installing'
  if (inPanel && !hydrated && cli.state === 'missing') return null

  let description = t('colabCliMissing')
  if (ready) description = t('colabCliReady', { version: cli.version, python: cli.pythonVersion })
  else if (installing) description = t('colabCliInstalling')
  else if (cli.state === 'error') description = t('colabCliError', { message: cli.message })

  if (inPanel && ready) {
    return (
      <div role="status" className="flex shrink-0 items-center gap-2 border-b border-ds-border px-3 py-2 text-[11.5px] text-ds-muted">
        <CircleCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
        <span>{t('colabCliTitle')} · {description}</span>
      </div>
    )
  }
  const control = (
    <button
      type="button"
      disabled={installing}
      aria-busy={installing}
      onClick={() => void prepareCli()}
      className={settingsButtonClass({
        variant: ready ? 'secondary' : 'primary',
        size: inPanel ? 'compact' : 'default'
      })}
    >
      {installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
      {t(ready ? 'colabCliUpdateBtn' : 'colabCliPrepareBtn')}
    </button>
  )

  if (!inPanel) return <SettingRow title="google-colab-cli" description={description} control={control} />
  return (
    <section className="shrink-0 border-b border-ds-border bg-ds-card px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[12.5px] font-semibold text-ds-ink">{t('colabCliTitle')}</h3>
        {control}
      </div>
      <p role="status" className="mt-1 max-h-24 overflow-y-auto break-words text-[11.5px] text-ds-muted">
        {description}
      </p>
    </section>
  )
}
