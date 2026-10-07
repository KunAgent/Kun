import { useState, type ReactElement, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'

const COLLAPSE_KEY = 'kun.work.sidebarSections.v1'

function readCollapsed(): Record<string, boolean> {
  try {
    const parsed = JSON.parse(readBrowserStorageItem(COLLAPSE_KEY) ?? '{}') as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, boolean> : {}
  } catch {
    return {}
  }
}

/**
 * One section of the space map (会话 / 文件 / 论文): a label that folds the
 * section (remembered), an optional count, and its own actions on the right.
 */
export function WorkSidebarSection({ id, label, count, actions, children }: {
  id: 'sessions' | 'files' | 'papers'
  label: string
  count?: ReactNode
  actions?: ReactNode
  children: ReactNode
}): ReactElement {
  const [collapsed, setCollapsed] = useState(() => readCollapsed()[id] === true)
  const toggle = (): void => {
    setCollapsed((current) => {
      const next = !current
      writeBrowserStorageItem(COLLAPSE_KEY, JSON.stringify({ ...readCollapsed(), [id]: next }))
      return next
    })
  }
  return (
    <section className="work-section" data-work-section={id} data-collapsed={collapsed ? 'true' : 'false'}>
      <div className="work-section-head">
        <button type="button" className="work-section-toggle" aria-expanded={!collapsed} onClick={toggle}>
          <span className="work-section-label">{label}</span>
          {count !== undefined && count !== null ? <span className="work-section-count">{count}</span> : null}
          {collapsed
            ? <ChevronRight className="work-section-chevron is-collapsed h-3 w-3" strokeWidth={2} aria-hidden />
            : <ChevronDown className="work-section-chevron h-3 w-3" strokeWidth={2} aria-hidden />}
        </button>
        {actions ? <div className="work-section-actions">{actions}</div> : null}
      </div>
      {collapsed ? null : <div className="work-section-body">{children}</div>}
    </section>
  )
}
