import { useMemo, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { createTwoFilesPatch } from 'diff'
import type { ToolBlock } from '../../agent/types'
import { DiffView } from '../DiffView'

/** Tool evidence has its own fields; final output never replaces the input. */
export function AcpToolDetail({ block }: { block: ToolBlock }): ReactElement {
  const { t } = useTranslation('common')
  const meta = block.meta ?? {}
  const diffs = useMemo(() => records(meta.acpDiffs).flatMap((diff) => {
    if (typeof diff.path !== 'string' || typeof diff.newText !== 'string') return []
    const before = typeof diff.oldText === 'string' ? diff.oldText : ''
    const patch = createTwoFilesPatch(diff.path, diff.path, before, diff.newText, '', '', { context: 3, timeout: 50, maxEditLength: 4000 })
    return [{ path: diff.path, patch, after: diff.newText }]
  }), [meta.acpDiffs])
  const terminals = records(meta.acpTerminals)
  const body = text(meta.acpFileContent) ?? outputBody(meta.acpOutput) ?? text(meta.acpText)
  const command = text(meta.command)
  const isReadSummary = meta.acpKind === 'read' && !meta.acpFileContent && /^\d+\s+lines?\s*$/i.test(body?.trim() ?? '')
  return (
    <div className="flex min-w-0 flex-col gap-3 text-[12px] text-ds-ink" data-acp-tool-detail>
      {block.filePath ? <div className="break-all font-mono text-ds-muted">{block.filePath}{typeof meta.acpLine === 'number' ? `:${meta.acpLine}` : ''}</div> : null}
      {meta.cwd ? <div className="break-all text-ds-muted">{t('acpTool.cwd')}: {String(meta.cwd)}</div> : null}
      {command ? <CodeText text={`$ ${command}`} /> : null}
      {diffs.map((diff, index) => <div key={`${diff.path}:${index}`}>{diff.patch ? <DiffView patch={diff.patch} filePath={diff.path} /> : <><div className="mb-1 font-mono text-ds-muted">{diff.path}</div><CodeText text={diff.after} /></>}</div>)}
      {terminals.map((terminal, index) => (
        <div key={String(terminal.terminalId ?? index)} className="min-w-0 space-y-1">
          {!command && text(terminal.command) ? <CodeText text={`$ ${terminal.command}`} /> : null}
          {text(terminal.output) ? <CodeText text={String(terminal.output)} /> : null}
          {typeof terminal.exitCode === 'number' ? <div className="text-ds-muted">{t('acpTool.exitCode', { code: terminal.exitCode })}</div> : null}
        </div>
      ))}
      {body && terminals.length === 0 && diffs.length === 0 ? <CodeText text={body} /> : null}
      {isReadSummary ? <div className="text-ds-muted">{t('acpTool.summaryOnly')}</div> : null}
      {!body && !diffs.length && !terminals.length ? <div className="text-ds-muted">{t(block.status === 'running' ? 'acpTool.waiting' : 'acpTool.noOutput')}</div> : null}
      {meta.acpTruncated ? <div className="text-ds-muted">{t('acpTool.truncated')}</div> : null}
      {meta.acpInput !== undefined ? <details className="text-ds-muted"><summary className="w-fit cursor-pointer select-none">{t('acpTool.input')}</summary><div className="mt-2"><CodeText text={format(meta.acpInput)} /></div></details> : null}
      {meta.acpOutput !== undefined && (diffs.length > 0 || body !== format(meta.acpOutput)) ? <details className="text-ds-muted"><summary className="w-fit cursor-pointer select-none">{t('acpTool.rawOutput')}</summary><div className="mt-2"><CodeText text={format(meta.acpOutput)} /></div></details> : null}
    </div>
  )
}

function CodeText({ text: value }: { text: string }): ReactElement {
  return <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ds-hover/40 px-3 py-2 font-mono text-[12px] leading-6 text-ds-ink">{value}</pre>
}
function text(value: unknown): string | undefined { return typeof value === 'string' && value.length ? value : undefined }
function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === 'object') : []
}
function format(value: unknown): string { return typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '' }
function outputBody(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return undefined
  const obj = value as Record<string, unknown>
  return text(obj.content) ?? text(obj.output) ?? text(obj.text) ?? (Object.keys(obj).length ? format(obj) : undefined)
}
