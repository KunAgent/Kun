import { createHash } from 'node:crypto'
import { engineError } from './errors.js'
import {
  MULTICAM_LIMITS,
  evaluateMulticamCoverage,
  validateMulticamGroup,
  type MulticamGroup,
  type MulticamLayoutSlot,
  type MulticamProgramFragment,
  type MulticamSourceSlice
} from './multicam.js'
import {
  RENDER_IR_LIMITS,
  compileRenderIr,
  type CanonicalRenderIr,
  type RenderIrCompileOptions
} from './render-ir.js'
import { generateRenderPlan, type RenderPlan, type RenderRequest } from './render-plan.js'
import { flattenNestedRenderIr } from './nested-render.js'
import type { TimelineItem, Track, VideoProject } from './schema.js'
import { framesToMicroseconds } from './time.js'
import { assertValidTimeline } from './timeline.js'

export type MulticamProgramProjection = {
  schemaVersion: 1
  groupId: string
  sequenceId: string
  revision: number
  durationFrames: number
  complete: boolean
  programDigest: string
  fragments: Array<{
    id: string
    startFrame: number
    endFrame: number
    selection: MulticamProgramFragment['selection']
    sourceSlices: MulticamSourceSlice[]
  }>
}

export function inspectMulticamProgram(
  project: VideoProject,
  groupId: string
): MulticamProgramProjection {
  assertValidTimeline(project)
  const group = projectMulticamGroup(project, groupId)
  const fragments = group.programFragments.map((fragment) => ({
    id: fragment.id,
    startFrame: fragment.startFrame,
    endFrame: fragment.endFrame,
    selection: structuredClone(fragment.selection),
    sourceSlices: structuredClone(evaluateMulticamCoverage(group, fragment.selection, fragment).sourceSlices)
  }))
  return {
    schemaVersion: 1,
    groupId: group.id,
    sequenceId: group.sequenceId,
    revision: project.currentRevision,
    durationFrames: group.durationFrames,
    complete: completeProgram(group),
    programDigest: digest(group.programFragments),
    fragments
  }
}

/**
 * Materializes the source-preserving multicam program as an ordinary bounded
 * sequence. The canonical compiler and FFmpeg planner remain authoritative.
 */
export function compileMulticamProgramProject(
  project: VideoProject,
  groupId: string
): VideoProject {
  assertValidTimeline(project)
  const group = projectMulticamGroup(project, groupId)
  if (!completeProgram(group)) {
    throw engineError(
      'render_unsupported',
      `Multicam program ${group.id} contains a gap; fill the program before preview or export`
    )
  }
  const targetSequence = project.sequences.find(({ id }) => id === group.sequenceId)
  if (!targetSequence) throw engineError('invalid_project', `Missing multicam sequence ${group.sequenceId}`)
  const tracks = multicamTracks(group)
  const items = group.programFragments.flatMap((fragment) =>
    itemsForFragment(project, group, fragment)
  ).sort((left, right) =>
    left.timelineStartFrame - right.timelineStartFrame || left.trackId.localeCompare(right.trackId) ||
    left.id.localeCompare(right.id)
  )
  if (items.length > Math.min(RENDER_IR_LIMITS.layers, 10_000)) {
    throw engineError(
      'render_unsupported',
      `Multicam program ${group.id} expands to ${items.length} layers; ` +
      `the bounded render limit is ${RENDER_IR_LIMITS.layers}`
    )
  }
  const captions = targetSequence.captions
    .filter(({ startFrame, endFrame }) => startFrame < group.durationFrames && endFrame > 0)
    .map((caption) => ({
      ...structuredClone(caption),
      trackId: 'multicam-captions',
      startFrame: Math.max(0, caption.startFrame),
      endFrame: Math.min(group.durationFrames, caption.endFrame)
    }))
    .filter(({ startFrame, endFrame }) => endFrame > startFrame)
  if (captions.length > 0) {
    tracks.push({
      id: 'multicam-captions',
      name: 'Multicam captions',
      kind: 'caption',
      order: MULTICAM_LIMITS.layoutSlots,
      overlap: 'reject'
    })
  }
  const sequence = {
    id: group.sequenceId,
    name: `${targetSequence.name} — ${group.name}`,
    tracks,
    items,
    captions,
    viewState: structuredClone(targetSequence.viewState)
  }
  const compiled: VideoProject = {
    ...structuredClone(project),
    tracks: structuredClone(tracks),
    items: structuredClone(items),
    captions: structuredClone(captions),
    sequences: [sequence],
    activeSequenceId: sequence.id,
    linkGroups: [],
    selection: {
      generation: project.selection.generation,
      revision: project.currentRevision,
      sequenceId: sequence.id,
      playheadFrame: Math.min(project.selection.playheadFrame, group.durationFrames - 1),
      selectedAssetIds: [],
      selectedItemIds: [],
      selectedCaptionIds: [],
      selectedWordIds: []
    },
    multicamGroups: [structuredClone(group)]
  }
  assertValidTimeline(compiled)
  return compiled
}

export function compileMulticamProgramIr(
  project: VideoProject,
  groupId: string,
  options: RenderIrCompileOptions = {}
): CanonicalRenderIr {
  const compiledProject = compileMulticamProgramProject(project, groupId)
  return flattenNestedRenderIr(compiledProject, compileRenderIr(compiledProject, options))
}

export function generateMulticamRenderPlan(
  project: VideoProject,
  groupId: string,
  request: RenderRequest
): RenderPlan {
  return generateRenderPlan(compileMulticamProgramProject(project, groupId), request)
}

function projectMulticamGroup(project: VideoProject, groupId: string): MulticamGroup {
  const input = (project.multicamGroups ?? []).find(({ id }) => id === groupId)
  if (!input) throw engineError('invalid_operation', `Multicam group does not exist: ${groupId}`)
  return structuredClone(validateMulticamGroup(input)) as MulticamGroup
}

function completeProgram(group: MulticamGroup): boolean {
  let cursor = 0
  for (const fragment of group.programFragments) {
    if (fragment.startFrame !== cursor) return false
    cursor = fragment.endFrame
  }
  return cursor === group.durationFrames
}

function multicamTracks(group: MulticamGroup): Track[] {
  const maximumZ = Math.max(
    0,
    ...group.layouts.flatMap((layout) => layout.slots.map(({ zIndex }) => zIndex))
  )
  return Array.from({ length: maximumZ + 1 }, (_unused, zIndex): Track => ({
    id: `multicam-video-${zIndex}`,
    name: `Multicam layer ${zIndex + 1}`,
    kind: 'video',
    order: zIndex,
    overlap: 'mix'
  }))
}

function itemsForFragment(
  project: VideoProject,
  group: MulticamGroup,
  fragment: MulticamProgramFragment
): TimelineItem[] {
  const coverage = evaluateMulticamCoverage(group, fragment.selection, fragment)
  if (coverage.uncoveredRanges.length > 0) {
    throw engineError(
      'render_unsupported',
      `Multicam fragment ${fragment.id} exceeds source coverage`,
      {
        groupId: group.id,
        fragmentId: fragment.id,
        uncoveredRanges: coverage.uncoveredRanges,
        limitingMemberIds: coverage.limitingMemberIds
      }
    )
  }
  if (fragment.selection.kind === 'angle') {
    return coverage.sourceSlices.map((slice) => renderItem(
      project,
      group,
      fragment,
      slice,
      undefined,
      0
    ))
  }
  const layoutId = fragment.selection.layoutId
  const layout = group.layouts.find(({ id }) => id === layoutId)
  if (!layout) throw engineError('invalid_project', `Missing multicam layout ${layoutId}`)
  return coverage.sourceSlices.map((slice) => {
    const slot = layout.slots.find(({ memberId }) => memberId === slice.memberId)
    if (!slot) throw engineError('invalid_project', `Missing layout slot for ${slice.memberId}`)
    return renderItem(project, group, fragment, slice, slot, slot.zIndex)
  })
}

function renderItem(
  project: VideoProject,
  group: MulticamGroup,
  fragment: MulticamProgramFragment,
  slice: MulticamSourceSlice,
  slot: MulticamLayoutSlot | undefined,
  zIndex: number
): TimelineItem {
  const asset = project.assets.find(({ id }) => id === slice.assetId)
  if (!asset?.video) throw engineError('invalid_project', `Missing multicam source ${slice.assetId}`)
  const x = slot
    ? (slot.x + slot.width / 2 - 0.5) * project.canvas.width
    : 0
  const y = slot
    ? (slot.y + slot.height / 2 - 0.5) * project.canvas.height
    : 0
  return {
    id: `mc-${shortDigest([group.id, fragment.id, slice.id, zIndex])}`,
    assetId: slice.assetId,
    trackId: `multicam-video-${zIndex}`,
    timelineStartFrame: slice.startFrame,
    durationFrames: slice.endFrame - slice.startFrame,
    sourceStartUs: framesToMicroseconds(slice.sourceStartFrame, slice.sourceFps),
    sourceEndUs: framesToMicroseconds(slice.sourceEndFrame, slice.sourceFps),
    speed: { numerator: 1, denominator: 1 },
    transform: {
      x,
      y,
      scaleX: slot?.width ?? 1,
      scaleY: slot?.height ?? 1,
      rotation: 0
    },
    opacity: slot?.opacity ?? 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    muted: slot ? !slot.audioEnabled : false
  }
}

function shortDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32)
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
