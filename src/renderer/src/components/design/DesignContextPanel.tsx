import { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { DesignContextContribution, DesignContextContributionKind } from '../../design/context/design-context-contribution'
import { loadDesignContextContributions } from '../../design/context/design-context-resources'
import { loadDesignContextSelection, saveDesignContextSelection, type DesignContextSelection } from '../../design/context/design-context-selection'

export const DESIGN_CONTEXT_TABS: ReadonlyArray<{ kind: DesignContextContributionKind; label: string }> = [
  { kind: 'design-system', label: '设计系统' },
  { kind: 'skill', label: 'Skills' },
  { kind: 'component', label: '组件' },
  { kind: 'asset', label: '资产' }
]

export function DesignContextPanel({ workspaceRoot }: { workspaceRoot: string }): React.ReactElement {
  const [activeKind, setActiveKind] = useState<DesignContextContributionKind>('design-system')
  const [contributions, setContributions] = useState<DesignContextContribution[]>([])
  const [selection, setSelection] = useState<DesignContextSelection>({ version: 1, selected: [] })
  const [query, setQuery] = useState('')
  const [detail, setDetail] = useState<{ title: string; value: unknown } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      const [items, stored] = await Promise.all([
        loadDesignContextContributions(),
        loadDesignContextSelection(workspaceRoot)
      ])
      setContributions(items)
      setSelection(stored)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [workspaceRoot])

  const selectedIds = useMemo(() => new Set(selection.selected.filter((item) => item.enabled).map((item) => item.contributionId)), [selection])
  const visible = contributions.filter((item) => item.kind === activeKind && (!query || `${item.title} ${item.summary}`.toLowerCase().includes(query.toLowerCase())))

  const toggle = async (contribution: DesignContextContribution): Promise<void> => {
    const selected = selectedIds.has(contribution.id)
    const next: DesignContextSelection = {
      version: 1,
      selected: [
        ...selection.selected.filter((item) => item.contributionId !== contribution.id),
        ...(!selected ? [{ contributionId: contribution.id, version: contribution.version, enabled: true }] : [])
      ]
    }
    setSelection(next)
    try { await saveDesignContextSelection(workspaceRoot, next) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  const showDetail = async (contribution: DesignContextContribution): Promise<void> => {
    try { setDetail({ title: contribution.title, value: await contribution.loadDetail() }) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  return (
    <div className="flex min-h-[380px] flex-col">
      <div className="flex items-center gap-1 border-b border-ds-border-muted pb-2" role="tablist" aria-label="设计资源">
        {DESIGN_CONTEXT_TABS.map((tab) => <button key={tab.kind} type="button" role="tab" aria-selected={activeKind === tab.kind} onClick={() => setActiveKind(tab.kind)} className={`rounded-md px-2.5 py-1.5 text-[12px] ${activeKind === tab.kind ? 'bg-ds-hover text-ds-ink' : 'text-ds-muted hover:bg-ds-hover/60'}`}>{tab.label}</button>)}
        <button type="button" onClick={() => void load()} disabled={loading} className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-ds-muted hover:bg-ds-hover" aria-label="刷新设计资源" title="刷新设计资源"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索当前资源" className="my-2 rounded-md border border-ds-border-muted bg-transparent px-2.5 py-1.5 text-[12px] outline-none focus:border-accent" />
      {error ? <div className="mb-2 rounded-md bg-red-500/10 px-2.5 py-2 text-[11px] text-red-400">{error}</div> : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.map((item) => {
          const selected = selectedIds.has(item.id)
          const storedVersion = selection.selected.find((entry) => entry.contributionId === item.id)?.version
          return <div key={item.id} className="flex min-h-12 items-center gap-2 border-b border-ds-border-muted py-2 last:border-b-0"><input type="checkbox" checked={selected} onChange={() => void toggle(item)} aria-label={`选择 ${item.title}`} /><button type="button" onClick={() => void showDetail(item)} className="min-w-0 flex-1 text-left"><div className="truncate text-[12px] font-medium text-ds-ink">{item.title}</div><div className="truncate text-[11px] text-ds-muted">{item.summary}</div></button><span className={`shrink-0 text-[10px] ${storedVersion && storedVersion !== item.version ? 'text-amber-500' : 'text-ds-faint'}`}>v{item.version}</span></div>
        })}
        {!loading && visible.length === 0 ? <div className="py-8 text-center text-[12px] text-ds-muted">暂无资源</div> : null}
      </div>
      {detail ? <div className="mt-2 max-h-32 overflow-y-auto border-t border-ds-border-muted pt-2"><div className="mb-1 text-[12px] font-medium">{detail.title}</div><pre className="whitespace-pre-wrap break-words text-[10px] leading-4 text-ds-muted">{JSON.stringify(detail.value, null, 2)}</pre></div> : null}
    </div>
  )
}
