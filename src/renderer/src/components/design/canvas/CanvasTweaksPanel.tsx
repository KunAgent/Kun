import { memo, useMemo, type ReactElement } from 'react'
import { Code2, Monitor, MousePointerClick, Smartphone, Sparkles, Tablet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { filterEditableShapeIds } from '../../../design/canvas/canvas-editability'
import { isHtmlFrame, type CanvasShape, type DevicePreset } from '../../../design/canvas/canvas-types'
import { useDesignWorkspaceStore } from '../../../design/design-workspace-store'
import type { DesignArtifact } from '../../../design/design-types'
import { DesignContextForm } from '../DesignContextForm'
import { buildScreenModifyPrompt, commitInspectorUpdate } from './PropertiesPanel'
import {
  TWEAKS_BUTTON_PRIMARY,
  TWEAKS_BUTTON_SECONDARY,
  TweaksRow,
  TweaksSection,
  TweaksSegmented
} from './tweaks/tweaks-controls'

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
  const title = artifact?.title || screen.name
  const requestModify = (): void => {
    setDesignIntentMode('modify')
    onRequestModify?.(t('canvasModifyScreenPrompt', buildScreenModifyPrompt(title), { title }))
  }
  return (
    <TweaksSection title={t('canvasInspectorScreen')}>
      <div className="flex min-w-0 items-center gap-2.5 rounded-[10px] border border-ds-border-muted bg-ds-main px-3 py-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-accent-soft text-accent">
          <Monitor className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ds-ink">{title}</div>
          {artifact ? (
            <div className="truncate font-mono text-[11px] text-ds-faint" title={artifact.relativePath}>
              {artifact.relativePath}
            </div>
          ) : null}
        </div>
      </div>
      <TweaksRow label={t('canvasTweaksDevice')}>
        <TweaksSegmented
          value={screen.devicePreset}
          ariaLabel={t('canvasTweaksDevice')}
          options={DEVICE_PRESETS.map(({ id, icon: Icon, labelKey }) => ({
            value: id,
            label: t(labelKey),
            icon: <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          }))}
          onChange={(id) => {
            const preset = DEVICE_PRESETS.find((item) => item.id === id)
            if (!preset) return
            commitInspectorUpdate('design', 'set-device-preset', [screen.id], {
              devicePreset: id,
              width: preset.w,
              height: preset.h
            })
          }}
        />
      </TweaksRow>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={requestModify} disabled={!onRequestModify} className={TWEAKS_BUTTON_PRIMARY}>
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.9} />
          <span className="truncate">{t('designProjectModify')}</span>
        </button>
        <button
          type="button"
          onClick={() => {
            if (artifact) onImplementDesign?.(artifact)
          }}
          disabled={!artifact || !onImplementDesign}
          className={TWEAKS_BUTTON_SECONDARY}
        >
          <Code2 className="h-3.5 w-3.5" strokeWidth={1.9} />
          <span className="truncate">{t('designImplement')}</span>
        </button>
      </div>
    </TweaksSection>
  )
}

function ScreenTweaksEmpty(): ReactElement {
  const { t } = useTranslation('common')
  return (
    <TweaksSection title={t('canvasInspectorScreen')}>
      <div className="flex items-center gap-2.5 rounded-[10px] border border-dashed border-ds-border px-3 py-3 text-[12.5px] leading-5 text-ds-muted">
        <MousePointerClick className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.7} />
        <span>{t('canvasTweaksSelectScreen')}</span>
      </div>
    </TweaksSection>
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
    <div
      className="grid items-start gap-x-10 gap-y-6 px-5 pb-8 pt-4 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]"
      data-canvas-tweaks="true"
    >
      {screen ? (
        <ScreenTweaks
          screen={screen}
          artifact={artifact}
          onImplementDesign={onImplementDesign}
          onRequestModify={onRequestModify}
        />
      ) : (
        <ScreenTweaksEmpty />
      )}
      <DesignContextForm onOpenSettings={onOpenAgentSettings} designTargetDisabled={designTargetDisabled} />
    </div>
  )
}

export const CanvasTweaksPanel = memo(CanvasTweaksPanelInner)
