import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AdeHarnessReadiness } from '@shared/ade-harnesses'

type Row = NonNullable<AdeHarnessReadiness['diagnostics']>[number]

const MARK: Record<Row['status'], { glyph: string; className: string }> = {
  ok: { glyph: '✓', className: 'text-ds-status-success' },
  warn: { glyph: '!', className: 'text-ds-status-warning' },
  error: { glyph: '✗', className: 'text-ds-status-danger' },
  info: { glyph: '•', className: 'text-ds-status-muted' }
}

/** What the readiness check found for each stage: command, version, network, sign-in, session and models. */
export function AgentDiagnosticRows({ rows }: { rows: readonly Row[] }): ReactElement {
  const { t } = useTranslation('common')
  return <dl className="grid grid-cols-[auto_auto_minmax(0,1fr)] gap-x-2 gap-y-1" data-agent-diagnostics>
    {rows.map((row) => <div key={row.id} className="contents" data-agent-diagnostic={row.id} data-status={row.status}>
      <span aria-hidden="true" className={MARK[row.status].className}>{MARK[row.status].glyph}</span>
      <dt className="whitespace-nowrap text-ds-ink">{t(`agentEnablement.diagnostics.${row.id}`)}</dt>
      <dd className="min-w-0 break-words">{row.value}</dd>
    </div>)}
  </dl>
}
