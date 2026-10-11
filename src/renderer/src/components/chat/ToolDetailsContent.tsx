import { useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, FileText } from 'lucide-react'
import { createTwoFilesPatch } from 'diff'
import type { ToolPresentation, ToolPresentationContent, ToolPresentationSearchResult } from '@shared/tool-presentation'
import { DiffView } from '../DiffView'
import { previewWorkspaceFile } from '../../lib/workspace-file-preview'
import { validateFileReference } from '../../lib/file-reference-validation'
import { extractUnifiedDiffText } from '../../lib/diff-stats'
import { ToolCodeEvidence } from './ToolCodeEvidence'
import { ToolBinaryEvidence } from './ToolBinaryEvidence'
import { formatToolEvidence, toolEvidenceImage, toolEvidenceUrl } from './tool-evidence-content'

export type ToolDetailsContentProps = {
  presentation: ToolPresentation
  workspaceRoot?: string
  expanded?: boolean
}

/** Shared by tool rows and approvals. Evidence never executes HTML or fetches remote media. */
export function ToolDetailsContent({ presentation: p, workspaceRoot = '', expanded = false }: ToolDetailsContentProps): ReactElement {
  const { t } = useTranslation('common')
  const [showAllResults, setShowAllResults] = useState(false)
  const [showAllContent, setShowAllContent] = useState(false)
  const [diffPages, setDiffPages] = useState(1)
  const [terminalPages, setTerminalPages] = useState(1)
  const diffLimit = (expanded ? 20 : 5) * diffPages
  const diffs = useMemo(() => (p.diffs ?? []).slice(0, diffLimit).map((diff) => ({ ...diff,
    patch: createTwoFilesPatch(diff.path, diff.path, diff.oldText ?? '', diff.newText, '', '', {
      context: 3, timeout: 50, maxEditLength: 4_000
    })
  })), [p.diffs, diffLimit])
  const legacyPatch = !diffs.length && ['edit', 'write', 'delete', 'move', 'fs.write'].includes(p.kind)
    ? p.patch ?? extractUnifiedDiffText(p.text ?? (typeof p.output === 'string' ? p.output : '')) : undefined
  const text = p.text?.trim() ?? ''
  const explanation = legacyPatch ? text.replace(legacyPatch, '').trim() : text
  const body = p.fileContent ?? (p.kind === 'read' || p.kind === 'write' ? text : undefined)
  const hasFileBody = p.fileContent !== undefined || Boolean(body)
  const summaryOnly = p.kind === 'read' && p.fileContent === undefined && /^\d+\s+lines?\s*$/i.test(text)
  const terminals = p.terminals ?? []
  const shownTerminals = terminals.slice(0, (expanded ? 20 : 5) * terminalPages)
  const results = p.results ?? []
  const content = p.content ?? []
  const fileLocations = p.locations?.length ? p.locations.map((location) => ({
    ...location, line: location.line ?? (location.path === p.filePath ? p.line : undefined)
  })) : p.filePath ? [{ path: p.filePath, line: p.line }] : []
  const textIsShown = body === text && Boolean(body) || terminals.some((terminal) => terminal.output.trim() === text) || legacyPatch === text ||
    content.some((item) => (item.text ?? item.resource?.text)?.trim() === text) ||
    (p.kind === 'read' && p.fileContent !== undefined && /^\d+\s+lines?\s*$/i.test(text))
  const hasSemanticBody = Boolean(hasFileBody || text || diffs.length || legacyPatch || terminals.length || results.length || content.length)
  const initialRows = expanded ? 100 : 20
  const shownResults = showAllResults ? results : results.slice(0, initialRows)
  const shownContent = showAllContent ? content : content.slice(0, expanded ? 40 : 10)
  return (
    <div className="flex min-w-0 flex-col gap-3 text-[12px] text-ds-ink" data-tool-details-content data-tool-kind={p.kind}>
      {p.server || (['unknown', 'mcp'].includes(p.kind) && p.name) ? <div className="break-all font-mono text-ds-muted" data-tool-identity>{[p.server, p.name].filter(Boolean).join(' / ')}</div> : null}
      {fileLocations.length ? <div className="flex flex-wrap gap-2">{fileLocations.map((location, index) => (
        <ToolFileLink key={`${location.path}:${index}`} path={location.path} line={location.line} workspaceRoot={workspaceRoot} />
      ))}</div> : null}
      {p.offset !== undefined || p.limit !== undefined ? <div className="text-ds-muted">
        {p.offset !== undefined ? `${t('toolDetails.offset')}: ${p.offset}` : ''}
        {p.limit !== undefined ? ` ${t('toolDetails.limit')}: ${p.limit}` : ''}
      </div> : null}
      {p.cwd ? <div className="break-all text-ds-muted">{t('toolDetails.cwd')}: <span className="font-mono">{p.cwd}</span></div> : null}
      {p.query ? <div className="whitespace-pre-wrap break-words"><span className="text-ds-muted">{t('toolDetails.query')}: </span>{p.query}</div> : null}
      {p.url ? <ToolExternalLink url={p.url}>{p.url}</ToolExternalLink> : null}
      {p.statusCode !== undefined ? <div className={p.statusCode >= 400 ? 'text-orange-700 dark:text-orange-300' : 'text-ds-muted'}>{t('toolDetails.status', { code: p.statusCode })}</div> : null}
      {p.command ? <ToolCodeEvidence text={`$ ${p.command}`} language="shell" expanded={expanded} /> : null}
      {hasFileBody ? <ToolCodeEvidence text={body ?? ''} filePath={p.filePath} numbered={!summaryOnly} startLine={p.line ?? 1} expanded={expanded} /> : null}
      {summaryOnly ? <div className="text-ds-muted">{t('toolDetails.summaryOnly')}</div> : null}
      {diffs.map((diff, index) => <div key={`${diff.path}:${index}`} data-tool-diff>
        {diff.patch ? <DiffView patch={diff.patch} filePath={diff.path} maxHeight={expanded ? 640 : 320} />
          : <ToolCodeEvidence text={diff.newText} filePath={diff.path} numbered expanded={expanded} />}
      </div>)}
      {diffs.length < (p.diffs?.length ?? 0) ? <ShowMore onClick={() => setDiffPages((value) => value + 1)} /> : null}
      {legacyPatch ? <DiffView patch={legacyPatch} filePath={p.filePath} maxHeight={expanded ? 640 : 320} /> : null}
      {shownTerminals.map((terminal, index) => <section key={`${terminal.terminalId}:${index}`} className="flex min-w-0 flex-col gap-2" data-tool-terminal={terminal.terminalId}>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-ds-muted">
          <span className="font-mono">{terminal.terminalId}</span>
          {terminal.exitCode !== undefined && terminal.exitCode !== null ? <span>{t('toolDetails.exit', { code: terminal.exitCode })}</span> : null}
          {terminal.signal ? <span>{t('toolDetails.signal', { signal: terminal.signal })}</span> : null}
        </div>
        {terminal.cwd && terminal.cwd !== p.cwd ? <div className="break-all text-ds-muted">{t('toolDetails.cwd')}: {terminal.cwd}</div> : null}
        {terminal.command && terminal.command !== p.command ? <ToolCodeEvidence text={`$ ${terminal.command}`} language="shell" expanded={expanded} /> : null}
        {terminal.output ? <ToolCodeEvidence text={terminal.output} expanded={expanded} /> : null}
        {terminal.truncated ? <p className="text-ds-muted">{t('toolDetails.truncated')}</p> : null}
      </section>)}
      {shownTerminals.length < terminals.length ? <ShowMore onClick={() => setTerminalPages((value) => value + 1)} /> : null}
      {results.length ? <section className="min-w-0 overflow-hidden rounded-lg border border-ds-border-muted" data-tool-search-results>
        <div className="border-b border-ds-border-muted px-3 py-2 font-medium">{t('toolDetails.matches')} · {results.length}</div>
        <div className="divide-y divide-ds-border-muted">{shownResults.map((result, index) => <ToolSearchResult key={index} result={result} workspaceRoot={workspaceRoot} />)}</div>
        {shownResults.length < results.length ? <ShowMore onClick={() => setShowAllResults(true)} /> : null}
      </section> : null}
      {explanation && !textIsShown ? <ToolCodeEvidence text={explanation} expanded={expanded} /> : null}
      {shownContent.map((item, index) => <ToolRichEvidence key={index} item={item} expanded={expanded} truncated={p.truncated} workspaceRoot={workspaceRoot} />)}
      {shownContent.length < content.length ? <ShowMore onClick={() => setShowAllContent(true)} /> : null}
      {p.error ? <ToolPayloadSection title={t(p.state === 'canceled' ? 'toolStateCanceled' : 'toolDetails.error')} value={p.error} expanded={expanded} defaultOpen tone={p.state === 'failed' ? 'error' : undefined} /> : null}
      {!hasSemanticBody && p.output === undefined && !p.error ? <p className="text-ds-muted">{t(p.state === 'running' || p.state === 'pending' ? 'toolDetails.waiting' : 'toolDetails.empty')}</p> : null}
      {p.truncated ? <p className="text-ds-muted">{t('toolDetails.truncated')}</p> : null}
      {p.input !== undefined ? <ToolPayloadSection title={t('toolDetails.input')} value={p.input} expanded={expanded} /> : null}
      {p.output !== undefined ? <ToolPayloadSection title={t('toolDetails.output')} value={p.output} expanded={expanded} defaultOpen={!hasSemanticBody && !p.error} /> : null}
    </div>
  )
}

function ShowMore({ onClick }: { onClick: () => void }): ReactElement {
  const { t } = useTranslation('common')
  return <button type="button" className="px-3 py-2 text-left text-accent hover:bg-ds-hover" onClick={onClick}>{t('toolDetails.showMore')}</button>
}

function ToolFileLink({ path, line, workspaceRoot }: { path: string; line?: number; workspaceRoot: string }): ReactElement {
  const { t } = useTranslation('common')
  const [unavailable, setUnavailable] = useState(false)
  const open = async (): Promise<void> => {
    const target = { path, ...(line ? { line } : {}) }
    const validation = await validateFileReference(target, workspaceRoot)
    if (validation.status !== 'valid') { setUnavailable(true); return }
    previewWorkspaceFile({ ...target, path: validation.path, workspaceRoot })
  }
  return <button type="button" className="inline-flex min-w-0 items-center gap-1.5 text-left font-mono text-accent hover:underline" title={t(unavailable ? 'toolDetails.fileUnavailable' : 'toolDetails.openFile')}
    onClick={() => { void open() }}>
    <FileText size={14} className="shrink-0" /><span className="break-all">{path}{line ? `:${line}` : ''}</span>
  </button>
}

function ToolExternalLink({ url, children }: { url: string; children?: ReactNode }): ReactElement {
  const safe = toolEvidenceUrl(url)
  if (!safe) return <span className="break-all text-ds-muted">{children ?? url}</span>
  return <a href={safe} rel="noreferrer" target="_blank" className="inline-flex min-w-0 items-center gap-1 break-all text-accent hover:underline"
    onClick={(event) => { if (window.kunGui?.openExternal) { event.preventDefault(); void window.kunGui.openExternal(safe).catch(() => undefined) } }}>
    <span>{children ?? url}</span><ExternalLink size={12} className="shrink-0" />
  </a>
}

function ToolSearchResult({ result, workspaceRoot }: { result: ToolPresentationSearchResult; workspaceRoot: string }): ReactElement {
  return <div className="min-w-0 space-y-1 px-3 py-2">
    {result.url ? <ToolExternalLink url={result.url}>{result.title ?? result.url}</ToolExternalLink>
      : result.path ? <ToolFileLink path={result.path} line={result.line} workspaceRoot={workspaceRoot} />
        : result.title ? <div className="font-medium">{result.title}</div> : null}
    {result.text ? <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-ds-muted">{result.text}</pre> : null}
  </div>
}

function ToolRichEvidence({ item, expanded, truncated, workspaceRoot }: { item: ToolPresentationContent; expanded: boolean; truncated?: boolean; workspaceRoot: string }): ReactElement {
  const { t } = useTranslation('common')
  const mimeType = item.mimeType ?? item.resource?.mimeType
  const image = item.omitted || truncated ? undefined : toolEvidenceImage(item.data ?? item.resource?.blob, mimeType)
  const uri = item.uri ?? item.resource?.uri
  let localPath: string | undefined
  if (uri?.startsWith('file://')) {
    try { const parsed = new URL(uri); if (!parsed.hostname || parsed.hostname === 'localhost') localPath = decodeURIComponent(parsed.pathname) } catch { /* Show an inert malformed resource reference. */ }
  } else if (uri && (/^\//.test(uri) || /^[A-Za-z]:[\\/]/.test(uri))) localPath = uri
  const text = item.text ?? item.resource?.text
  return <section className="min-w-0 space-y-2" data-tool-rich-content={item.type}>
    <div className="text-ds-muted">{item.name ?? mimeType ?? item.type ?? t('toolDetails.attachment')}</div>
    {image ? <img src={image} alt={item.name ?? t('toolDetails.image')} className="max-h-80 max-w-full rounded-lg object-contain" loading="lazy" /> : null}
    <ToolBinaryEvidence item={item} truncated={truncated} />
    {localPath ? <ToolFileLink path={localPath} workspaceRoot={workspaceRoot} /> : uri ? <ToolExternalLink url={uri}>{uri}</ToolExternalLink> : null}
    {text ? <ToolCodeEvidence text={text} expanded={expanded} /> : null}
    {item.omitted ? <p className="text-ds-muted">{t('toolDetails.contentOmitted')}</p> : null}
    {item.raw !== undefined ? <ToolPayloadSection title={t('toolDetails.raw')} value={item.raw} expanded={expanded} /> : null}
    {!image && !uri && !text && !item.data && !item.resource?.blob && !item.omitted && item.raw === undefined ? <ToolPayloadSection title={t('toolDetails.raw')} value={item} expanded={expanded} /> : null}
  </section>
}

function ToolPayloadSection({ title, value, expanded, defaultOpen = false, tone }: {
  title: string; value: unknown; expanded: boolean; defaultOpen?: boolean; tone?: 'error'
}): ReactElement {
  const [open, setOpen] = useState(defaultOpen)
  return <details open={open} className={tone === 'error' ? 'rounded-lg border border-orange-300/50 bg-orange-500/5 p-2 text-orange-700 dark:text-orange-300' : 'min-w-0 text-ds-muted'}
    onToggle={(event) => setOpen(event.currentTarget.open)} data-tool-payload={tone === 'error' ? 'error' : undefined}>
    <summary className="w-fit cursor-pointer select-none font-medium">{title}</summary>
    {open ? <div className="mt-2"><ToolCodeEvidence text={formatToolEvidence(value)} language={typeof value === 'string' ? undefined : 'json'} expanded={expanded} /></div> : null}
  </details>
}
