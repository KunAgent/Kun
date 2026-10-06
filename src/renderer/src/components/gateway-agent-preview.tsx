import type { ReactElement } from 'react'
import type { TFunction } from 'i18next'
import { FileDiff, Loader2 } from 'lucide-react'
import type { AgentWiringPreview } from '@shared/agent-wiring'
import { settingsButtonClass } from './settings-button'

function shortPath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, '~').replace(/^[A-Z]:\\Users\\[^\\]+/i, '~')
}

function lineClass(line: string): string {
  if (line.startsWith('@@')) return 'text-ds-faint'
  if (line.startsWith('+')) return 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200'
  if (line.startsWith('-')) return 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-200'
  return 'text-ds-muted'
}

/** The config changes a connection would make, shown before anything is written. */
export function GatewayAgentPreview({ preview, agentName, busy, onConfirm, onCancel, t }: {
  preview: AgentWiringPreview
  agentName: string
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
  t: TFunction
}): ReactElement {
  return <div className="grid min-w-0 gap-2 rounded-xl border border-accent/40 bg-ds-main/60 p-3" data-gateway-agent-preview={preview.agentId}>
    <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ds-ink">
      <FileDiff className="h-4 w-4 text-accent" />{t('gatewayAgents.previewTitle', { agent: agentName })}
    </div>
    {preview.files.length ? <ul className="grid min-w-0 gap-2">
      {preview.files.map((file) => <li key={file.file} className="min-w-0 overflow-hidden rounded-lg border border-ds-border bg-ds-card">
        <div className="flex min-w-0 items-center gap-2 border-b border-ds-border px-2.5 py-1.5 text-[11px]">
          <span className="min-w-0 truncate font-mono text-ds-ink" title={file.file}>{shortPath(file.file)}</span>
          {file.created ? <span className="shrink-0 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">{t('gatewayAgents.previewNewFile')}</span> : null}
        </div>
        <pre className="max-h-64 overflow-auto px-0 py-1 font-mono text-[11px] leading-[18px]">
          {file.diff.split('\n').filter((line) => line && !line.startsWith('\\')).map((line, index) =>
            <div key={index} className={`whitespace-pre px-2.5 ${lineClass(line)}`}>{line}</div>)}
        </pre>
      </li>)}
    </ul> : <p className="text-[11.5px] text-ds-muted">{t('gatewayAgents.previewNoChanges')}</p>}
    <p className="text-[11px] leading-5 text-ds-faint">{t('gatewayAgents.previewHint')}</p>
    <div className="flex flex-wrap justify-end gap-1.5">
      <button type="button" className={settingsButtonClass({ variant: 'ghost' })} disabled={busy} onClick={onCancel}>{t('gatewayAgents.previewCancel')}</button>
      <button type="button" className={settingsButtonClass({ variant: 'primary' })} disabled={busy} onClick={onConfirm}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{t('gatewayAgents.previewConfirm')}</button>
    </div>
  </div>
}
