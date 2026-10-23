import { memo, useMemo, type ReactElement } from 'react'
import { Code2, Monitor, PenLine, Smartphone, Tablet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { filterEditableShapeIds } from '../../../design/canvas/canvas-editability'
import { isHtmlFrame, type CanvasShape, type DevicePreset } from '../../../design/canvas/canvas-types'
import { useDesignWorkspaceStore } from '../../../design/design-workspace-store'
import type { DesignArtifact } from '../../../design/design-types'
import { DesignContextPopover } from '../DesignContextPopover'
import { buildScreenModifyPrompt, commitInspectorUpdate } from './PropertiesPanel'
import { Section } from './properties-panel/primitives'

const DEVICE_PRESETS: { id: DevicePreset; icon: typeof Monitor; labelKey: string; w: number; h: number }[] = [
  { id: 'mobile', icon: Smartphone, labelKey: 'canvasTweaksDeviceMobile', w: 390, h: 844 },
  { id: 'tablet', icon: Tablet, labelKey: 'canvasTweaksDeviceTablet', w: 768, h: 1024 },
  { id: 'desktop', icon: Monitor, labelKey: 'canvasTweaksDeviceDesktop', w: 1280, h: 800 }
]

/** The single selected HTML screen, if the selection is exactly one. */
export function selectedHtmlScreen(
  objects: Record<string, CanvasShape>,
  editableIds: readonly string[]
): CanvasShape | null {
  if (editableIds.length !== 1) return null
  const shape = objects[editableIds[0]]
  return shape && isHtmlFrame(shape) ? shape : null
}

const actionButton =
  'flex h-8 items-center justify-center gap-1.5 rounded-[8px] border border-ds-border-muted px-3 text-[12px] font-medium text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-45'

function ScreenTweaks({
  screen,
  artifact,
  onImplementDesign,
  onRequestModify
}: {
  screen: CanvasShape
  artifact: DesignArtifact | null
  onImplementDesign?: (artifact: DesignArtifact) => void
  onRequestModify?: (promptSeed: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const setDesignIntentMode = useDesignWorkspaceStore((s) => s.setDesignIntentMode)
  const requestModify = (): void => {
    setDesignIntentMode('modify')
    const title = artifact?.title || screen.name
    onRequestModify?.(t('canvasModifyScreenPrompt', buildScreenModifyPrompt(title), { title }))
  }
  return (
    <Section title={t('canvasInspectorScreen')}>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-ds-ink">{artifact?.title || screen.name}</div>
        {artifact ? <div className="mt-0.5 truncate font-mono text-[11px] text-ds-faint">{artifact.relativePath}</div> : null}
      </div>
      <div role="radiogroup" aria-label={t('canvasTweaksDevice')} className="flex items-center gap-1 rounded-[10px] bg-ds-hover p-0.5">
        {DEVICE_PRESETS.map(({ id, icon: Icon, labelKey, w, h }) => {
          const active = screen.devicePreset === id
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => commitInspectorUpdate('design', 'set-device-preset', [screen.id], { devicePreset: id, width: w, height: h })}
              className={`flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[8px] text-[11.5px] transition ${
                active ? 'bg-ds-elevated text-ds-ink shadow-[0_1px_2px_rgba(15,23,42,0.1)]' : 'text-ds-muted hover:text-ds-ink'
              }`}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t(labelKey)}
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={requestModify} disabled={!onRequestModify} className={actionButton}>
          <PenLine className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('designProjectModify')}
        </button>
        <button
          type="button"
          onClick={() => {
            if (artifact) onImplementDesign?.(artifact)
          }}
          disabled={!artifact || !onImplementDesign}
          className={actionButton}
        >
          <Code2 className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('designImplement')}
        </button>
      </div>
    </Section>
  )
}

/** Tweaks tab: per-screen generation controls plus the design context the agent draws with. */
function CanvasTweaksPanelInner({
  onImplementDesign,
  onRequestModify,
  onOpenAgentSettings,
  designTargetDisabled = false
}: {
  onImplementDesign?: (artifact: DesignArtifact) => void
  onRequestModify?: (promptSeed: string) => void
  onOpenAgentSettings?: () => void
  designTargetDisabled?: boolean
}): ReactElement {
  const document = useCanvasShapeStore((s) => s.document)
  const selectedIds = useCanvasSelectionStore((s) => s.selectedIds)
  const artifacts = useDesignWorkspaceStore((s) => s.artifacts)
  const screen = useMemo(
    () => selectedHtmlScreen(document.objects, filterEditableShapeIds(document, selectedIds)),
    [document, selectedIds]
  )
  const artifact = screen ? artifacts.find((item) => item.id === screen.htmlArtifactId) ?? null : null
  return (
    <div className="grid gap-x-8 gap-y-5 px-4 pb-4 pt-3 text-[12px] [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
      {screen ? (
        <ScreenTweaks
          screen={screen}
          artifact={artifact}
          onImplementDesign={onImplementDesign}
          onRequestModify={onRequestModify}
        />
      ) : null}
      <div className="min-w-0">
        <DesignContextPopover
          open
          presentation="inline"
          onClose={() => undefined}
          onOpenSettings={onOpenAgentSettings}
          designTargetDisabled={designTargetDisabled}
        />
      </div>
    </div>
  )
}

export const CanvasTweaksPanel = memo(CanvasTweaksPanelInner)
