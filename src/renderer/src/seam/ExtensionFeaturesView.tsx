import { createElement, useState } from 'react'
import { ENABLED_RENDERER_FEATURES } from './features/index.js'

type FeaturePanel = {
  id: string
  title: string
  component: () => React.ReactElement
}

export const EXTENSION_FEATURE_PANELS: FeaturePanel[] = ENABLED_RENDERER_FEATURES.flatMap((feature) => feature.panels)

export function ExtensionFeaturesView(): React.ReactElement {
  const [activeId, setActiveId] = useState(EXTENSION_FEATURE_PANELS[0]?.id ?? '')
  const active = EXTENSION_FEATURE_PANELS.find((panel) => panel.id === activeId) ?? EXTENSION_FEATURE_PANELS[0]

  return (
    <div className="flex h-full min-h-0 flex-col bg-ds-main text-ds-text">
      <div className="ds-no-drag flex h-12 shrink-0 items-center border-b border-ds-border-muted px-4">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto" role="tablist" aria-label="Agent capabilities">
          {EXTENSION_FEATURE_PANELS.map((panel) => (
            <button
              key={panel.id}
              type="button"
              role="tab"
              aria-selected={panel.id === active?.id}
              onClick={() => setActiveId(panel.id)}
              className={`h-8 shrink-0 rounded-md px-3 text-[12.5px] transition-colors ${
                panel.id === active?.id
                  ? 'bg-ds-hover font-medium text-ds-text'
                  : 'text-ds-muted hover:bg-ds-hover/60 hover:text-ds-text'
              }`}
            >
              {panel.title}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {active ? createElement(active.component) : null}
      </div>
    </div>
  )
}
