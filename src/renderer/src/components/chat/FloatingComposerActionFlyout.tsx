import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { ExternalLink, Search, Settings2 } from 'lucide-react'
import { mcpEntriesFromConfig } from '../workbench/mcp-skills-panel-model'

/** Navigation event the workbench listens for to open the Plugins page. */
export const OPEN_PLUGINS_EVENT = 'kun:open-plugins'

export type ComposerFlyoutKind = 'plugins' | 'skills'

export type ComposerFlyoutItem = {
  id: string
  name: string
  description: string
}

type Placement = { left: number; top: number; width: number; maxHeight: number }

type Props = {
  kind: ComposerFlyoutKind
  items: ComposerFlyoutItem[]
  loading?: boolean
  labels: { title: string; search: string; empty: string; manage: string; explore: string }
  /** Places the panel beside the parent menu for a measured height. */
  place: (menuHeight: number) => Placement | null
  onPick: (item: ComposerFlyoutItem) => void
  onManage: () => void
  onExplore: () => void
  onClose: () => void
}

/** MCP servers from the global and project config, enabled ones first. */
export function useComposerPluginItems(active: boolean, workspaceRoot: string): {
  items: ComposerFlyoutItem[]
  loading: boolean
} {
  const [items, setItems] = useState<ComposerFlyoutItem[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!active) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const api = window.kunGui
        const [globalConfig, projectConfig] = await Promise.all([
          api.getKunConfigFile(),
          workspaceRoot ? api.getKunProjectConfigFile(workspaceRoot) : Promise.resolve(null)
        ])
        const read = (content: string | undefined, scope: 'global' | 'project') => {
          try {
            return content?.trim() ? mcpEntriesFromConfig(content, scope) : []
          } catch {
            return []
          }
        }
        const entries = [
          ...read(projectConfig?.content, 'project'),
          ...read(globalConfig.content, 'global')
        ]
        if (cancelled) return
        setItems(
          entries
            .sort((left, right) => Number(right.enabled) - Number(left.enabled))
            .map((entry) => ({ id: `${entry.sourceScope}:${entry.id}`, name: entry.name, description: entry.description }))
        )
      } catch {
        if (!cancelled) setItems([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [active, workspaceRoot])
  return { items, loading }
}

/** A second-level list beside the + menu: search, a short list, then manage / explore. */
export function ComposerActionFlyout({
  kind, items, loading = false, labels, place, onPick, onManage, onExplore, onClose
}: Props): ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)
  const [query, setQuery] = useState('')
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' })
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = needle
      ? items.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(needle))
      : items
    return filtered.slice(0, 40)
  }, [items, query])

  useLayoutEffect(() => {
    const update = (): void => {
      const placement = place(ref.current?.offsetHeight ?? 320)
      if (!placement) return
      setStyle({ ...placement, visibility: placement.maxHeight > 0 ? 'visible' : 'hidden' })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [place, visible.length])

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={labels.title}
      data-composer-flyout={kind}
      style={style}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
      className="kun-menu-pop kun-menu-pop-side fixed z-50 box-border flex flex-col overflow-hidden rounded-[16px] border-0 bg-white p-1.5 text-[13px] text-ds-muted shadow-[var(--kun-shadow-lift)] dark:bg-ds-card"
    >
      <label className="mb-1.5 flex h-9 shrink-0 items-center gap-2 rounded-[11px] bg-[var(--kun-sunken)] px-3 text-ds-faint">
        <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={labels.search}
          aria-label={labels.search}
          className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-ds-ink outline-none placeholder:text-ds-faint"
        />
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            onClick={() => onPick(item)}
            className="flex min-h-10 w-full min-w-0 items-center gap-2.5 rounded-[11px] px-2.5 py-1.5 text-left text-[14px] transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <span className="shrink-0 font-medium text-ds-ink">{item.name}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-ds-faint">{item.description}</span>
          </button>
        ))}
        {visible.length === 0 ? (
          <p className="px-3 py-3 text-[12.5px] text-ds-faint">{loading ? '…' : labels.empty}</p>
        ) : null}
      </div>
      <div className="my-1 h-px shrink-0 bg-ds-border-muted/70" />
      <button
        type="button"
        role="menuitem"
        onClick={onManage}
        className="flex min-h-9 w-full shrink-0 items-center gap-2.5 rounded-[11px] px-2.5 text-left text-[13.5px] transition hover:bg-ds-hover hover:text-ds-ink"
      >
        <Settings2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} aria-hidden="true" />
        {labels.manage}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onExplore}
        className="flex min-h-9 w-full shrink-0 items-center gap-2.5 rounded-[11px] px-2.5 text-left text-[13.5px] transition hover:bg-ds-hover hover:text-ds-ink"
      >
        <ExternalLink className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} aria-hidden="true" />
        {labels.explore}
      </button>
    </div>
  )
}
