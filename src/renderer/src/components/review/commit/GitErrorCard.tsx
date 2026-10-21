import { useEffect, useRef, useState, type ReactElement } from 'react'
import { AlertTriangle, Check, Copy, RefreshCw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type GitErrorInfo = {
  title: string
  /** One plain sentence on what happened and what to do. */
  hint: string
  /** Git's own words, shown verbatim and copied with the command. */
  output?: string
  command?: string
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** A failed git step: what went wrong, git's output, and copy / retry / dismiss. */
export function GitErrorCard({
  error,
  onRetry,
  retryLabel,
  onDismiss
}: {
  error: GitErrorInfo
  onRetry?: () => void
  retryLabel?: string
  onDismiss: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const detail = [error.command ? `$ ${error.command}` : '', error.output ?? ''].filter(Boolean).join('\n')
  const copy = async (): Promise<void> => {
    if (await copyToClipboard([error.title, error.hint, detail].filter(Boolean).join('\n\n'))) {
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1400)
    }
  }
  return (
    <div role="alert" className="overflow-hidden rounded-[12px] border border-red-300/70 bg-ds-card dark:border-red-500/40">
      <div className="flex items-center gap-2 py-2 pl-3 pr-1.5">
        <AlertTriangle className="h-[15px] w-[15px] shrink-0 text-ds-danger" strokeWidth={1.9} />
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ds-ink">{error.title}</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('changesDismiss')}
          title={t('changesDismiss')}
          className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-[7px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
      <p className="m-0 px-3 pb-2 text-[12px] leading-[18px] text-ds-muted">{error.hint}</p>
      {detail ? (
        <pre className="mx-3 mb-0 mt-0 max-h-[160px] overflow-auto whitespace-pre-wrap break-all rounded-[8px] bg-ds-subtle px-2.5 py-2 font-mono text-[10.5px] leading-4 text-ds-ink">
          {detail}
        </pre>
      ) : null}
      <div className="flex gap-2 px-3 pb-3 pt-2.5">
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex h-[30px] items-center gap-1.5 rounded-[8px] border border-ds-border bg-ds-card px-3 text-[12px] font-medium text-ds-ink hover:bg-ds-hover"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-ds-success" strokeWidth={2} /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />}
          {copied ? t('changesCopied') : t('changesCopyError')}
        </button>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-[8px] border border-ds-border bg-ds-card px-3 text-[12px] font-medium text-ds-ink hover:bg-ds-hover"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
            {retryLabel}
          </button>
        ) : null}
      </div>
    </div>
  )
}
