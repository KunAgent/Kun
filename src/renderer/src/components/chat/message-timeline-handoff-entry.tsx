import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRightLeft, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import type { HandoffBlock } from '../../agent/types'
import { getProvider } from '../../agent/registry'
import { useChatStore } from '../../store/chat-store'

function useHandoffBrief(block: HandoffBlock): {
  brief: string | null
  error: boolean
  loading: boolean
} {
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const [brief, setBrief] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const provider = getProvider()
    if (!provider.getHandoffPreview || !activeThreadId || !block.turnId) return
    let cancelled = false
    setLoading(true)
    setError(false)
    void provider
      .getHandoffPreview(activeThreadId, block.turnId)
      .then((preview) => {
        if (cancelled) return
        setBrief(preview.brief)
      })
      .catch(() => {
        if (cancelled) return
        setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeThreadId, block.turnId])

  return { brief, error, loading }
}

/**
 * Expanded body of a `handoff` process row. The 16 KiB brief body is never
 * persisted into the event stream — it is rebuilt on demand through
 * `GET /v1/threads/:id/handoff-preview?turnId=` (docs/ade/08 §5).
 */
export function HandoffBriefDetail({ block }: { block: HandoffBlock }): ReactElement {
  const { t } = useTranslation('common')
  const { brief, error, loading } = useHandoffBrief(block)

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-1 text-[13px] text-ds-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      </div>
    )
  }
  if (error || brief === null) {
    return (
      <p className="text-[13px] text-amber-700 dark:text-amber-300">
        {t('adeHandoffLoadError')}
      </p>
    )
  }
  return (
    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-ds-border bg-ds-subtle p-2 font-mono text-[11.5px] leading-5 text-ds-ink">
      {brief}
    </pre>
  )
}

/**
 * Standalone card for a `handoff` block rendered outside the process stack
 * (jump preview, tests). The normal timeline path is the process row whose
 * expand affordance mounts `HandoffBriefDetail`.
 */
export function HandoffEntry({ block }: { block: HandoffBlock }): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)

  const label = block.handoffMode === 'delta'
    ? t('adeHandoffDelta', { agent: block.toHarnessName })
    : t('adeHandoff', {
        agent: block.toHarnessName,
        turns: block.recentTurns,
        files: block.files
      })

  return (
    <div className="ds-card-soft rounded-[18px] px-3 py-2 text-[13.5px] text-ds-muted">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <ArrowRightLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
        )}
      </button>
      {open ? (
        <div className="mt-2">
          <HandoffBriefDetail block={block} />
        </div>
      ) : null}
    </div>
  )
}
