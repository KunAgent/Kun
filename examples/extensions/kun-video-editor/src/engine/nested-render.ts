import { engineError } from './errors.js'
import { retimeKeyframeTrack, trimKeyframeTrack } from './keyframes.js'
import {
  compileRenderIr,
  validateRenderIr,
  type CanonicalRenderIr,
  type RenderIrMediaLayer,
  type RenderIrSource,
  type RenderIrTextLayer
} from './render-ir.js'
import type { Rational, Sequence, VideoProject } from './schema.js'
import { framesToMicroseconds, microsecondsToFrames, normalizeRational } from './time.js'

export const NESTED_RENDER_LIMITS = Object.freeze({
  depth: 8,
  expandedLayers: 500,
  expandedTextLayers: 500,
  expandedSources: 100
})

type ExpandedLayer = { layer: RenderIrMediaLayer; trackPath: number[] }
type ExpandedText = { layer: RenderIrTextLayer; trackPath: number[] }
type Expansion = {
  sources: Map<string, RenderIrSource>
  layers: ExpandedLayer[]
  textLayers: ExpandedText[]
}

/**
 * Resolves nested sequence references into ordinary asset/text layers before a
 * concrete render backend is selected. This keeps the canonical project IR
 * capable of describing nests while allowing the bounded FFmpeg compiler to
 * execute neutral nested containers, including their audio mix.
 */
export function flattenNestedRenderIr(project: VideoProject, ir: CanonicalRenderIr): CanonicalRenderIr {
  validateRenderIr(ir)
  const expansion = expandIr(project, ir, [], [], 0)
  if (expansion.sources.size > NESTED_RENDER_LIMITS.expandedSources) unsupported('Nested render source limit exceeded')
  if (expansion.layers.length > NESTED_RENDER_LIMITS.expandedLayers) unsupported('Nested render layer limit exceeded')
  if (expansion.textLayers.length > NESTED_RENDER_LIMITS.expandedTextLayers) {
    unsupported('Nested render text-layer limit exceeded')
  }

  const trackRanks = rankTrackPaths([
    ...expansion.layers.map(({ layer, trackPath }) => ({ id: layer.trackId, trackPath })),
    ...expansion.textLayers.map(({ layer, trackPath }) => ({ id: layer.trackId, trackPath }))
  ])
  const layers = expansion.layers.map(({ layer, trackPath }, itemOrder) => ({
    ...layer,
    trackOrder: trackRanks.get(trackKey(trackPath, layer.trackId))!,
    itemOrder
  })).sort(compareMediaLayers)
  const textLayers = expansion.textLayers.map(({ layer, trackPath }) => ({
    ...layer,
    trackOrder: trackRanks.get(trackKey(trackPath, layer.trackId))!
  })).sort(compareTextLayers)
  const flattened: CanonicalRenderIr = {
    ...structuredClone(ir),
    sources: [...expansion.sources.values()].sort((left, right) => left.id.localeCompare(right.id)),
    layers,
    textLayers
  }
  validateRenderIr(flattened)
  return flattened
}

function expandIr(
  project: VideoProject,
  ir: CanonicalRenderIr,
  trackPrefix: number[],
  ancestry: string[],
  depth: number
): Expansion {
  if (depth > NESTED_RENDER_LIMITS.depth) unsupported(`Nested render depth exceeds ${NESTED_RENDER_LIMITS.depth}`)
  const expansion: Expansion = { sources: new Map(), layers: [], textLayers: [] }
  for (const source of ir.sources) expansion.sources.set(source.id, structuredClone(source))
  for (const layer of ir.layers) {
    const trackPath = [...trackPrefix, layer.trackOrder]
    if (layer.source.kind === 'asset') {
      expansion.layers.push({ layer: structuredClone(layer), trackPath })
      continue
    }
    const sequenceId = layer.source.sequenceId
    if (ancestry.includes(sequenceId)) unsupported(`Nested render cycle detected at ${sequenceId}`)
    assertFlattenableContainer(layer)
    const sequence = project.sequences.find(({ id }) => id === sequenceId)
    if (!sequence) invalid(`Nested sequence does not exist: ${sequenceId}`)
    const childRange = nestedSourceRange(project, sequence, layer)
    const childProject = projectForSequence(project, sequence)
    const childIr = compileRenderIr(childProject, { range: childRange, textPolicy: ir.textPolicy })
    const child = expandIr(childProject, childIr, trackPath, [...ancestry, sequenceId], depth + 1)
    for (const source of child.sources.values()) expansion.sources.set(source.id, source)
    for (const childLayer of child.layers) {
      const mapped = mapNestedMediaLayer(project, layer, childLayer.layer, childRange)
      if (mapped) expansion.layers.push({ layer: mapped, trackPath: childLayer.trackPath })
    }
    for (const childText of child.textLayers) {
      const mapped = mapNestedTextLayer(layer, childText.layer, childRange)
      if (mapped) expansion.textLayers.push({ layer: mapped, trackPath: childText.trackPath })
    }
  }
  for (const text of ir.textLayers) {
    expansion.textLayers.push({
      layer: structuredClone(text),
      trackPath: [...trackPrefix, text.trackOrder]
    })
  }
  return expansion
}

function nestedSourceRange(
  project: VideoProject,
  sequence: Sequence,
  container: RenderIrMediaLayer
): { startFrame: number; endFrame: number } {
  const startFrame = microsecondsToFrames(container.sourceMap.startUs, project.fps)
  const endFrame = microsecondsToFrames(container.sourceMap.endUs, project.fps)
  const duration = Math.max(
    0,
    ...sequence.items.map((item) => item.timelineStartFrame + item.durationFrames),
    ...sequence.captions.map((caption) => caption.endFrame)
  )
  if (startFrame < 0 || endFrame <= startFrame || endFrame > duration) {
    invalid(`Nested source range is outside sequence ${sequence.id}`)
  }
  return { startFrame, endFrame }
}

function mapNestedMediaLayer(
  project: VideoProject,
  container: RenderIrMediaLayer,
  child: RenderIrMediaLayer,
  childRange: { startFrame: number; endFrame: number }
): RenderIrMediaLayer | undefined {
  const visibleStart = Math.max(child.timeline.startFrame, childRange.startFrame)
  const visibleEnd = Math.min(child.timeline.endFrame, childRange.endFrame)
  if (visibleEnd <= visibleStart) return undefined
  const leftTrim = visibleStart - child.timeline.startFrame
  const rightTrim = child.timeline.endFrame - visibleEnd
  const parentStart = mapChildFrame(container, visibleStart, childRange.startFrame)
  const parentEnd = mapChildFrame(container, visibleEnd, childRange.startFrame)
  if (parentEnd <= parentStart) unsupported(`Nested speed collapses layer ${child.id} below one frame`)
  const sourceStartUs = child.sourceMap.startUs + sourceDeltaUs(leftTrim, child.sourceMap.speed, project.fps)
  const sourceEndUs = child.sourceMap.endUs - sourceDeltaUs(rightTrim, child.sourceMap.speed, project.fps)
  if (sourceEndUs <= sourceStartUs) unsupported(`Nested trim empties source map for ${child.id}`)
  const visibleDuration = visibleEnd - visibleStart
  const parentDuration = parentEnd - parentStart
  const volume = child.audio.volume * container.audio.volume
  if (volume > 4) unsupported(`Nested audio gain exceeds the supported range on ${child.id}`)
  return {
    ...structuredClone(child),
    id: nestedId(container.id, child.id),
    trackId: nestedId(container.id, child.trackId),
    timeline: { startFrame: parentStart, endFrame: parentEnd },
    sourceMap: {
      startUs: sourceStartUs,
      endUs: sourceEndUs,
      speed: multiplyRational(child.sourceMap.speed, container.sourceMap.speed)
    },
    visual: {
      ...structuredClone(child.visual),
      opacity: child.visual.opacity * container.visual.opacity,
      fadeInFrames: Math.min(parentDuration, mapDuration(
        Math.max(0, child.visual.fadeInFrames - leftTrim), container.sourceMap.speed
      )),
      fadeOutFrames: Math.min(parentDuration, mapDuration(
        Math.max(0, child.visual.fadeOutFrames - rightTrim), container.sourceMap.speed
      ))
    },
    audio: {
      ...structuredClone(child.audio),
      enabled: child.audio.enabled && container.audio.enabled,
      volume,
      fadeInFrames: Math.min(parentDuration, mapDuration(
        Math.max(0, child.audio.fadeInFrames - leftTrim), container.sourceMap.speed
      )),
      fadeOutFrames: Math.min(parentDuration, mapDuration(
        Math.max(0, child.audio.fadeOutFrames - rightTrim), container.sourceMap.speed
      ))
    },
    keyframes: child.keyframes.map((track) => {
      const trimmed = trimKeyframeTrack(
        track,
        leftTrim,
        child.timeline.endFrame - child.timeline.startFrame - rightTrim
      )
      return retimeKeyframeTrack(trimmed.track, visibleDuration, parentDuration).track
    })
  }
}

function mapNestedTextLayer(
  container: RenderIrMediaLayer,
  child: RenderIrTextLayer,
  childRange: { startFrame: number; endFrame: number }
): RenderIrTextLayer | undefined {
  const visibleStart = Math.max(child.timeline.startFrame, childRange.startFrame)
  const visibleEnd = Math.min(child.timeline.endFrame, childRange.endFrame)
  if (visibleEnd <= visibleStart) return undefined
  const parentStart = mapChildFrame(container, visibleStart, childRange.startFrame)
  const parentEnd = mapChildFrame(container, visibleEnd, childRange.startFrame)
  if (parentEnd <= parentStart) return undefined
  return {
    ...structuredClone(child),
    id: nestedId(container.id, child.id),
    trackId: nestedId(container.id, child.trackId),
    timeline: { startFrame: parentStart, endFrame: parentEnd },
    words: child.words.flatMap((word) => {
      const start = Math.max(word.startFrame, visibleStart)
      const end = Math.min(word.endFrame, visibleEnd)
      if (end <= start) return []
      const startFrame = mapChildFrame(container, start, childRange.startFrame)
      const endFrame = mapChildFrame(container, end, childRange.startFrame)
      return endFrame <= startFrame ? [] : [{
        ...structuredClone(word),
        id: nestedId(container.id, word.id),
        startFrame,
        endFrame
      }]
    }),
    animation: {
      ...structuredClone(child.animation),
      durationFrames: mapDuration(child.animation.durationFrames, container.sourceMap.speed)
    }
  }
}

function assertFlattenableContainer(layer: RenderIrMediaLayer): void {
  const transform = layer.visual.transform
  if (
    transform.x !== 0 || transform.y !== 0 || transform.scaleX !== 1 ||
    transform.scaleY !== 1 || transform.rotation !== 0 ||
    Object.values(layer.visual.crop).some((value) => value !== 0) ||
    layer.visual.blendMode !== 'normal' || layer.visual.fadeInFrames !== 0 ||
    layer.visual.fadeOutFrames !== 0 || layer.audio.fadeInFrames !== 0 ||
    layer.audio.fadeOutFrames !== 0 || layer.effects.some(({ enabled }) => enabled) ||
    layer.keyframes.length > 0
  ) {
    unsupported(`Nested container ${layer.id} requires a composed proxy for outer transforms, fades, effects, or keyframes`)
  }
}

function projectForSequence(project: VideoProject, sequence: Sequence): VideoProject {
  return {
    ...project,
    activeSequenceId: sequence.id,
    tracks: structuredClone(sequence.tracks),
    items: structuredClone(sequence.items),
    captions: structuredClone(sequence.captions),
    selection: {
      ...structuredClone(project.selection),
      sequenceId: sequence.id,
      playheadFrame: 0,
      selectedItemIds: [],
      selectedCaptionIds: [],
      selectedWordIds: [],
      range: undefined
    }
  }
}

function mapChildFrame(
  container: RenderIrMediaLayer,
  childFrame: number,
  childRangeStart: number
): number {
  const delta = childFrame - childRangeStart
  return container.timeline.startFrame + Math.round(
    delta * container.sourceMap.speed.denominator / container.sourceMap.speed.numerator
  )
}

function mapDuration(frames: number, speed: Rational): number {
  return Math.max(0, Math.round(frames * speed.denominator / speed.numerator))
}

function sourceDeltaUs(frames: number, speed: Rational, fps: Rational): number {
  return Math.round(framesToMicroseconds(frames, fps) * speed.numerator / speed.denominator)
}

function multiplyRational(left: Rational, right: Rational): Rational {
  const a = normalizeRational(left)
  const b = normalizeRational(right)
  const crossLeft = gcd(a.numerator, b.denominator)
  const crossRight = gcd(b.numerator, a.denominator)
  const numerator = a.numerator / crossLeft * (b.numerator / crossRight)
  const denominator = a.denominator / crossRight * (b.denominator / crossLeft)
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    unsupported('Nested speed composition exceeds the rational range')
  }
  return normalizeRational({ numerator, denominator })
}

function rankTrackPaths(values: Array<{ id: string; trackPath: number[] }>): Map<string, number> {
  const unique = new Map<string, { id: string; trackPath: number[] }>()
  for (const value of values) unique.set(trackKey(value.trackPath, value.id), value)
  const ordered = [...unique.values()].sort((left, right) =>
    comparePaths(left.trackPath, right.trackPath) || left.id.localeCompare(right.id)
  )
  return new Map(ordered.map((value, index) => [trackKey(value.trackPath, value.id), index]))
}

function trackKey(path: readonly number[], id: string): string {
  return `${path.join('.')}:${id}`
}

function comparePaths(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (left[index] === undefined) return -1
    if (right[index] === undefined) return 1
    if (left[index] !== right[index]) return left[index]! - right[index]!
  }
  return 0
}

function compareMediaLayers(left: RenderIrMediaLayer, right: RenderIrMediaLayer): number {
  return left.trackOrder - right.trackOrder || left.trackId.localeCompare(right.trackId) ||
    left.timeline.startFrame - right.timeline.startFrame || left.id.localeCompare(right.id)
}

function compareTextLayers(left: RenderIrTextLayer, right: RenderIrTextLayer): number {
  return left.trackOrder - right.trackOrder || left.timeline.startFrame - right.timeline.startFrame ||
    left.id.localeCompare(right.id)
}

function nestedId(parentId: string, childId: string): string {
  const suffix = `~${childId}`.replace(/[^A-Za-z0-9._~-]/gu, '-')
  return `${parentId.slice(0, Math.max(1, 192 - suffix.length))}${suffix}`.slice(0, 192)
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left)
  let b = Math.abs(right)
  while (b !== 0) [a, b] = [b, a % b]
  return a || 1
}

function invalid(message: string): never {
  throw engineError('invalid_project', message)
}

function unsupported(message: string): never {
  throw engineError('render_unsupported', message)
}
