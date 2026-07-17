import { useState } from 'react'
import { Check, Equal, FileDiff, FilePlus, LoaderCircle, ShieldCheck } from 'lucide-react'

export type DeliveryReviewFile = {
  path: string
  kind: 'new' | 'modified' | 'unchanged'
  bytes: number
  beforeSha256: string | null
  afterSha256: string
}

export function DeliveryReview({
  title,
  files,
  onApply
}: {
  title: string
  files: DeliveryReviewFile[]
  onApply: () => Promise<void>
}): React.ReactElement {
  const [state, setState] = useState<'ready' | 'applying' | 'applied'>('ready')
  const [error, setError] = useState<string | null>(null)
  const apply = async (): Promise<void> => {
    if (state !== 'ready') return
    setState('applying'); setError(null)
    try {
      await onApply()
      setState('applied')
    } catch (cause) {
      setState('ready')
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <section className="flex h-full min-h-0 flex-col bg-ds-main text-ds-text">
      <header className="flex items-center gap-3 border-b border-ds-border-muted px-5 py-3">
        <ShieldCheck className="h-4 w-4 text-emerald-500" />
        <div className="min-w-0 flex-1"><h2 className="truncate text-[13px] font-medium">{title}</h2><p className="text-[10px] text-ds-muted">隔离审查 · {files.length} 个文件</p></div>
        <button type="button" aria-label="应用交付物" disabled={state !== 'ready'} onClick={apply} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[11px] text-white disabled:opacity-60">
          {state === 'applying' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {state === 'applied' ? '已应用' : state === 'applying' ? '应用中' : '应用'}
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {files.map((file) => <div key={file.path} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 border-b border-ds-border-muted px-5 py-3">
          {file.kind === 'new' ? <FilePlus className="h-4 w-4 text-emerald-500" /> : file.kind === 'modified' ? <FileDiff className="h-4 w-4 text-amber-500" /> : <Equal className="h-4 w-4 text-ds-muted" />}
          <div className="min-w-0"><div className="truncate font-mono text-[11px]">{file.path}</div><div className="truncate font-mono text-[9px] text-ds-faint">{file.afterSha256}</div></div>
          <div className="text-[10px] text-ds-muted">{formatBytes(file.bytes)}</div>
        </div>)}
      </div>
      {error ? <div className="border-t border-red-500/30 bg-red-500/5 px-5 py-2 text-[11px] text-red-500">{error}</div> : null}
    </section>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
