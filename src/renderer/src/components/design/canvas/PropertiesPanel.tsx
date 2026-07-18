import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Columns3,
  Monitor,
  PenLine,
  Play,
  Rows3,
  Smartphone,
  Sparkles,
  Tablet,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useImageAnnotationStore } from '../../../design/canvas/image-annotation-store'
import { filterEditableRootShapeIds, filterEditableShapeIds } from '../../../design/canvas/canvas-editability'
import type { AlignAxis, DistributeAxis } from '../../../design/canvas/canvas-align'
import {
  DEFAULT_FILL,
  fillColor as resolveFillColor,
  isArtifactFrame,
  isHtmlFrame,
  isImplicitImageSlot,
  isRunningAppFrame,
  type Arrowhead,
  type CanvasShape,
  type DevicePreset,
  type Fill,
  type Stroke,
  type StrokeDash
} from '../../../design/canvas/canvas-types'
import { executeOps } from '../../../design/canvas/shape-ops'
import { useDesignWorkspaceStore } from '../../../design/design-workspace-store'
import type { DesignArtifact } from '../../../design/design-types'
import {
  DASH_OPTIONS,
  HexInput,
  MIXED,
  NumberBox,
  OpacitySlider,
  Section,
  Seg,
  Swatches,
  WIDTH_OPTIONS,
  arrowheadOptions,
  commitUpdate,
  reduceField
} from './properties-panel/primitives'
import {
  PropertiesPanelShell,
  PropertiesPanelTrigger
} from './properties-panel/shell'
import { MotionKeyframeControls } from './properties-panel/MotionKeyframeControls'
import { useCanvasMotionStore } from '../../../design/motion/canvas-motion-store'
import { evaluateMotionTarget } from '../../../design/motion/evaluator'

export { propertiesPanelShellClass, propertiesPanelTriggerClass } from './properties-panel/shell'

type Props = {
  surface?: 'design' | 'code'
  onImplementDesign?: (artifact: DesignArtifact) => void
}

export function shouldShowImageAnnotationAction(
  surface: 'design' | 'code',
  filledImageSelected: boolean
): boolean {
  return (surface === 'design' || surface === 'code') && filledImageSelected
}

export function nextInspectorOpenForSelection(
  previousSelectionKey: string,
  nextSelectionKey: string,
  currentOpen: boolean,
  pinned: boolean
): boolean {
  if (!nextSelectionKey) return false
  if (previousSelectionKey === nextSelectionKey) return currentOpen
  return pinned
}

export function shouldPromoteHtmlFrameInspectorUpdateToManual(
  surface: 'design' | 'code',
  patch: Partial<CanvasShape>
): boolean {
  return surface === 'design' && !patch.devicePreset && (patch.width !== undefined || patch.height !== undefined)
}

export function commitInspectorUpdate(
  surface: 'design' | 'code',
  label: string,
  ids: string[],
  patch: Partial<CanvasShape>
): void {
  const motionState = useCanvasMotionStore.getState()
  if (surface === 'design' && motionState.open && motionState.playing) return
  const beforeDoc = useCanvasShapeStore.getState().document
  const editableIds = filterEditableShapeIds(beforeDoc, ids)
  commitUpdate(label, ids, patch)
  if (!shouldPromoteHtmlFrameInspectorUpdateToManual(surface, patch)) return

  const doc = useCanvasShapeStore.getState().document
  const designStore = useDesignWorkspaceStore.getState()
  for (const id of editableIds) {
    const shape = doc.objects[id]
    if (!shape || !isHtmlFrame(shape) || !shape.htmlArtifactId) continue
    designStore.updateArtifactNode(shape.htmlArtifactId, {
      x: Math.round(shape.x),
      y: Math.round(shape.y),
      width: Math.round(shape.width),
      height: Math.round(shape.height),
      sizeMode: 'manual',
      boardHidden: false,
      viewMode:
        designStore.artifacts.find((item) => item.id === shape.htmlArtifactId)?.node?.viewMode ?? 'preview'
    })
  }
}

function PropertiesPanelInner({ surface = 'design', onImplementDesign }: Props): ReactElement | null {
  const { t } = useTranslation('common')
  const selectedIds = useCanvasSelectionStore((s) => s.selectedIds)
  const document = useCanvasShapeStore((s) => s.document)
  const motionOpen = useCanvasMotionStore((state) => state.open)
  const motionFrameId = useCanvasMotionStore((state) => state.activeFrameId)
  const motionTimeMs = useCanvasMotionStore((state) => state.currentTimeMs)
  const pinned = useDesignWorkspaceStore((s) => s.canvasInspectorPinned)
  const setPinned = useDesignWorkspaceStore((s) => s.setCanvasInspectorPinned)
  const setDesignIntentMode = useDesignWorkspaceStore((s) => s.setDesignIntentMode)
  const setCanvasAssistantOpen = useDesignWorkspaceStore((s) => s.setCanvasAssistantOpen)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const lastSelectionKeyRef = useRef('')

  const ids = useMemo(
    () => filterEditableShapeIds(document, selectedIds),
    [document, selectedIds]
  )
  const rootIds = useMemo(
    () => filterEditableRootShapeIds(document, selectedIds),
    [document, selectedIds]
  )
  const shapes = useMemo(
    () => ids.map((id) => document.objects[id]).filter((s): s is CanvasShape => Boolean(s)),
    [ids, document]
  )
  const positionShapes = useMemo(() => {
    if (surface !== 'design' || !motionOpen || !motionFrameId || shapes.length !== 1) return shapes
    const shape = shapes[0]
    const timeline = document.motion?.timelines[motionFrameId]
    if (!timeline) return shapes
    const projection = evaluateMotionTarget(timeline, shape.id, motionTimeMs, {
      x: shape.x,
      y: shape.y,
      rotation: shape.rotation,
      opacity: shape.opacity,
      scaleX: 1,
      scaleY: 1
    })
    return [{ ...shape, ...projection }]
  }, [document.motion, motionFrameId, motionOpen, motionTimeMs, shapes, surface])
  const selectionKey = useMemo(() => ids.slice().sort().join('\u0000'), [ids])

  useEffect(() => {
    if (!selectionKey) {
      lastSelectionKeyRef.current = ''
      setInspectorOpen(false)
      return
    }
    if (lastSelectionKeyRef.current === selectionKey) return
    const previousSelectionKey = lastSelectionKeyRef.current
    lastSelectionKeyRef.current = selectionKey
    setInspectorOpen((open) =>
      nextInspectorOpenForSelection(previousSelectionKey, selectionKey, open, pinned)
    )
  }, [pinned, selectionKey])

  const updateAll = useCallback(
    (label: string, patch: Partial<CanvasShape>) => commitInspectorUpdate(surface, label, ids, patch),
    [ids, surface]
  )
  const alignSelection = useCallback(
    (axis: AlignAxis) => {
      if (rootIds.length < 2) return
      executeOps([{ op: 'align', ids: rootIds, axis }], `inspector-align-${axis}`, {
        selectAfter: () => rootIds
      })
    },
    [rootIds]
  )
  const distributeSelection = useCallback(
    (axis: DistributeAxis) => {
      if (rootIds.length < 3) return
      executeOps([{ op: 'distribute', ids: rootIds, axis }], `inspector-distribute-${axis}`, {
        selectAfter: () => rootIds
      })
    },
    [rootIds]
  )

  if (shapes.length === 0) return null

  const triggerLabel = t('canvasInspectorTitle', 'Properties')

  if (!inspectorOpen) {
    return (
      <PropertiesPanelTrigger
        count={shapes.length}
        label={triggerLabel}
        surface={surface}
        onOpen={() => setInspectorOpen(true)}
      />
    )
  }

  const renderShell = (children: ReactNode): ReactElement => (
    <PropertiesPanelShell
      count={shapes.length}
      pinned={pinned}
      pinLabel={t('canvasInspectorPin')}
      surface={surface}
      title={t('canvasInspectorTitle', 'Properties')}
      unpinLabel={t('canvasInspectorUnpin')}
      onTogglePinned={() => setPinned(!pinned)}
    >
      {children}
    </PropertiesPanelShell>
  )

  const x = reduceField(positionShapes, (s) => s.x)
  const y = reduceField(positionShapes, (s) => s.y)
  const w = reduceField(shapes, (s) => s.width)
  const h = reduceField(shapes, (s) => s.height)
  const rot = reduceField(positionShapes, (s) => s.rotation || 0)
  const opacity = reduceField(positionShapes, (s) => s.opacity)
  const cornerR = reduceField(shapes, (s) =>
    typeof s.cornerRadius === 'number' ? s.cornerRadius : s.cornerRadius[0]
  )

  const firstFill: Fill | undefined = shapes[0]?.fills[0]
  const fillColor = reduceField(shapes, (s) => resolveFillColor(s.fills[0]) ?? undefined)

  const firstStroke: Stroke | undefined = shapes[0]?.strokes[0]
  const strokeColor = reduceField(shapes, (s) => s.strokes[0]?.color)
  const strokeWidth = reduceField(shapes, (s) => s.strokes[0]?.width ?? 0)
  const strokeDash = reduceField(shapes, (s) => s.strokes[0]?.dash ?? 'solid')

  const isLinear = shapes.length > 0 && shapes.every((s) => s.type === 'arrow' || s.type === 'line')
  const arrowheadStart = isLinear ? reduceField(shapes, (s) => s.arrowheadStart ?? 'none') : undefined
  const arrowheadEnd = isLinear
    ? reduceField(shapes, (s) => s.arrowheadEnd ?? (s.type === 'arrow' ? 'arrow' : 'none'))
    : undefined

  const allText = shapes.every((s) => s.type === 'text')
  const fontSize = allText ? reduceField(shapes, (s) => s.fontSize ?? 16) : undefined
  const fontFamily = allText ? reduceField(shapes, (s) => s.fontFamily ?? '') : undefined
  const fontWeight = allText ? reduceField(shapes, (s) => s.fontWeight ?? 400) : undefined
  const fontColor = allText ? reduceField(shapes, (s) => s.fontColor ?? '#000000') : undefined

  const singleHtmlFrame = shapes.length === 1 && isHtmlFrame(shapes[0]) ? shapes[0] : null
  // Embedded HTML/SVG artifacts are DOM portals. Their source owns artwork
  // fills and strokes; only geometry, corner radius, opacity, and portal
  // controls have a visible canvas effect.
  const singleArtifactFrame = shapes.length === 1 && isArtifactFrame(shapes[0]) ? shapes[0] : null
  const linkedArtifact = singleHtmlFrame
    ? useDesignWorkspaceStore.getState().artifacts.find((a) => a.id === singleHtmlFrame.htmlArtifactId)
    : null
  // A single filled picture can be annotated → the agent re-edits it (image-to-image).
  const singleFilledImage =
    shapes.length === 1 && shapes[0].type === 'image' && Boolean(shapes[0].imageUrl)
      ? shapes[0]
      : null

  const requestScreenModify = (): void => {
    setDesignIntentMode('modify')
    setCanvasAssistantOpen(true)
    requestAnimationFrame(() => {
      globalThis.document
        .querySelector<HTMLTextAreaElement>('[data-design-rail-composer] textarea')
        ?.focus()
    })
  }

  // AI image holder: only fillable boxes (image/frame/rect) can be a slot the
  // agent fills. The marking flows into the AI snapshot so "fill this" resolves.
  const canBeHolder = shapes.every((s) =>
    !isArtifactFrame(s) &&
    !isRunningAppFrame(s) &&
    (s.type === 'image' || s.type === 'frame' || s.type === 'rect')
  )
  const aiHolder = reduceField(shapes, (s) => Boolean(s.aiImageHolder))
  // Empty boxes are implicit slots: the agent fills a selected empty box on
  // request automatically, so no manual marking is needed for the common case.
  const allEmptySlots = canBeHolder && shapes.every(isImplicitImageSlot)

  const DEVICE_PRESETS: { id: DevicePreset; icon: typeof Monitor; w: number; h: number }[] = [
    { id: 'mobile', icon: Smartphone, w: 390, h: 844 },
    { id: 'tablet', icon: Tablet, w: 768, h: 1024 },
    { id: 'desktop', icon: Monitor, w: 1280, h: 800 }
  ]

  const ALIGN_ACTIONS: { axis: AlignAxis; icon: typeof AlignHorizontalJustifyStart; label: string }[] = [
    { axis: 'left', icon: AlignHorizontalJustifyStart, label: t('canvasAlignLeft') },
    { axis: 'h-center', icon: AlignHorizontalJustifyCenter, label: t('canvasAlignHCenter') },
    { axis: 'right', icon: AlignHorizontalJustifyEnd, label: t('canvasAlignRight') },
    { axis: 'top', icon: AlignVerticalJustifyStart, label: t('canvasAlignTop') },
    { axis: 'v-center', icon: AlignVerticalJustifyCenter, label: t('canvasAlignVCenter') },
    { axis: 'bottom', icon: AlignVerticalJustifyEnd, label: t('canvasAlignBottom') }
  ]
  const DISTRIBUTE_ACTIONS: { axis: DistributeAxis; icon: typeof Columns3; label: string }[] = [
    { axis: 'horizontal', icon: Columns3, label: t('canvasDistributeH') },
    { axis: 'vertical', icon: Rows3, label: t('canvasDistributeV') }
  ]

  return renderShell(
    <div className="space-y-4 pt-1">
      {/* Position & size */}
      <Section title={t('canvasInspectorPosition', 'Position & size')}>
        <div className="grid grid-cols-2 gap-x-1 gap-y-0.5">
          <NumberBox icon="X" value={x} onCommit={(n) => updateAll('set-x', { x: n })} />
          <NumberBox icon="Y" value={y} onCommit={(n) => updateAll('set-y', { y: n })} />
          <NumberBox
            icon="W"
            value={w}
            min={1}
            onCommit={(n) => updateAll('set-w', { width: Math.max(1, n) })}
          />
          <NumberBox
            icon="H"
            value={h}
            min={1}
            onCommit={(n) => updateAll('set-h', { height: Math.max(1, n) })}
          />
        </div>
        <NumberBox
          icon="↻"
          value={rot}
          onCommit={(n) => updateAll('set-rotation', { rotation: ((n % 360) + 360) % 360 })}
        />
        {surface === 'design' && shapes.length === 1 ? (
          <MotionKeyframeControls shape={shapes[0]} />
        ) : null}
      </Section>

      {rootIds.length >= 2 && (
        <Section title={t('canvasInspectorArrange')}>
          <div className="grid grid-cols-3 gap-1">
            {ALIGN_ACTIONS.map(({ axis, icon: Icon, label }) => (
              <button
                key={axis}
                type="button"
                onClick={() => alignSelection(axis)}
                title={label}
                aria-label={label}
                className="flex h-7 items-center justify-center rounded-[8px] bg-ds-hover/30 text-ds-muted transition hover:bg-ds-hover/70 hover:text-ds-ink"
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
              </button>
            ))}
          </div>
          {rootIds.length >= 3 ? (
            <div className="grid grid-cols-2 gap-1">
              {DISTRIBUTE_ACTIONS.map(({ axis, icon: Icon, label }) => (
                <button
                  key={axis}
                  type="button"
                  onClick={() => distributeSelection(axis)}
                  title={label}
                  aria-label={label}
                  className="flex h-7 items-center justify-center rounded-[8px] bg-ds-hover/30 text-ds-muted transition hover:bg-ds-hover/70 hover:text-ds-ink"
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
                </button>
              ))}
            </div>
          ) : null}
        </Section>
      )}

      {surface === 'design' && singleHtmlFrame && (
        <Section title={t('canvasInspectorScreen', 'Screen')}>
          <div className="flex items-center gap-1 rounded-[10px] bg-ds-hover/35 p-0.5 dark:bg-white/5">
            {DEVICE_PRESETS.map(({ id, icon: Icon, w: dw, h: dh }) => {
              const active = singleHtmlFrame.devicePreset === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() =>
                    updateAll('set-device-preset', { devicePreset: id, width: dw, height: dh })
                  }
                  title={id}
                  className={`flex h-7 flex-1 items-center justify-center rounded-[8px] transition ${
                    active
                      ? 'bg-white text-ds-ink shadow-[0_1px_2px_rgba(15,23,42,0.08)] dark:bg-white/12'
                      : 'text-ds-muted hover:text-ds-ink'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                </button>
              )
            })}
          </div>
          {linkedArtifact && (
            <div className="rounded-[8px] bg-ds-hover/40 px-2 py-1.5 text-[11px] text-ds-muted">
              <div className="truncate font-medium text-ds-ink">{linkedArtifact.title}</div>
              <div className="mt-0.5 truncate text-ds-faint">{linkedArtifact.relativePath}</div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={requestScreenModify}
              className="flex h-8 items-center justify-center gap-1.5 rounded-[8px] bg-ds-hover/35 text-[11.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              <PenLine className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t('designProjectModify')}
            </button>
            <button
              type="button"
              onClick={() => {
                if (linkedArtifact) onImplementDesign?.(linkedArtifact)
              }}
              disabled={!linkedArtifact || !onImplementDesign}
              className="flex h-8 items-center justify-center gap-1.5 rounded-[8px] bg-ds-hover/35 text-[11.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Play className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t('designImplement')}
            </button>
          </div>
        </Section>
      )}

      {/* Annotate-to-edit — draw markup on a filled picture, agent applies it. */}
      {shouldShowImageAnnotationAction(surface, Boolean(singleFilledImage)) && singleFilledImage && (
        <Section title={t('canvasInspectorAnnotate', 'AI 修改图片')}>
          <button
            type="button"
            onClick={() => useImageAnnotationStore.getState().openImageAnnotation(singleFilledImage.id)}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[8px] bg-accent-soft text-[11.5px] font-medium text-accent shadow-[inset_0_0_0_1px_var(--ds-sidebar-row-ring)] transition hover:opacity-90"
          >
            <PenLine className="h-3.5 w-3.5" strokeWidth={1.9} />
            {t('canvasInspectorAnnotateOpen', '在图片上标注修改')}
          </button>
          <p className="mt-1 text-[10.5px] leading-4 text-ds-faint">
            {t(
              'canvasInspectorAnnotateHint',
              '画箭头/框选/写文字标出要改的地方，AI 按标注重画这张图（也可双击图片打开）。'
            )}
          </p>
        </Section>
      )}

      {/* AI image slot — an empty selected box is auto-filled on request; a
          filled box can still be marked manually as a regenerate target. */}
      {canBeHolder && (
        <Section title={t('canvasInspectorAiHolder', 'AI image')}>
          {allEmptySlots ? (
            <div className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[8px] bg-accent-soft text-[11.5px] font-medium text-accent shadow-[inset_0_0_0_1px_var(--ds-sidebar-row-ring)]">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.9} />
              {t('canvasInspectorAiHolderAuto', 'Empty box · auto image slot')}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => updateAll('toggle-ai-holder', { aiImageHolder: aiHolder !== true })}
              className={`flex h-8 w-full items-center justify-center gap-1.5 rounded-[8px] text-[11.5px] font-medium transition ${
                aiHolder === true
                  ? 'bg-accent-soft text-accent shadow-[inset_0_0_0_1px_var(--ds-sidebar-row-ring)]'
                  : 'bg-ds-hover/30 text-ds-faint hover:bg-ds-hover/60 hover:text-ds-ink'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.9} />
              {aiHolder === true
                ? t('canvasInspectorAiHolderOn', 'AI image slot · on')
                : t('canvasInspectorAiHolderMark', 'Mark as AI image slot')}
            </button>
          )}
          <p className="mt-1 text-[10.5px] leading-4 text-ds-faint">
            {allEmptySlots
              ? t(
                  'canvasInspectorAiHolderAutoHint',
                  'Just ask the assistant to generate — it fills this box automatically. No marking needed.'
                )
              : t(
                  'canvasInspectorAiHolderHint',
                  'Keep it selected and ask the assistant to generate — it fills this slot.'
                )}
          </p>
        </Section>
      )}

      {/* Fill — non-frame, non-linear shapes */}
      {shapes.some((s) => s.type !== 'group') && !singleArtifactFrame && !isLinear && (
        <Section title={t('canvasInspectorFill', 'Fill')}>
          {firstFill ? (
            <div className="space-y-1.5">
              <Swatches
                value={fillColor}
                onPick={(c) =>
                  updateAll('set-fill-color', {
                    fills: [{ type: 'solid', color: c, opacity: firstFill.opacity }]
                  })
                }
                showClear
                onClear={() => updateAll('clear-fill', { fills: [] })}
              />
              <HexInput
                value={fillColor}
                onCommit={(c) =>
                  updateAll('set-fill-color', {
                    fills: [{ type: 'solid', color: c, opacity: firstFill.opacity }]
                  })
                }
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => updateAll('add-fill', { fills: [{ ...DEFAULT_FILL }] })}
              className="h-7 w-full rounded-[8px] bg-ds-hover/30 text-[11px] text-ds-faint transition hover:bg-ds-hover/60 hover:text-ds-ink"
            >
              + {t('canvasInspectorAddFill', 'Add fill')}
            </button>
          )}
        </Section>
      )}

      {/* Stroke */}
      {!singleArtifactFrame && (
        <Section
          title={t('canvasInspectorStroke', 'Stroke')}
          action={
            firstStroke ? (
              <button
                type="button"
                onClick={() => updateAll('clear-stroke', { strokes: [] })}
                className="text-ds-faint transition hover:text-ds-ink"
                title={t('canvasInspectorRemoveStroke', 'Remove stroke')}
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            ) : null
          }
        >
          {firstStroke ? (
            <div className="space-y-2">
              <Swatches
                value={strokeColor}
                onPick={(c) =>
                  updateAll('set-stroke-color', { strokes: [{ ...firstStroke, color: c }] })
                }
              />
              <HexInput
                value={strokeColor}
                onCommit={(c) =>
                  updateAll('set-stroke-color', { strokes: [{ ...firstStroke, color: c }] })
                }
              />
              <Seg
                value={strokeWidth as number | typeof MIXED | undefined}
                options={WIDTH_OPTIONS}
                onPick={(wv) =>
                  updateAll('set-stroke-width', { strokes: [{ ...firstStroke, width: wv }] })
                }
              />
              <Seg
                value={strokeDash as StrokeDash | typeof MIXED | undefined}
                options={DASH_OPTIONS}
                onPick={(v) => updateAll('set-stroke-dash', { strokes: [{ ...firstStroke, dash: v }] })}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() =>
                updateAll('add-stroke', {
                  strokes: [{ color: '#1e1e1e', width: 2, opacity: 1, position: 'center', dash: 'solid' }]
                })
              }
              className="h-7 w-full rounded-[8px] bg-ds-hover/30 text-[11px] text-ds-faint transition hover:bg-ds-hover/60 hover:text-ds-ink"
            >
              + {t('canvasInspectorAddStroke', 'Add stroke')}
            </button>
          )}
        </Section>
      )}

      {/* Linear: arrowheads */}
      {isLinear && (
        <Section title={t('canvasInspectorLine', 'Line')}>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-[10px] uppercase tracking-[0.05em] text-ds-faint">
                {t('canvasInspectorArrowStart', 'Start')}
              </span>
              <div className="min-w-0 flex-1">
                <Seg
                  value={arrowheadStart as Arrowhead | typeof MIXED | undefined}
                  options={arrowheadOptions(true)}
                  onPick={(a) => updateAll('set-arrowhead-start', { arrowheadStart: a })}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-[10px] uppercase tracking-[0.05em] text-ds-faint">
                {t('canvasInspectorArrowEnd', 'End')}
              </span>
              <div className="min-w-0 flex-1">
                <Seg
                  value={arrowheadEnd as Arrowhead | typeof MIXED | undefined}
                  options={arrowheadOptions(false)}
                  onPick={(a) => updateAll('set-arrowhead-end', { arrowheadEnd: a })}
                />
              </div>
            </div>
          </div>
        </Section>
      )}

      {/* Corner radius — boxy shapes only */}
      {!singleHtmlFrame && !isLinear && (
        <Section title={t('canvasInspectorCorner', 'Corner radius')}>
          <NumberBox
            icon="R"
            value={cornerR}
            min={0}
            onCommit={(n) => updateAll('set-corner-radius', { cornerRadius: Math.max(0, n) })}
          />
        </Section>
      )}

      {/* Opacity */}
      <Section title={t('canvasInspectorOpacity', 'Opacity')}>
        <OpacitySlider
          value={opacity}
          onChange={(v) => updateAll('set-opacity', { opacity: v })}
        />
      </Section>

      {/* Text */}
      {allText && (
        <Section title={t('canvasInspectorText', 'Text')}>
          <div className="space-y-1.5">
            <div className="grid grid-cols-2 gap-x-1 gap-y-0.5">
              <NumberBox
                icon="A"
                value={fontSize}
                min={1}
                onCommit={(n) => updateAll('set-font-size', { fontSize: Math.max(1, n) })}
              />
              <NumberBox
                icon="W"
                value={fontWeight}
                step={100}
                onCommit={(n) =>
                  updateAll('set-font-weight', { fontWeight: Math.max(100, Math.min(900, n)) })
                }
              />
            </div>
            <input
              type="text"
              value={fontFamily === MIXED ? '' : ((fontFamily as string) ?? '')}
              placeholder={fontFamily === MIXED ? '—' : 'font-family'}
              onChange={(e) => updateAll('set-font-family', { fontFamily: e.target.value })}
              className="h-7 w-full rounded-[8px] bg-transparent px-2 text-[11.5px] text-ds-ink outline-none transition hover:bg-ds-hover/60 focus:bg-ds-hover/70 placeholder:text-ds-faint"
            />
            <Swatches
              value={fontColor}
              onPick={(c) => updateAll('set-font-color', { fontColor: c })}
            />
          </div>
        </Section>
      )}
    </div>
  )
}

export const PropertiesPanel = memo(PropertiesPanelInner)
