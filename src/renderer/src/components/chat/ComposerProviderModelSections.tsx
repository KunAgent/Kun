import { useState, type ReactElement, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { ProviderIcon } from '../provider-icon'
import { initialOpenProviderSections, providerSectionIconPreset, type ProviderModelSection } from './composer-provider-model-sections'

/**
 * One collapsible section per model provider inside an Agent's catalog.
 * Long catalogs open only the section holding the current model; a filter
 * query shows every matching section open.
 */
export function ComposerProviderModelSections({ sections, currentModel, filtering, expandAllAt, renderRow }: {
  sections: ProviderModelSection[]
  currentModel: string
  filtering: boolean
  expandAllAt: number
  renderRow: (modelId: string) => ReactNode
}): ReactElement {
  const [open, setOpen] = useState(() => initialOpenProviderSections(sections, currentModel, expandAllAt))
  return (
    <>
      {sections.map((section) => {
        const expanded = filtering || open.has(section.key)
        const preset = providerSectionIconPreset(section.key)
        return (
          <div key={section.key} role="group" aria-label={section.label} data-model-provider-section={section.key}>
            <button
              type="button"
              data-model-nav
              aria-expanded={filtering ? undefined : expanded}
              disabled={filtering}
              onClick={() => setOpen((current) => {
                const next = new Set(current)
                if (next.has(section.key)) next.delete(section.key)
                else next.add(section.key)
                return next
              })}
              className="mt-0.5 flex h-7 w-full items-center gap-2 rounded-md px-2.5 text-[12px] font-medium text-ds-muted outline-none transition enabled:hover:bg-ds-hover enabled:hover:text-ds-ink focus-visible:bg-ds-hover disabled:cursor-default"
            >
              {preset ? <ProviderIcon presetId={preset} className="h-3.5 w-3.5 shrink-0" /> : <span className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              <span className="min-w-0 flex-1 truncate text-left">{section.label}</span>
              <span className="text-[11.5px] font-normal tabular-nums text-ds-faint">{section.modelIds.length}</span>
              {!filtering ? <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-ds-faint transition-transform${expanded ? ' rotate-90' : ''}`} strokeWidth={1.9} /> : null}
            </button>
            {expanded ? <div className="pl-3">{section.modelIds.map((id) => renderRow(id))}</div> : null}
          </div>
        )
      })}
    </>
  )
}
