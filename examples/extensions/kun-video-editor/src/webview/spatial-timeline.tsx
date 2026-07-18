import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from 'react'
import {
  TIMELINE_GEOMETRY_LIMITS,
  createTimelineViewport,
  frameToTimelineX,
  layoutTimelineItems,
  normalizeTimelineRange,
  timelineXToFrame,
  visibleTimelineRange,
  zoomTimelineAt,
  type TimelineItemRect,
  type TimelineRange
} from '../engine/timeline-geometry.js'
import {
  collectTimelineSnapTargets,
  snapTimelineFrame,
  type TimelineSnapResult,
  type TimelineSnapState
} from '../engine/timeline-snap.js'
import {
  compileTimelineEditPlanOperations,
  planLinkedMove,
  planLinkedTrim,
  planRippleDelete
} from '../engine/timeline-edit-planners.js'
import type { LinkGroup, TimelineItem } from '../engine/schema.js'
import type { EditorController } from './controller.js'
import { formatMessage, type Messages } from './i18n.js'
import type {
  DerivedMediaRecordProjection,
  ItemProjection,
  ProjectProjection,
  TimelineOperation,
  TrackProjection
} from './model.js'

const LANE_HEIGHT = 58
const MIN_TIMELINE_WIDTH = 160
const DEFAULT_TIMELINE_WIDTH = 640
const SNAP_THRESHOLD_PIXELS = 8

type GestureRegion = 'body' | 'trim-start' | 'trim-end'

type ItemGesture = {
  pointerId: number
  itemId: string
  region: GestureRegion
  clientX: number
  originalStart: number
  originalEnd: number
  targetTrackId: string
  snap?: TimelineSnapState
}

type ItemPreview = {
  itemId: string
  startFrame: number
  endFrame: number
  trackId: string
  snap?: TimelineSnapResult
}

type RangeGesture = {
  pointerId: number
  anchorFrame: number
  targetTrackId: string
}

type RipplePreview = {
  targetTrackId: string
  plan: ReturnType<typeof planRippleDelete>
  operations: TimelineOperation[]
}

type ItemPropertiesPatch = Omit<
  Extract<TimelineOperation, { type: 'update-item-properties' }>,
  'type' | 'itemId'
>

export function SpatialTimeline(props: {
  controller: EditorController
  messages: Messages
}): React.JSX.Element {
  const { controller, messages } = props
  const project = controller.state.project!
  const durationFrames = Math.max(1, project.durationFrames)
  const activeSequence = project.sequences.find(({ id }) => id === project.activeSequenceId)
  const viewIdentity = `${project.id}:${project.activeSequenceId}`
  const viewportElement = useRef<HTMLDivElement | null>(null)
  const itemGesture = useRef<ItemGesture | undefined>(undefined)
  const rangeGesture = useRef<RangeGesture | undefined>(undefined)
  const latestPreview = useRef<ItemPreview | undefined>(undefined)
  const [viewportWidth, setViewportWidth] = useState(DEFAULT_TIMELINE_WIDTH)
  const [pixelsPerFrame, setPixelsPerFrame] = useState(() => sequencePixelsPerFrame(
    activeSequence?.viewState.zoom ?? 1,
    durationFrames
  ))
  const [scrollFrame, setScrollFrame] = useState(() => activeSequence?.viewState.scrollFrame ?? 0)
  const skipViewPersistence = useRef(true)
  const [snapping, setSnapping] = useState(true)
  const [preview, setPreview] = useState<ItemPreview | undefined>(undefined)
  const [selectedRange, setSelectedRange] = useState<TimelineRange | undefined>(undefined)
  const [selectedRangeTrackId, setSelectedRangeTrackId] = useState<string | undefined>(undefined)
  const [ripplePreview, setRipplePreview] = useState<RipplePreview | undefined>(undefined)
  const [rippleError, setRippleError] = useState<string | undefined>(undefined)

  useEffect(() => {
    const element = viewportElement.current
    if (!element) return
    const update = (): void => setViewportWidth(Math.max(MIN_TIMELINE_WIDTH, element.clientWidth || DEFAULT_TIMELINE_WIDTH))
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    skipViewPersistence.current = true
    setScrollFrame(activeSequence?.viewState.scrollFrame ?? 0)
    setPixelsPerFrame(sequencePixelsPerFrame(activeSequence?.viewState.zoom ?? 1, durationFrames))
    setPreview(undefined)
    latestPreview.current = undefined
    setSelectedRange(undefined)
    setSelectedRangeTrackId(undefined)
    setRipplePreview(undefined)
    setRippleError(undefined)
  }, [activeSequence?.viewState.scrollFrame, activeSequence?.viewState.zoom, durationFrames, viewIdentity])

  useEffect(() => {
    if (skipViewPersistence.current) {
      skipViewPersistence.current = false
      return
    }
    const zoom = boundedSequenceZoom(pixelsPerFrame / initialPixelsPerFrame(durationFrames))
    const nextScrollFrame = Math.max(0, Math.round(scrollFrame))
    if (
      activeSequence &&
      Math.abs(activeSequence.viewState.zoom - zoom) < 0.000001 &&
      activeSequence.viewState.scrollFrame === nextScrollFrame
    ) return
    const timeout = globalThis.setTimeout(() => {
      void controller.setSequenceView(project.activeSequenceId, zoom, nextScrollFrame)
    }, 400)
    return () => globalThis.clearTimeout(timeout)
  }, [activeSequence, controller, durationFrames, pixelsPerFrame, project.activeSequenceId, scrollFrame, viewIdentity])

  const viewport = useMemo(() => createTimelineViewport({
    durationFrames,
    pixelsPerFrame,
    scrollFrame,
    widthPixels: Math.min(TIMELINE_GEOMETRY_LIMITS.maxViewportPixels, viewportWidth)
  }), [durationFrames, pixelsPerFrame, scrollFrame, viewportWidth])

  useEffect(() => {
    if (viewport.scrollFrame !== scrollFrame) setScrollFrame(viewport.scrollFrame)
  }, [scrollFrame, viewport.scrollFrame])

  const tracks = useMemo(
    () => [...project.tracks].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)),
    [project.tracks]
  )
  const lanes = useMemo(() => tracks.map((track, order) => ({
    trackId: track.id,
    order,
    top: order * LANE_HEIGHT,
    height: LANE_HEIGHT
  })), [tracks])
  const spatialItems = useMemo(() => [
    ...project.items.map((item) => ({
      id: `item:${item.id}`,
      trackId: item.trackId,
      startFrame: item.timelineStartFrame,
      endFrame: item.timelineStartFrame + item.durationFrames,
      zIndex: 2
    })),
    ...project.captions.map((caption) => ({
      id: `caption:${caption.id}`,
      trackId: caption.trackId,
      startFrame: caption.startFrame,
      endFrame: caption.endFrame,
      zIndex: 1
    }))
  ], [project.captions, project.items])
  const layout = useMemo(
    () => layoutTimelineItems(viewport, lanes, spatialItems, 96),
    [lanes, spatialItems, viewport]
  )
  const rects = useMemo(
    () => new Map(layout.items.map((rect) => [rect.id, rect])),
    [layout.items]
  )
  const hiddenCount = layout.hiddenBefore + layout.hiddenAfter + layout.truncated
  const range = visibleTimelineRange(viewport)
  const rulerTicks = timelineTicks(range, 5)
  const beatTargets = useMemo(() => controller.state.audioAnalysisRecords
    .filter((record) => record.kind === 'beat-grid' && record.currentGrant !== false)
    .flatMap((record) => record.snapTargets ?? [])
    .sort((left, right) => left.frame - right.frame || left.id.localeCompare(right.id))
    .slice(0, 4_096), [controller.state.audioAnalysisRecords])
  const timelineSnapTargets = useMemo(() => collectTimelineSnapTargets({
    playheadFrame: controller.state.playheadFrame,
    clips: project.items.map((candidate) => ({
      id: candidate.id,
      trackId: candidate.trackId,
      startFrame: candidate.timelineStartFrame,
      endFrame: candidate.timelineStartFrame + candidate.durationFrames
    })),
    captions: project.captions,
    beats: beatTargets.map(({ id, frame, kind }) => ({ id, frame, label: kind }))
  }), [beatTargets, controller.state.playheadFrame, project.captions, project.items])
  const visibleBeatTargets = beatTargets
    .filter(({ frame }) => frame >= range.startFrame && frame <= range.endFrame)
    .slice(0, 512)
  const maximumScroll = Math.max(0, durationFrames - viewport.widthPixels / viewport.pixelsPerFrame)
  const playheadX = frameToTimelineX(viewport, Math.min(durationFrames, controller.state.playheadFrame))
  const snapGuideX = preview?.snap?.snapped
    ? frameToTimelineX(viewport, preview.snap.frame)
    : undefined
  const selectedItem = project.items.find(({ id }) => id === controller.state.selectedItemId)
  const ripplePreviewIds = useMemo(() => new Set([
    ...(ripplePreview?.plan.changedIds ?? []),
    ...(ripplePreview?.plan.createdIds ?? [])
  ]), [ripplePreview])

  const updateZoom = (next: number): void => {
    const zoomed = zoomTimelineAt(viewport, viewport.widthPixels / 2, next)
    setPixelsPerFrame(zoomed.pixelsPerFrame)
    setScrollFrame(zoomed.scrollFrame)
  }

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      updateZoom(viewport.pixelsPerFrame * (event.deltaY > 0 ? 0.82 : 1.22))
      return
    }
    if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      event.preventDefault()
      const delta = event.deltaX || event.deltaY
      setScrollFrame(Math.min(maximumScroll, Math.max(0, viewport.scrollFrame + delta / viewport.pixelsPerFrame)))
    }
  }

  const beginRange = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || isTimelineControl(event.target)) return
    const frame = eventFrame(event, viewport)
    const targetTrackId = event.currentTarget.dataset.timelineTrackId
    if (!targetTrackId) return
    rangeGesture.current = { pointerId: event.pointerId, anchorFrame: frame, targetTrackId }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setSelectedRange(undefined)
    setSelectedRangeTrackId(targetTrackId)
    setRipplePreview(undefined)
    setRippleError(undefined)
    controller.seek(frame)
  }

  const moveRange = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const gesture = rangeGesture.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const focus = eventFrame(event, viewport)
    setSelectedRange(normalizeTimelineRange(gesture.anchorFrame, focus))
    setSelectedRangeTrackId(gesture.targetTrackId)
    setRipplePreview(undefined)
    setRippleError(undefined)
  }

  const endRange = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const gesture = rangeGesture.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    rangeGesture.current = undefined
  }

  const beginItem = (
    event: ReactPointerEvent<HTMLElement>,
    item: ItemProjection,
    region: GestureRegion
  ): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    controller.selectItem(item.id)
    controller.seek(item.timelineStartFrame)
    if (item.locked || trackFor(project, item.trackId)?.locked) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    itemGesture.current = {
      pointerId: event.pointerId,
      itemId: item.id,
      region,
      clientX: event.clientX,
      originalStart: item.timelineStartFrame,
      originalEnd: item.timelineStartFrame + item.durationFrames,
      targetTrackId: item.trackId
    }
    const initialPreview = {
      itemId: item.id,
      startFrame: item.timelineStartFrame,
      endFrame: item.timelineStartFrame + item.durationFrames,
      trackId: item.trackId
    }
    latestPreview.current = initialPreview
    setPreview(initialPreview)
  }

  const moveItem = (event: ReactPointerEvent<HTMLElement>): void => {
    const gesture = itemGesture.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    event.stopPropagation()
    const item = project.items.find(({ id }) => id === gesture.itemId)
    if (!item) return
    const deltaFrames = Math.round((event.clientX - gesture.clientX) / viewport.pixelsPerFrame)
    const duration = gesture.originalEnd - gesture.originalStart
    const requested = gesture.region === 'trim-end'
      ? Math.max(gesture.originalStart + 1, gesture.originalEnd + deltaFrames)
      : Math.max(0, gesture.originalStart + deltaFrames)
    const snap = snapping
      ? snapTimelineFrame({
          requestedFrame: requested,
          pixelsPerFrame: viewport.pixelsPerFrame,
          thresholdPixels: SNAP_THRESHOLD_PIXELS,
          targets: timelineSnapTargets.filter(({ id }) =>
            id !== `${item.id}:start` && id !== `${item.id}:end`
          ),
          ...(gesture.snap ? { previous: gesture.snap } : {}),
          preferredTrackId: item.trackId
        })
      : undefined
    const frame = snap?.frame ?? requested
    if (snap?.target) {
      gesture.snap = { targetId: snap.target.id, frame: snap.target.frame, kind: snap.target.kind }
    } else {
      gesture.snap = undefined
    }
    const targetTrackId = gesture.region === 'body'
      ? compatibleDropTrack(project, item, event.clientX, event.clientY) ?? gesture.targetTrackId
      : item.trackId
    gesture.targetTrackId = targetTrackId
    const nextPreview = {
      itemId: item.id,
      startFrame: gesture.region === 'trim-end'
        ? gesture.originalStart
        : Math.min(frame, gesture.originalEnd - 1),
      endFrame: gesture.region === 'body'
        ? frame + duration
        : gesture.region === 'trim-start'
          ? gesture.originalEnd
          : Math.max(gesture.originalStart + 1, frame),
      trackId: targetTrackId,
      ...(snap ? { snap } : {})
    }
    latestPreview.current = nextPreview
    setPreview(nextPreview)
  }

  const endItem = (event: ReactPointerEvent<HTMLElement>): void => {
    const gesture = itemGesture.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    event.stopPropagation()
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    itemGesture.current = undefined
    const item = project.items.find(({ id }) => id === gesture.itemId)
    const finalPreview = latestPreview.current
    latestPreview.current = undefined
    setPreview(undefined)
    if (!item || !finalPreview) return
    if (gesture.region === 'body') {
      void commitLinkedMove(controller, project, item, finalPreview, messages)
    } else {
      void commitLinkedTrim(controller, project, item, finalPreview, messages)
    }
  }

  const onItemKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, item: ItemProjection): void => {
    const step = event.shiftKey ? 10 : 1
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const delta = event.key === 'ArrowLeft' ? -step : step
      const startFrame = Math.max(0, item.timelineStartFrame + delta)
      const preview: ItemPreview = {
        itemId: item.id,
        startFrame,
        endFrame: startFrame + item.durationFrames,
        trackId: item.trackId
      }
      void commitLinkedMove(controller, project, item, preview, messages)
      return
    }
    if (event.key === '[' || event.key === ']') {
      event.preventDefault()
      const startFrame = event.key === '['
        ? Math.min(item.timelineStartFrame + step, item.timelineStartFrame + item.durationFrames - 1)
        : item.timelineStartFrame
      const endFrame = event.key === ']'
        ? Math.max(item.timelineStartFrame + 1, item.timelineStartFrame + item.durationFrames - step)
        : item.timelineStartFrame + item.durationFrames
      void commitLinkedTrim(controller, project, item, {
        itemId: item.id,
        startFrame,
        endFrame,
        trackId: item.trackId
      }, messages)
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      const itemIds = linkedProjectItemIds(project, item.id)
      const itemIdSet = new Set(itemIds)
      const linkedGroupIds = project.linkGroups
        .filter((group) => group.locked && group.itemIds.some((itemId) => itemIdSet.has(itemId)))
        .map(({ id }) => id)
      const operations: TimelineOperation[] = [
        ...linkedGroupIds.map((linkGroupId) => ({ type: 'delete-link-group' as const, linkGroupId })),
        ...itemIds.map((itemId) => ({ type: 'delete-item' as const, itemId }))
      ]
      if (operations.length > 0 && operations.length <= 200 && window.confirm(messages.deleteItemConfirm)) {
        void controller.applyOperations(
          operations,
          formatMessage(messages.deleteSummary, { id: item.id })
        )
      }
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      controller.seek(item.timelineStartFrame)
    } else if (event.key === 'End') {
      event.preventDefault()
      controller.seek(item.timelineStartFrame + item.durationFrames)
    }
  }

  const previewRippleDelete = (): void => {
    if (!selectedRange || !selectedRangeTrackId || project.truncated) return
    const targetTrack = trackFor(project, selectedRangeTrackId)
    if (!targetTrack || targetTrack.kind === 'caption') return
    try {
      const plan = planRippleDelete({
        items: project.items.map(toEngineItem),
        tracks: project.tracks
          .filter(({ kind }) => kind !== 'caption')
          .map((track) => ({
            id: track.id,
            locked: track.locked ?? false,
            syncLocked: track.syncLocked ?? false
          })),
        targetTrackId: selectedRangeTrackId,
        startFrame: selectedRange.startFrame,
        endFrame: selectedRange.endFrame
      })
      const operations = compileTimelineEditPlanOperations(
        project.items.map(toEngineItem),
        plan
      ) as TimelineOperation[]
      setRipplePreview({ targetTrackId: selectedRangeTrackId, plan, operations })
      setRippleError(undefined)
    } catch (error) {
      setRipplePreview(undefined)
      setRippleError(error instanceof Error ? error.message.slice(0, 256) : messages.ripplePreviewUnavailable)
    }
  }

  const applyRippleDelete = async (): Promise<void> => {
    if (!ripplePreview || ripplePreview.operations.length === 0) return
    await controller.applyOperations(
      ripplePreview.operations,
      formatMessage(messages.rippleDeleteSummary, {
        start: ripplePreview.plan.range.startFrame,
        end: ripplePreview.plan.range.endFrame
      })
    )
    setRipplePreview(undefined)
    setSelectedRange(undefined)
    setSelectedRangeTrackId(undefined)
    setRippleError(undefined)
  }

  return (
    <div className="spatial-timeline" onWheel={onWheel}>
      <div className="timeline-spatial-toolbar">
        <div className="timeline-zoom-controls" aria-label={messages.timelineZoom}>
          <button type="button" onClick={() => updateZoom(viewport.pixelsPerFrame / 1.35)} aria-label={messages.zoomOut}>−</button>
          <input
            type="range"
            min={TIMELINE_GEOMETRY_LIMITS.minPixelsPerFrame}
            max={16}
            step={0.01}
            value={viewport.pixelsPerFrame}
            onChange={(event) => updateZoom(Number(event.target.value))}
            aria-label={messages.timelineZoom}
          />
          <button type="button" onClick={() => updateZoom(viewport.pixelsPerFrame * 1.35)} aria-label={messages.zoomIn}>+</button>
        </div>
        <button type="button" className="snap-toggle" aria-pressed={snapping} onClick={() => setSnapping((value) => !value)}>
          {snapping ? messages.snapEnabled : messages.snapDisabled}
        </button>
        <small>{formatMessage(messages.timelineVisibleItems, { visible: layout.items.length, hidden: hiddenCount })}</small>
      </div>
      <div className="timeline-ruler-row" aria-hidden="true">
        <span className="timeline-ruler-gutter" />
        <div className="timeline-ruler-spatial">
          {rulerTicks.map((frame) => <span key={frame} style={{ left: frameToTimelineX(viewport, frame) }}>{formatTimelineFrame(project, frame)}</span>)}
          {visibleBeatTargets.map((target) => <span
            key={target.id}
            className={`timeline-beat-marker ${target.kind}`}
            data-beat-frame={target.frame}
            style={{ left: frameToTimelineX(viewport, target.frame) }}
            title={`${target.kind} · ${formatTimelineFrame(project, target.frame)}`}
          />)}
        </div>
      </div>
      <div className="timeline-spatial-grid" role="list" aria-label={messages.orderedTimelineTracks}>
        {tracks.map((track) => {
          const trackItems = project.items.filter((item) =>
            (preview?.itemId === item.id ? preview.trackId : item.trackId) === track.id && rects.has(`item:${item.id}`)
          )
          const captions = project.captions.filter((caption) => caption.trackId === track.id && rects.has(`caption:${caption.id}`))
          return (
            <div className="timeline-track-row" role="listitem" key={track.id}>
              <TrackHeader
                track={track}
                messages={messages}
                onUpdate={(patch) => void controller.applyOperations(
                  [{ type: 'update-track-state', trackId: track.id, ...patch }],
                  formatMessage(messages.trackStateSummary, { id: track.id })
                )}
              />
              <div
                ref={track.id === tracks[0]?.id ? viewportElement : undefined}
                className={`timeline-spatial-lane track-${track.kind}`}
                data-timeline-track-id={track.id}
                onPointerDown={beginRange}
                onPointerMove={moveRange}
                onPointerUp={endRange}
                onPointerCancel={endRange}
                aria-label={`${track.name} · ${formatMessage(messages.trackItems, { count: project.items.filter((item) => item.trackId === track.id).length })}`}
              >
                <TimelineOverlays
                  viewport={viewport}
                  playheadX={playheadX}
                  snapGuideX={snapGuideX}
                  selectedRange={selectedRange}
                />
                {ripplePreview?.plan.items
                  .filter((item) => item.trackId === track.id && ripplePreviewIds.has(item.id))
                  .filter((item) => item.timelineStartFrame + item.durationFrames > range.startFrame && item.timelineStartFrame < range.endFrame)
                  .slice(0, 200)
                  .map((item) => <span
                    key={`ripple-preview:${item.id}`}
                    className="timeline-ripple-preview-clip"
                    data-item-id={item.id}
                    style={{
                      left: frameToTimelineX(viewport, item.timelineStartFrame),
                      width: Math.max(1, item.durationFrames * viewport.pixelsPerFrame)
                    }}
                    aria-hidden="true"
                  />)}
                {trackItems.map((item) => {
                  const rect = rects.get(`item:${item.id}`)!
                  const display = preview?.itemId === item.id
                    ? previewRect(viewport, rect, preview)
                    : rect
                  const waveformRecord = controller.state.derivedRecords.find((record) =>
                    record.kind === 'waveform' && record.assetId === item.assetId &&
                    (record.status === 'partial' || record.status === 'ready')
                  )
                  return <TimelineClip
                    key={item.id}
                    item={item}
                    rect={display}
                    project={project}
                    controller={controller}
                    selected={controller.state.selectedItemId === item.id}
                    messages={messages}
                    onBegin={beginItem}
                    onMove={moveItem}
                    onEnd={endItem}
                    onKeyDown={onItemKeyDown}
                    onOpen={() => void controller.openAsset(item.assetId)}
                    waveformRecord={waveformRecord}
                  />
                })}
                {captions.map((caption) => {
                  const rect = rects.get(`caption:${caption.id}`)!
                  return <button
                    type="button"
                    key={caption.id}
                    className={controller.state.selectedCaptionId === caption.id ? 'timeline-caption selected' : 'timeline-caption'}
                    style={rectStyle(rect)}
                    onClick={(event) => {
                      event.stopPropagation()
                      controller.selectCaption(caption.id)
                      controller.seek(caption.startFrame)
                    }}
                  ><span>{caption.text}</span><small>{caption.startFrame}–{caption.endFrame}f</small></button>
                })}
                {trackItems.length === 0 && captions.length === 0 && <span className="empty-lane">{messages.dropImportMedia}</span>}
              </div>
            </div>
          )
        })}
      </div>
      {selectedRange && selectedRangeTrackId && (
        <div className="timeline-ripple-preview-actions" data-state={ripplePreview ? 'preview' : 'selection'}>
          {!ripplePreview ? (
            <button
              type="button"
              className="quiet-button"
              disabled={project.truncated || trackFor(project, selectedRangeTrackId)?.kind === 'caption'}
              onClick={previewRippleDelete}
            >{messages.previewRippleDelete}</button>
          ) : (
            <>
              <span>{formatMessage(messages.ripplePreviewSummary, {
                operations: ripplePreview.operations.length,
                tracks: new Set(ripplePreview.plan.shifts.map(({ trackId }) => trackId)).size
              })}</span>
              <button type="button" onClick={() => void applyRippleDelete()}>{messages.applyRippleDelete}</button>
              <button type="button" className="quiet-button" onClick={() => setRipplePreview(undefined)}>{messages.cancelRipplePreview}</button>
            </>
          )}
          {project.truncated && <small>{messages.ripplePreviewRequiresCompleteProject}</small>}
          {rippleError && <small role="alert">{rippleError}</small>}
        </div>
      )}
      <label className="timeline-scroll-control">
        <span>{messages.timelineScroll}</span>
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.ceil(maximumScroll))}
          step={1}
          value={Math.min(maximumScroll, viewport.scrollFrame)}
          disabled={maximumScroll <= 0}
          onChange={(event) => setScrollFrame(Number(event.target.value))}
        />
      </label>
      {selectedItem && <ClipProperties
        key={selectedItem.id}
        controller={controller}
        item={selectedItem}
        messages={messages}
      />}
      <div className="timeline-live-status" aria-live="polite">
        {preview?.snap?.snapped && preview.snap.target
          ? formatMessage(messages.snapFeedback, { kind: preview.snap.target.kind, frame: preview.snap.frame })
          : selectedRange && selectedRange.endFrame > selectedRange.startFrame
            ? formatMessage(messages.timelineRangeSelection, {
                start: selectedRange.startFrame,
                end: selectedRange.endFrame
              })
            : messages.timelineKeyboardHelp}
      </div>
    </div>
  )
}

function TrackHeader(props: {
  track: TrackProjection
  messages: Messages
  onUpdate(patch: { muted?: boolean; locked?: boolean; syncLocked?: boolean }): void
}): React.JSX.Element {
  const { track, messages } = props
  const kind = track.kind === 'video'
    ? messages.trackKindVideo
    : track.kind === 'audio'
      ? messages.trackKindAudio
      : messages.trackKindCaption
  const name = ({
    'video-1': messages.defaultVideoTrack1,
    'video-2': messages.defaultVideoTrack2,
    'audio-1': messages.defaultAudioTrack1,
    'captions-1': messages.defaultCaptionTrack
  } as Record<string, string>)[track.id] ?? track.name
  return <div className="timeline-spatial-header">
    <strong>{name}</strong>
    <small>{kind}</small>
    <span className="timeline-track-badges">
      {track.syncLocked && <span>{messages.syncLocked}</span>}
      {track.muted && <span>{messages.muted}</span>}
      {track.visible === false && <span>{messages.hidden}</span>}
      {track.locked && <span>{messages.locked}</span>}
    </span>
    <span className="timeline-track-controls">
      <button
        type="button"
        aria-label={track.muted ? messages.trackUnmute : messages.trackMute}
        aria-pressed={track.muted ?? false}
        onClick={() => props.onUpdate({ muted: !(track.muted ?? false) })}
      >M</button>
      <button
        type="button"
        aria-label={track.syncLocked ? messages.disableSyncLock : messages.enableSyncLock}
        aria-pressed={track.syncLocked ?? false}
        onClick={() => props.onUpdate({ syncLocked: !(track.syncLocked ?? false) })}
      >S</button>
      <button
        type="button"
        aria-label={track.locked ? messages.unlockTrack : messages.lockTrack}
        aria-pressed={track.locked ?? false}
        onClick={() => props.onUpdate({ locked: !(track.locked ?? false) })}
      >L</button>
    </span>
  </div>
}

function ClipProperties(props: {
  controller: EditorController
  item: ItemProjection
  messages: Messages
}): React.JSX.Element {
  const { controller, item, messages } = props
  const [volume, setVolume] = useState(item.volume ?? 1)
  const [fadeInFrames, setFadeInFrames] = useState(item.fadeInFrames)
  const [fadeOutFrames, setFadeOutFrames] = useState(item.fadeOutFrames)
  useEffect(() => {
    setVolume(item.volume ?? 1)
    setFadeInFrames(item.fadeInFrames)
    setFadeOutFrames(item.fadeOutFrames)
  }, [item.fadeInFrames, item.fadeOutFrames, item.id, item.volume])
  const update = (patch: ItemPropertiesPatch): void => {
    void controller.applyOperations(
      [{ type: 'update-item-properties', itemId: item.id, ...patch }],
      formatMessage(messages.itemPropertiesSummary, { id: item.id })
    )
  }
  const locked = item.locked ?? false
  return <fieldset className="timeline-clip-properties">
    <legend>{messages.clipProperties}</legend>
    <span className="timeline-clip-state-buttons">
      <button type="button" disabled={locked} aria-pressed={item.muted ?? false} onClick={() => update({ muted: !(item.muted ?? false) })}>
        {item.muted ? messages.unmuteClip : messages.muteClip}
      </button>
      <button type="button" disabled={locked} aria-pressed={item.visible === false} onClick={() => update({ visible: item.visible === false })}>
        {item.visible === false ? messages.showClip : messages.hideClip}
      </button>
      <button type="button" aria-pressed={locked} onClick={() => update({ locked: !locked })}>
        {locked ? messages.unlockClip : messages.lockClip}
      </button>
    </span>
    <label><span>{messages.volume}</span><input type="number" min={0} max={4} step={0.05} value={volume} disabled={locked} onChange={(event) => setVolume(Number(event.target.value))} /></label>
    <label><span>{messages.fadeIn} ({messages.frames})</span><input type="number" min={0} max={Math.max(0, item.durationFrames - fadeOutFrames)} value={fadeInFrames} disabled={locked} onChange={(event) => setFadeInFrames(Number(event.target.value))} /></label>
    <label><span>{messages.fadeOut} ({messages.frames})</span><input type="number" min={0} max={Math.max(0, item.durationFrames - fadeInFrames)} value={fadeOutFrames} disabled={locked} onChange={(event) => setFadeOutFrames(Number(event.target.value))} /></label>
    <button
      type="button"
      disabled={locked || fadeInFrames + fadeOutFrames > item.durationFrames}
      onClick={() => update({ volume, fadeInFrames, fadeOutFrames })}
    >{messages.applyAudioProperties}</button>
  </fieldset>
}

function TimelineClip(props: {
  item: ItemProjection
  rect: TimelineItemRect
  project: ProjectProjection
  controller: EditorController
  selected: boolean
  messages: Messages
  onBegin(event: ReactPointerEvent<HTMLElement>, item: ItemProjection, region: GestureRegion): void
  onMove(event: ReactPointerEvent<HTMLElement>): void
  onEnd(event: ReactPointerEvent<HTMLElement>): void
  onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, item: ItemProjection): void
  onOpen(): void
  waveformRecord?: DerivedMediaRecordProjection
}): React.JSX.Element {
  const asset = props.project.assets.find(({ id }) => id === props.item.assetId)
  const name = asset?.name ?? props.item.assetId
  const end = props.item.timelineStartFrame + props.item.durationFrames
  return (
    <div
      className={props.selected ? 'timeline-clip selected' : 'timeline-clip'}
      data-item-id={props.item.id}
      data-linked={props.item.linkGroupId ? 'true' : 'false'}
      data-muted={props.item.muted ? 'true' : 'false'}
      data-visible={props.item.visible === false ? 'false' : 'true'}
      style={rectStyle(props.rect)}
    >
      <button
        type="button"
        className="timeline-clip-body"
        aria-pressed={props.selected}
        aria-label={formatMessage(props.messages.timelineItemLabel, {
          name,
          start: props.item.timelineStartFrame,
          end
        })}
        onClick={() => {
          props.controller.selectItem(props.item.id)
          props.controller.seek(props.item.timelineStartFrame)
        }}
        onPointerDown={(event) => props.onBegin(event, props.item, 'body')}
        onPointerMove={props.onMove}
        onPointerUp={props.onEnd}
        onPointerCancel={props.onEnd}
        onDoubleClick={props.onOpen}
        onKeyDown={(event) => props.onKeyDown(event, props.item)}
      >
        <strong>{name}</strong>
        <small>{props.item.timelineStartFrame}–{end}f</small>
        {asset?.kind === 'audio' && <Waveform
          record={props.waveformRecord}
          controller={props.controller}
          messages={props.messages}
          itemId={props.item.id}
        />}
        <span className="timeline-clip-badges">
          {props.item.linkGroupId && <span>{props.messages.linkedGroup}</span>}
          {props.item.muted && <span>{props.messages.muted}</span>}
          {props.item.visible === false && <span>{props.messages.hidden}</span>}
          {props.item.locked && <span>{props.messages.locked}</span>}
        </span>
      </button>
      <button
        type="button"
        className="timeline-trim-handle trim-start"
        aria-label={formatMessage(props.messages.trimStartHandle, { name })}
        onPointerDown={(event) => props.onBegin(event, props.item, 'trim-start')}
        onPointerMove={props.onMove}
        onPointerUp={props.onEnd}
        onPointerCancel={props.onEnd}
      />
      <button
        type="button"
        className="timeline-trim-handle trim-end"
        aria-label={formatMessage(props.messages.trimEndHandle, { name })}
        onPointerDown={(event) => props.onBegin(event, props.item, 'trim-end')}
        onPointerMove={props.onMove}
        onPointerUp={props.onEnd}
        onPointerCancel={props.onEnd}
      />
    </div>
  )
}

function Waveform(props: {
  record?: DerivedMediaRecordProjection
  controller: EditorController
  messages: Messages
  itemId: string
}): React.JSX.Element {
  const [resourceUrl, setResourceUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    let active = true
    setResourceUrl(undefined)
    if (!props.record?.artifactHandleId || !props.controller.openDerivedResource) return () => { active = false }
    void props.controller.openDerivedResource(props.record.id)
      .then((url) => { if (active) setResourceUrl(url) })
      .catch(() => { if (active) setResourceUrl(undefined) })
    return () => { active = false }
  }, [props.controller, props.record?.artifactHandleId, props.record?.id])
  const state = props.record?.status ?? 'pending'
  const label = state === 'ready'
    ? props.messages.waveformReady
    : state === 'partial'
      ? props.messages.waveformPartial
      : props.messages.waveformPending
  return <span className="timeline-waveform" data-state={state} aria-label={label}>
    {resourceUrl
      ? <img src={resourceUrl} alt="" draggable={false} />
      : Array.from({ length: 14 }, (_, index) => <i key={index} style={{ height: `${waveHeight(props.itemId, index)}%` }} />)}
  </span>
}

function TimelineOverlays(props: {
  viewport: ReturnType<typeof createTimelineViewport>
  playheadX: number
  snapGuideX?: number
  selectedRange?: TimelineRange
}): React.JSX.Element {
  return <>
    {props.selectedRange && props.selectedRange.endFrame > props.selectedRange.startFrame && <span
      className="timeline-range-selection"
      style={{
        left: frameToTimelineX(props.viewport, props.selectedRange.startFrame),
        width: Math.max(1, (props.selectedRange.endFrame - props.selectedRange.startFrame) * props.viewport.pixelsPerFrame)
      }}
    />}
    {props.playheadX >= 0 && props.playheadX <= props.viewport.widthPixels && <span className="timeline-playhead" style={{ left: props.playheadX }} />}
    {props.snapGuideX !== undefined && props.snapGuideX >= 0 && props.snapGuideX <= props.viewport.widthPixels && <span className="timeline-snap-guide" style={{ left: props.snapGuideX }} />}
  </>
}

async function commitLinkedMove(
  controller: EditorController,
  project: ProjectProjection,
  item: ItemProjection,
  preview: ItemPreview,
  messages: Messages
): Promise<void> {
  const operations = linkedMoveOperations(project, item, preview.startFrame, preview.trackId)
  if (operations.length === 0) return
  await controller.applyOperations(
    operations,
    formatMessage(operations.length > 1 ? messages.moveLinkedSummary : messages.moveSummary, { id: item.id })
  )
}

export function linkedMoveOperations(
  project: ProjectProjection,
  item: ItemProjection,
  timelineStartFrame: number,
  trackId = item.trackId
): TimelineOperation[] {
  const deltaFrames = timelineStartFrame - item.timelineStartFrame
  if (deltaFrames === 0 && trackId === item.trackId) return []
  const items = project.items.map(toEngineItem)
  const plan = planLinkedMove({
    items,
    linkGroups: projectedLinkGroups(project.linkGroups),
    tracks: project.tracks,
    itemId: item.id,
    deltaFrames,
    targetTrackId: trackId
  })
  return compileTimelineEditPlanOperations(items, plan) as TimelineOperation[]
}

async function commitLinkedTrim(
  controller: EditorController,
  project: ProjectProjection,
  item: ItemProjection,
  preview: ItemPreview,
  messages: Messages
): Promise<void> {
  const operations = linkedTrimOperations(project, item, preview.startFrame, preview.endFrame)
  if (operations.length === 0) return
  await controller.applyOperations(
    operations,
    formatMessage(operations.length > 1 ? messages.trimLinkedSummary : messages.trimSummary, { id: item.id })
  )
}

export function linkedTrimOperations(
  project: ProjectProjection,
  item: ItemProjection,
  startFrame: number,
  endFrame: number
): TimelineOperation[] {
  if (startFrame === item.timelineStartFrame && endFrame === item.timelineStartFrame + item.durationFrames) return []
  const items = project.items.map(toEngineItem)
  const plan = planLinkedTrim({
    items,
    linkGroups: projectedLinkGroups(project.linkGroups),
    tracks: project.tracks,
    itemId: item.id,
    startFrame,
    endFrame
  })
  return compileTimelineEditPlanOperations(items, plan) as TimelineOperation[]
}

function projectedLinkGroups(groups: ProjectProjection['linkGroups']): LinkGroup[] {
  return groups.map(({ id, kind, itemIds, locked }) => ({ id, kind, itemIds: [...itemIds], locked }))
}

export function linkedProjectItemIds(project: ProjectProjection, itemId: string): string[] {
  const result = new Set([itemId])
  let changed = true
  while (changed) {
    changed = false
    for (const group of project.linkGroups) {
      if (!group.locked || !group.itemIds.some((id) => result.has(id))) continue
      for (const id of group.itemIds) {
        if (!project.items.some((item) => item.id === id) || result.has(id)) continue
        result.add(id)
        changed = true
      }
    }
  }
  return [...result].sort()
}

function toEngineItem(item: ItemProjection): TimelineItem {
  return {
    id: item.id,
    assetId: item.assetId,
    trackId: item.trackId,
    timelineStartFrame: item.timelineStartFrame,
    durationFrames: item.durationFrames,
    sourceStartUs: item.sourceStartUs,
    sourceEndUs: item.sourceEndUs,
    speed: item.speed,
    transform: item.transform,
    opacity: item.opacity,
    fadeInFrames: item.fadeInFrames,
    fadeOutFrames: item.fadeOutFrames,
    ...(item.linkGroupId ? { linkGroupId: item.linkGroupId } : {}),
    ...(item.nestedSequenceId ? { nestedSequenceId: item.nestedSequenceId } : {}),
    ...(item.volume !== undefined ? { volume: item.volume } : {}),
    ...(item.muted !== undefined ? { muted: item.muted } : {}),
    ...(item.visible !== undefined ? { visible: item.visible } : {}),
    ...(item.locked !== undefined ? { locked: item.locked } : {}),
    ...(item.crop ? { crop: structuredClone(item.crop) } : {}),
    ...(item.effects ? { effects: structuredClone(item.effects) } : {}),
    ...(item.keyframes ? { keyframes: structuredClone(item.keyframes) } : {})
  }
}

function previewRect(
  viewport: ReturnType<typeof createTimelineViewport>,
  rect: TimelineItemRect,
  preview: ItemPreview
): TimelineItemRect {
  return {
    ...rect,
    trackId: preview.trackId,
    startFrame: preview.startFrame,
    endFrame: preview.endFrame,
    left: frameToTimelineX(viewport, preview.startFrame),
    width: Math.max(1, (preview.endFrame - preview.startFrame) * viewport.pixelsPerFrame)
  }
}

function rectStyle(rect: TimelineItemRect): CSSProperties {
  return { left: rect.left, width: rect.width }
}

function trackFor(project: ProjectProjection, trackId: string): TrackProjection | undefined {
  return project.tracks.find(({ id }) => id === trackId)
}

function compatibleDropTrack(
  project: ProjectProjection,
  item: ItemProjection,
  clientX: number,
  clientY: number
): string | undefined {
  if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') return undefined
  const element = document.elementFromPoint(clientX, clientY)
  const lane = element?.closest<HTMLElement>('[data-timeline-track-id]')
  const trackId = lane?.dataset.timelineTrackId
  const target = trackId ? trackFor(project, trackId) : undefined
  const asset = project.assets.find(({ id }) => id === item.assetId)
  if (!target || target.locked || target.kind === 'caption') return undefined
  if (asset?.kind === 'audio' && target.kind !== 'audio') return undefined
  if (asset?.kind === 'video' && target.kind !== 'video') return undefined
  return target.id
}

function eventFrame(
  event: ReactPointerEvent<HTMLElement>,
  viewport: ReturnType<typeof createTimelineViewport>
): number {
  const rect = event.currentTarget.getBoundingClientRect()
  return Math.min(viewport.durationFrames, Math.max(0, timelineXToFrame(viewport, event.clientX - rect.left, 'round')))
}

function isTimelineControl(target: EventTarget): boolean {
  return typeof Element !== 'undefined' && target instanceof Element &&
    Boolean(target.closest('button, input, .timeline-clip, .timeline-caption'))
}

function initialPixelsPerFrame(durationFrames: number): number {
  return Math.min(8, Math.max(0.08, DEFAULT_TIMELINE_WIDTH / Math.max(120, durationFrames)))
}

function boundedSequenceZoom(value: number): number {
  return Math.min(1_000, Math.max(0.01, Number.isFinite(value) ? value : 1))
}

function sequencePixelsPerFrame(zoom: number, durationFrames: number): number {
  return Math.min(
    TIMELINE_GEOMETRY_LIMITS.maxPixelsPerFrame,
    Math.max(
      TIMELINE_GEOMETRY_LIMITS.minPixelsPerFrame,
      initialPixelsPerFrame(durationFrames) * boundedSequenceZoom(zoom)
    )
  )
}

function timelineTicks(range: TimelineRange, count: number): number[] {
  const span = Math.max(1, range.endFrame - range.startFrame)
  const result: number[] = []
  for (let index = 0; index <= count; index += 1) {
    result.push(Math.round(range.startFrame + span * index / count))
  }
  return [...new Set(result)]
}

function formatTimelineFrame(project: ProjectProjection, frame: number): string {
  const seconds = frame * project.fps.denominator / project.fps.numerator
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60)
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

function waveHeight(id: string, index: number): number {
  let hash = index * 17 + 31
  for (const character of id) hash = (hash * 33 + character.charCodeAt(0)) % 97
  return 28 + hash % 68
}
