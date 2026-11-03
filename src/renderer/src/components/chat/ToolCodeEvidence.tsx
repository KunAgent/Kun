import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { Check, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { highlightCodeHtml, languageFromFilePath, renderFallbackCodeHtml } from '../../lib/code-highlighting'
import { sliceToolEvidence } from './tool-evidence-content'

export function ToolCodeEvidence({ text, filePath, language, startLine = 1, numbered = false, expanded = false }: {
  text: string; filePath?: string; language?: string; startLine?: number; numbered?: boolean; expanded?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const [pages, setPages] = useState(1)
  const [copied, setCopied] = useState(false)
  const preview = useMemo(() => sliceToolEvidence(text, (expanded ? 800 : 120) * pages, (expanded ? 100_000 : 20_000) * pages), [text, expanded, pages])
  const codeLanguage = language ?? (filePath ? languageFromFilePath(filePath) : '')
  const [highlight, setHighlight] = useState<{ text: string; language: string; html: string } | null>(null)
  const html = highlight?.text === preview.text && highlight.language === codeLanguage
    ? highlight.html : renderFallbackCodeHtml(preview.text)
  useEffect(() => {
    let cancelled = false
    // Streaming tools can replace a partial result rapidly. Highlight only a
    // settled, bounded preview; the escaped plain-text fallback is immediate.
    const timer = window.setTimeout(() => {
      void highlightCodeHtml(preview.text, codeLanguage).then((result) => {
        if (!cancelled) setHighlight({ text: preview.text, language: codeLanguage, html: result })
      })
    }, 100)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [preview.text, codeLanguage])
  useEffect(() => { if (!copied) return; const timer = window.setTimeout(() => setCopied(false), 1_500); return () => window.clearTimeout(timer) }, [copied])
  const firstLine = Number.isFinite(startLine) ? Math.max(1, Math.trunc(startLine)) : 1
  const numbers = useMemo(() => Array.from({ length: preview.lineCount }, (_, index) => firstLine + index).join('\n'), [firstLine, preview.lineCount])
  const copy = async (): Promise<void> => {
    try {
      const bridge = window.kunGui as typeof window.kunGui & { writeClipboardText?: (value: string) => Promise<unknown> }
      if (bridge?.writeClipboardText) await bridge.writeClipboardText(text)
      else await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch { /* The evidence remains selectable when clipboard access is unavailable. */ }
  }
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-ds-border-muted bg-ds-card" data-tool-code-evidence>
      <div className="flex items-center justify-between gap-2 border-b border-ds-border-muted px-3 py-1 text-[11px] text-ds-muted">
        <span>{codeLanguage || t('toolDetails.text')}</span>
        <button type="button" className="rounded p-1 hover:bg-ds-hover" aria-label={t('toolDetails.copy')}
          onClick={() => { void copy() }}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <div className="ds-file-preview-scroll overflow-auto font-mono text-[12px] leading-[22px]" style={{ maxHeight: expanded ? '65vh' : 320 }}>
        <div className="ds-file-preview-code-surface">
          {numbered ? <div className="ds-file-preview-gutter" aria-hidden="true"><pre className="ds-file-preview-line-numbers" data-tool-line-numbers>{numbers}</pre></div> : null}
          <div className="ds-file-preview-code-html" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
      {preview.limited ? <button type="button" className="w-full border-t border-ds-border-muted px-3 py-2 text-left text-[12px] text-accent hover:bg-ds-hover" onClick={() => setPages((value) => value + 1)}>{t('toolDetails.showMore')}</button> : null}
    </div>
  )
}
