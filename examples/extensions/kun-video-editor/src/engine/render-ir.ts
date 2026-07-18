import { createHash } from 'node:crypto'
import { engineError } from './errors.js'
import {
  activeSequence,
  type BlendMode,
  type Sequence,
  type Caption,
  type MediaAsset,
  type Rational,
  type TimelineItem,
  type VideoProject
} from './schema.js'
/*
 * Keep all Render IR contracts in this module rather than widening the durable
 * project schema with backend-specific state. The compiler consumes the
 * active sequence through the schema-owned accessor.
 */
import type {
  EffectInstance,
  KeyframeTrack
} from './schema.js'
import { containsNullOrLineBreak } from '../text-safety.js'

export const RENDER_IR_SCHEMA_VERSION = 1 as const

export const RENDER_IR_LIMITS = Object.freeze({
  sources: 100,
  layers: 500,
  textLayers: 500,
  effectsPerLayer: 16,
  keyframeTracksPerLayer: 32,
  keyframesPerTrack: 256,
  wordsPerTextLayer: 512,
  unsupportedNodes: 64,
  canonicalBytes: 512 * 1024
})

export type RenderFrameRange = {
  startFrame: number
  endFrame: number
}

export type RenderSourceReference = {
  kind: 'media-handle' | 'workspace-file'
  reference: string
}

export type RenderIrSource = {
  id: string
  assetId: string
  reference: RenderSourceReference
  durationUs: number
  container: string
  video?: {
    codec: string
    width: number
    height: number
    frameRate: Rational
    rotation: 0 | 90 | 180 | 270
  }
  audio?: {
    codec: string
    sampleRate: number
    channels: number
  }
  still?: {
    width: number
    height: number
    format: string
    animated: boolean
    frameRate?: Rational
    loop: boolean
  }
}

export type RenderIrEffect = {
  id: string
  type: string
  enabled: boolean
  parameters: Record<string, number | string | boolean>
}

export type RenderIrKeyframeTrack = {
  id: string
  property: string
  interpolation: 'hold' | 'linear' | 'ease'
  points: Array<{ id: string; frame: number; value: number }>
}

export type RenderIrMediaLayer = {
  id: string
  kind: 'media'
  trackId: string
  trackOrder: number
  itemOrder: number
  source: { kind: 'asset'; sourceId: string } | { kind: 'sequence'; sequenceId: string }
  timeline: RenderFrameRange
  sourceMap: {
    startUs: number
    endUs: number
    speed: Rational
  }
  visual: {
    fit: VideoProject['canvas']['fit']
    transform: TimelineItem['transform']
    crop: { left: number; top: number; right: number; bottom: number }
    opacity: number
    fadeInFrames: number
    fadeOutFrames: number
    blendMode: BlendMode
  }
  audio: {
    enabled: boolean
    volume: number
    fadeInFrames: number
    fadeOutFrames: number
  }
  effects: RenderIrEffect[]
  keyframes: RenderIrKeyframeTrack[]
}

export type RenderIrTextLayer = {
  id: string
  kind: 'text'
  trackId: string
  trackOrder: number
  timeline: RenderFrameRange
  text: string
  placement: Caption['placement']
  style: {
    fontFamily: string
    fontSize: number
    color: string
    background: string
    fontWeight?: number
    maxWidthRatio?: number
  }
  words: Array<{
    id: string
    text: string
    startFrame: number
    endFrame: number
    sourceWordId?: string
  }>
  animation: {
    kind: 'none' | 'word-highlight' | 'fade'
    durationFrames: number
  }
}

export type CanonicalRenderIr = {
  schemaVersion: typeof RENDER_IR_SCHEMA_VERSION
  projectId: string
  sequenceId: string
  revision: number
  fps: Rational
  range: RenderFrameRange
  canvas: {
    width: number
    height: number
    background: string
    colorSpace: 'bt709'
    colorRange: 'tv'
    pixelAspectRatio: Rational
  }
  textPolicy: 'none' | 'burned' | 'sidecar' | 'both'
  sources: RenderIrSource[]
  layers: RenderIrMediaLayer[]
  textLayers: RenderIrTextLayer[]
  audioMix: {
    normalize: false
    sampleRate: number
    channels: number
  }
}

export type RenderIrCompileOptions = {
  range?: RenderFrameRange
  textPolicy?: CanonicalRenderIr['textPolicy']
}

type SequenceProjection = Pick<Sequence, 'id' | 'tracks' | 'items' | 'captions'>

type ExtendedTimelineItem = TimelineItem & {
  effects?: EffectInstance[]
  keyframes?: KeyframeTrack[]
}

export type RenderTarget =
  | 'proof-frame'
  | 'preview'
  | 'h264-mp4'
  | 'h265-mp4'
  | 'prores-mov'
  | 'ffv1-mkv'
  | 'audio-aac'
  | 'subtitles'

export type RenderBackendCapabilities = {
  id: string
  version: string
  codecs: string[]
  filters: string[]
  effects: string[]
  colorSpaces: string[]
  fonts: string[]
  maxSources: number
  maxLayers: number
  maxTextLayers: number
  hardwareAcceleration: 'none' | 'optional' | 'required'
}

export type UnsupportedRenderNode = {
  nodeId: string
  nodeType: 'backend' | 'canvas' | 'source' | 'layer' | 'text' | 'effect' | 'limit'
  capability: string
  message: string
  guidance: string
}

export type RenderCapabilityReport = {
  supported: boolean
  target: RenderTarget
  backendId: string
  backendVersion: string
  capabilitiesDigest: string
  hardwareAcceleration: RenderBackendCapabilities['hardwareAcceleration']
  unsupported: UnsupportedRenderNode[]
}

export type InteractivePlaybackDecision = {
  mode: 'source-fast-path' | 'composed-proof'
  irDigest: string
  projectId: string
  sequenceId: string
  revision: number
  sourceId?: string
  layerId?: string
  reasons: string[]
}

export function compileRenderIr(
  project: VideoProject,
  options: RenderIrCompileOptions = {}
): CanonicalRenderIr {
  const sequence = activeSequenceProjection(project)
  const durationFrames = sequenceDurationFrames(sequence)
  const range = options.range ?? { startFrame: 0, endFrame: durationFrames }
  validateFrameRange(range, durationFrames)
  const trackOrder = new Map(sequence.tracks.map((track) => [track.id, track.order]))
  const itemOrder = new Map(sequence.items.map((item, index) => [item.id, index]))
  const relevantItems = sequence.items.filter((item) => intersects(range, itemRange(item)))
  const usedAssetIds = new Set(relevantItems
    .filter((item) => item.nestedSequenceId === undefined)
    .map((item) => item.assetId)
    .filter(Boolean))
  const assets = project.assets
    .filter((asset) => usedAssetIds.has(asset.id))
    .sort((left, right) => left.id.localeCompare(right.id))
  if (assets.length > RENDER_IR_LIMITS.sources) {
    throw engineError('render_unsupported', `Render IR exceeds the ${RENDER_IR_LIMITS.sources} source limit`)
  }
  const sources = assets.map(renderSource)
  const sourceIds = new Set(sources.map(({ id }) => id))
  const layers = relevantItems
    .sort((left, right) =>
      (trackOrder.get(left.trackId) ?? 0) - (trackOrder.get(right.trackId) ?? 0) ||
      left.trackId.localeCompare(right.trackId) ||
      left.timelineStartFrame - right.timelineStartFrame ||
      left.id.localeCompare(right.id))
    .map((item) => renderLayer(
      project,
      item as ExtendedTimelineItem,
      trackOrder.get(item.trackId) ?? 0,
      itemOrder.get(item.id) ?? 0,
      sourceIds
    ))
  if (layers.length > RENDER_IR_LIMITS.layers) {
    throw engineError('render_unsupported', `Render IR exceeds the ${RENDER_IR_LIMITS.layers} layer limit`)
  }
  const textLayers = sequence.captions
    .filter((caption) => intersects(range, { startFrame: caption.startFrame, endFrame: caption.endFrame }))
    .sort((left, right) =>
      (trackOrder.get(left.trackId) ?? 0) - (trackOrder.get(right.trackId) ?? 0) ||
      left.startFrame - right.startFrame ||
      left.id.localeCompare(right.id))
    .map((caption) => renderTextLayer(project, caption, trackOrder.get(caption.trackId) ?? 0))
  if (textLayers.length > RENDER_IR_LIMITS.textLayers) {
    throw engineError('render_unsupported', `Render IR exceeds the ${RENDER_IR_LIMITS.textLayers} text-layer limit`)
  }
  const audioStreams = sources.flatMap((source) => source.audio ? [source.audio] : [])
  const ir: CanonicalRenderIr = {
    schemaVersion: RENDER_IR_SCHEMA_VERSION,
    projectId: project.id,
    sequenceId: sequence.id,
    revision: project.currentRevision,
    fps: structuredClone(project.fps),
    range: structuredClone(range),
    canvas: {
      width: project.canvas.width,
      height: project.canvas.height,
      background: project.canvas.background,
      colorSpace: 'bt709',
      colorRange: 'tv',
      pixelAspectRatio: { numerator: 1, denominator: 1 }
    },
    textPolicy: options.textPolicy ?? 'none',
    sources,
    layers,
    textLayers,
    audioMix: {
      normalize: false,
      sampleRate: Math.max(48_000, ...audioStreams.map(({ sampleRate }) => sampleRate)),
      channels: Math.max(2, ...audioStreams.map(({ channels }) => channels))
    }
  }
  validateRenderIr(ir)
  return ir
}

export function validateRenderIr(ir: CanonicalRenderIr): void {
  if (ir.schemaVersion !== RENDER_IR_SCHEMA_VERSION) invalid('Unsupported Render IR schema version')
  boundedId(ir.projectId, 'projectId')
  boundedId(ir.sequenceId, 'sequenceId')
  nonNegativeInteger(ir.revision, 'revision')
  positiveInteger(ir.fps.numerator, 'fps.numerator')
  positiveInteger(ir.fps.denominator, 'fps.denominator')
  validateFrameRange(ir.range)
  positiveInteger(ir.canvas.width, 'canvas.width')
  positiveInteger(ir.canvas.height, 'canvas.height')
  if (ir.canvas.width > 16_384 || ir.canvas.height > 16_384) invalid('Canvas dimensions exceed 16384 pixels')
  boundedString(ir.canvas.background, 'canvas.background', 32)
  if (!/^#[0-9A-Fa-f]{6}$/u.test(ir.canvas.background)) invalid('Canvas background must be a six-digit hexadecimal color')
  if (ir.canvas.colorSpace !== 'bt709' || ir.canvas.colorRange !== 'tv') invalid('Unsupported canvas color declaration')
  positiveInteger(ir.canvas.pixelAspectRatio.numerator, 'canvas.pixelAspectRatio.numerator')
  positiveInteger(ir.canvas.pixelAspectRatio.denominator, 'canvas.pixelAspectRatio.denominator')
  if (!['none', 'burned', 'sidecar', 'both'].includes(ir.textPolicy)) invalid('Unsupported text policy')
  if (ir.sources.length > RENDER_IR_LIMITS.sources) invalid('Render IR source limit exceeded')
  if (ir.layers.length > RENDER_IR_LIMITS.layers) invalid('Render IR layer limit exceeded')
  if (ir.textLayers.length > RENDER_IR_LIMITS.textLayers) invalid('Render IR text-layer limit exceeded')
  const sourceIds = new Set<string>()
  for (const source of ir.sources) {
    boundedId(source.id, 'source.id')
    boundedId(source.assetId, 'source.assetId')
    if (sourceIds.has(source.id)) invalid(`Duplicate Render IR source ${source.id}`)
    sourceIds.add(source.id)
    validateReference(source.reference)
    positiveInteger(source.durationUs, 'source.durationUs')
    boundedString(source.container, 'source.container', 64)
    if (source.video) {
      boundedString(source.video.codec, 'source.video.codec', 64)
      positiveInteger(source.video.width, 'source.video.width')
      positiveInteger(source.video.height, 'source.video.height')
      positiveInteger(source.video.frameRate.numerator, 'source.video.frameRate.numerator')
      positiveInteger(source.video.frameRate.denominator, 'source.video.frameRate.denominator')
      if (![0, 90, 180, 270].includes(source.video.rotation)) invalid(`Source ${source.id} has unsupported rotation`)
    }
    if (source.audio) {
      boundedString(source.audio.codec, 'source.audio.codec', 64)
      positiveInteger(source.audio.sampleRate, 'source.audio.sampleRate')
      positiveInteger(source.audio.channels, 'source.audio.channels')
      if (source.audio.channels > 64) invalid(`Source ${source.id} channel count exceeds the Render IR limit`)
    }
    if (source.still) {
      positiveInteger(source.still.width, 'source.still.width')
      positiveInteger(source.still.height, 'source.still.height')
      boundedString(source.still.format, 'source.still.format', 64)
      if (typeof source.still.animated !== 'boolean' || typeof source.still.loop !== 'boolean') {
        invalid(`Source ${source.id} has invalid still/animation flags`)
      }
      if (source.still.frameRate) {
        positiveInteger(source.still.frameRate.numerator, 'source.still.frameRate.numerator')
        positiveInteger(source.still.frameRate.denominator, 'source.still.frameRate.denominator')
      }
    }
  }
  const layerIds = new Set<string>()
  for (const layer of ir.layers) {
    boundedId(layer.id, 'layer.id')
    if (layerIds.has(layer.id)) invalid(`Duplicate Render IR layer ${layer.id}`)
    layerIds.add(layer.id)
    boundedId(layer.trackId, 'layer.trackId')
    nonNegativeInteger(layer.trackOrder, 'layer.trackOrder')
    nonNegativeInteger(layer.itemOrder, 'layer.itemOrder')
    validateFrameRange(layer.timeline)
    if (!intersects(ir.range, layer.timeline)) invalid(`Layer ${layer.id} is outside the requested render range`)
    if (layer.source.kind === 'asset' && !sourceIds.has(layer.source.sourceId)) {
      invalid(`Layer ${layer.id} refers to missing source ${layer.source.sourceId}`)
    }
    if (layer.source.kind === 'sequence') boundedId(layer.source.sequenceId, 'layer.source.sequenceId')
    nonNegativeInteger(layer.sourceMap.startUs, 'layer.sourceMap.startUs')
    positiveInteger(layer.sourceMap.endUs, 'layer.sourceMap.endUs')
    if (layer.sourceMap.endUs <= layer.sourceMap.startUs) invalid(`Layer ${layer.id} has an empty source map`)
    positiveInteger(layer.sourceMap.speed.numerator, 'layer.sourceMap.speed.numerator')
    positiveInteger(layer.sourceMap.speed.denominator, 'layer.sourceMap.speed.denominator')
    if (!['fit', 'crop', 'pad'].includes(layer.visual.fit)) invalid(`Layer ${layer.id} has an unsupported fit mode`)
    finite(layer.visual.transform.x, 'layer.visual.transform.x')
    finite(layer.visual.transform.y, 'layer.visual.transform.y')
    finiteBetween(layer.visual.transform.scaleX, 0.01, 100, 'layer.visual.transform.scaleX')
    finiteBetween(layer.visual.transform.scaleY, 0.01, 100, 'layer.visual.transform.scaleY')
    finite(layer.visual.transform.rotation, 'layer.visual.transform.rotation')
    finiteBetween(layer.visual.opacity, 0, 1, 'layer.visual.opacity')
    for (const [edge, value] of Object.entries(layer.visual.crop)) {
      finiteBetween(value, 0, 1, `layer.visual.crop.${edge}`)
    }
    if (layer.visual.crop.left + layer.visual.crop.right >= 1 || layer.visual.crop.top + layer.visual.crop.bottom >= 1) {
      invalid(`Layer ${layer.id} crop removes the complete frame`)
    }
    nonNegativeInteger(layer.visual.fadeInFrames, 'layer.visual.fadeInFrames')
    nonNegativeInteger(layer.visual.fadeOutFrames, 'layer.visual.fadeOutFrames')
    if (!['normal', 'multiply', 'screen', 'overlay'].includes(layer.visual.blendMode)) {
      invalid(`Layer ${layer.id} has an unsupported blend mode`)
    }
    if (typeof layer.audio.enabled !== 'boolean') invalid(`Layer ${layer.id} audio.enabled must be a boolean`)
    finiteBetween(layer.audio.volume, 0, 4, 'layer.audio.volume')
    nonNegativeInteger(layer.audio.fadeInFrames, 'layer.audio.fadeInFrames')
    nonNegativeInteger(layer.audio.fadeOutFrames, 'layer.audio.fadeOutFrames')
    if (layer.effects.length > RENDER_IR_LIMITS.effectsPerLayer) invalid(`Layer ${layer.id} effect limit exceeded`)
    if (layer.keyframes.length > RENDER_IR_LIMITS.keyframeTracksPerLayer) invalid(`Layer ${layer.id} keyframe-track limit exceeded`)
    for (const effect of layer.effects) {
      boundedId(effect.id, 'effect.id')
      boundedString(effect.type, 'effect.type', 64)
      if (typeof effect.enabled !== 'boolean') invalid(`Effect ${effect.id} enabled must be a boolean`)
      if (Object.keys(effect.parameters).length > 64) invalid(`Effect ${effect.id} parameter limit exceeded`)
      for (const [key, value] of Object.entries(effect.parameters)) {
        boundedString(key, 'effect parameter', 64)
        if (typeof value === 'number' && !Number.isFinite(value)) invalid(`Effect ${effect.id} contains a non-finite parameter`)
        if (typeof value === 'string') boundedString(value, `effect ${effect.id} parameter`, 256)
        if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean') {
          invalid(`Effect ${effect.id} contains an unsupported parameter`)
        }
      }
    }
    for (const track of layer.keyframes) {
      boundedId(track.id, 'keyframe track id')
      boundedString(track.property, 'keyframe property', 128)
      if (!['hold', 'linear', 'ease'].includes(track.interpolation)) invalid(`Keyframe track ${track.id} interpolation is unsupported`)
      if (track.points.length > RENDER_IR_LIMITS.keyframesPerTrack) invalid(`Keyframe track ${track.id} point limit exceeded`)
      let previousFrame = -1
      for (const point of track.points) {
        boundedId(point.id, 'keyframe point id')
        nonNegativeInteger(point.frame, 'keyframe frame')
        if (point.frame <= previousFrame) invalid(`Keyframe track ${track.id} is not strictly ordered`)
        if (!Number.isFinite(point.value)) invalid(`Keyframe track ${track.id} contains a non-finite value`)
        previousFrame = point.frame
      }
    }
  }
  const textIds = new Set<string>()
  for (const text of ir.textLayers) {
    boundedId(text.id, 'text layer id')
    if (textIds.has(text.id)) invalid(`Duplicate Render IR text layer ${text.id}`)
    textIds.add(text.id)
    boundedId(text.trackId, 'text track id')
    nonNegativeInteger(text.trackOrder, 'text track order')
    validateFrameRange(text.timeline)
    if (!intersects(ir.range, text.timeline)) invalid(`Text layer ${text.id} is outside the requested render range`)
    boundedString(text.text, 'text layer text', 4_000)
    if (!['top', 'center', 'bottom'].includes(text.placement)) invalid(`Text layer ${text.id} placement is unsupported`)
    boundedString(text.style.fontFamily, 'text font family', 128)
    finiteBetween(text.style.fontSize, 1, 512, 'text font size')
    validateColor(text.style.color, `Text layer ${text.id} color`)
    validateColor(text.style.background, `Text layer ${text.id} background`)
    if (text.style.fontWeight !== undefined) finiteBetween(text.style.fontWeight, 100, 900, 'text font weight')
    if (text.style.maxWidthRatio !== undefined) finiteBetween(text.style.maxWidthRatio, 0.1, 1, 'text max width ratio')
    if (text.words.length > RENDER_IR_LIMITS.wordsPerTextLayer) invalid(`Text layer ${text.id} word limit exceeded`)
    let previousWordStart = -1
    for (const word of text.words) {
      boundedId(word.id, 'text word id')
      boundedString(word.text, 'text word', 1_024)
      nonNegativeInteger(word.startFrame, 'text word startFrame')
      positiveInteger(word.endFrame, 'text word endFrame')
      if (word.endFrame <= word.startFrame || word.startFrame < previousWordStart) {
        invalid(`Text layer ${text.id} contains an invalid word range`)
      }
      if (word.startFrame < text.timeline.startFrame || word.endFrame > text.timeline.endFrame) {
        invalid(`Text layer ${text.id} contains a word outside its timeline range`)
      }
      if (word.sourceWordId !== undefined) boundedId(word.sourceWordId, 'text source word id')
      previousWordStart = word.startFrame
    }
    if (!['none', 'word-highlight', 'fade'].includes(text.animation.kind)) invalid(`Text layer ${text.id} animation is unsupported`)
    nonNegativeInteger(text.animation.durationFrames, 'text animation durationFrames')
  }
  positiveInteger(ir.audioMix.sampleRate, 'audioMix.sampleRate')
  positiveInteger(ir.audioMix.channels, 'audioMix.channels')
  if (ir.audioMix.channels > 64) invalid('audioMix.channels exceeds the Render IR limit')
  if (ir.audioMix.normalize !== false) invalid('Unsupported audio normalization policy')
  assertCanonicalOrder(ir)
  const bytes = Buffer.byteLength(stableStringify(ir), 'utf8')
  if (bytes > RENDER_IR_LIMITS.canonicalBytes) invalid('Canonical Render IR exceeds its byte limit')
}

export function renderIrDigest(ir: CanonicalRenderIr): string {
  validateRenderIr(ir)
  return createHash('sha256').update(stableStringify(ir)).digest('hex')
}

export function renderCapabilitiesDigest(capabilities: RenderBackendCapabilities): string {
  validateBackendCapabilities(capabilities)
  return createHash('sha256').update(stableStringify(normalizeCapabilities(capabilities))).digest('hex')
}

export function negotiateRenderIr(
  ir: CanonicalRenderIr,
  capabilities: RenderBackendCapabilities,
  target: RenderTarget
): RenderCapabilityReport {
  validateRenderIr(ir)
  validateBackendCapabilities(capabilities)
  const unsupported: UnsupportedRenderNode[] = []
  const codecs = new Set(capabilities.codecs)
  const filters = new Set(capabilities.filters)
  const effects = new Set(capabilities.effects)
  const colorSpaces = new Set(capabilities.colorSpaces)
  const fonts = new Set(capabilities.fonts)
  const rendersVideo = [
    'proof-frame', 'preview', 'h264-mp4', 'h265-mp4', 'prores-mov', 'ffv1-mkv'
  ].includes(target)
  const rendersAudio = [
    'audio-aac', 'preview', 'h264-mp4', 'h265-mp4', 'prores-mov', 'ffv1-mkv'
  ].includes(target)
  const overlayRequired = rendersVideo && requiresOverlayFilter(ir)
  const requireCapability = (
    present: boolean,
    issue: UnsupportedRenderNode
  ): void => {
    if (!present && unsupported.length < RENDER_IR_LIMITS.unsupportedNodes) unsupported.push(issue)
  }
  const requiredCodec = target === 'proof-frame'
    ? 'png'
    : target === 'preview' || target === 'h264-mp4'
      ? 'h264'
      : target === 'h265-mp4'
        ? 'h265'
        : target === 'prores-mov'
          ? 'prores'
          : target === 'ffv1-mkv'
            ? 'ffv1'
      : target === 'audio-aac'
        ? 'aac'
        : undefined
  if (capabilities.hardwareAcceleration === 'required') {
    requireCapability(false, issue(
      'backend', 'backend', 'hardware-acceleration:required',
      `Backend ${capabilities.id} requires hardware acceleration, but this canonical FFmpeg plan does not select a hardware device.`,
      'Use software/optional acceleration or select an explicitly negotiated hardware render backend.'
    ))
  }
  if (requiredCodec) {
    requireCapability(codecs.has(requiredCodec), issue(
      'backend', 'backend', `codec:${requiredCodec}`,
      `Backend ${capabilities.id} cannot encode ${requiredCodec}.`,
      `Install or select a backend with the ${requiredCodec} encoder.`
    ))
  }
  if (rendersVideo) {
    requireCapability(colorSpaces.has(ir.canvas.colorSpace), issue(
      'canvas', 'canvas', `color-space:${ir.canvas.colorSpace}`,
      `Backend ${capabilities.id} cannot preserve ${ir.canvas.colorSpace}.`,
      `Select a backend with ${ir.canvas.colorSpace} support or explicitly approve a color conversion.`
    ))
    requireCapability(filters.has(overlayRequired ? 'overlay' : 'concat'), issue(
      'composition', 'backend', `filter:${overlayRequired ? 'overlay' : 'concat'}`,
      `Backend ${capabilities.id} cannot execute the required ${overlayRequired ? 'layer composition' : 'sequential composition'}.`,
      `Select a backend with the ${overlayRequired ? 'overlay' : 'concat'} filter or bake this range to an approved proxy.`
    ))
    if (overlayRequired) {
      requireCapability(filters.has('color-source'), issue(
        'canvas', 'canvas', 'filter:color-source',
        `Backend ${capabilities.id} cannot create the canonical canvas for layered composition.`,
        'Select a backend with a bounded color source or bake the composition to an approved proxy.'
      ))
    }
  }
  if (ir.sources.length > capabilities.maxSources) unsupported.push(issue(
    'sources', 'limit', 'limit:sources',
    `Render uses ${ir.sources.length} sources but the backend limit is ${capabilities.maxSources}.`,
    'Shorten the range, precompose sequences, or use a backend with a larger source limit.'
  ))
  if (ir.layers.length > capabilities.maxLayers) unsupported.push(issue(
    'layers', 'limit', 'limit:layers',
    `Render uses ${ir.layers.length} layers but the backend limit is ${capabilities.maxLayers}.`,
    'Precompose layers or use a backend with a larger layer limit.'
  ))
  if (ir.textLayers.length > capabilities.maxTextLayers) unsupported.push(issue(
    'text', 'limit', 'limit:text-layers',
    `Render uses ${ir.textLayers.length} text layers but the backend limit is ${capabilities.maxTextLayers}.`,
    'Split the range or use a backend with a larger text-layer limit.'
  ))
  for (const layer of ir.layers) {
    const sourceId = layer.source.kind === 'asset' ? layer.source.sourceId : undefined
    const source = sourceId === undefined
      ? undefined
      : ir.sources.find(({ id }) => id === sourceId)
    const hasVideo = layer.source.kind === 'sequence' || source?.video !== undefined || source?.still !== undefined
    const hasAudio = layer.source.kind === 'sequence' || source?.audio !== undefined
    if (layer.source.kind === 'sequence' && (rendersVideo || rendersAudio)) {
      requireCapability(filters.has('nested-sequence'), layerIssue(layer.id, 'filter:nested-sequence', 'nested sequence composition'))
    }
    if (rendersVideo && hasVideo) {
      requireCapability(filters.has('scale'), layerIssue(layer.id, 'filter:scale', 'scale'))
      if (layer.visual.fit === 'pad' || (!overlayRequired && layer.visual.fit === 'fit')) {
        requireCapability(filters.has('pad'), layerIssue(layer.id, 'filter:pad', 'canvas padding'))
      }
      if (layer.visual.fit === 'crop' || Object.values(layer.visual.crop).some((value) => value !== 0)) {
        requireCapability(filters.has('crop'), layerIssue(layer.id, 'filter:crop', 'crop'))
      }
      if (layer.visual.transform.rotation !== 0) {
        requireCapability(filters.has('rotate'), layerIssue(layer.id, 'filter:rotate', 'rotation'))
      }
      if (layer.visual.opacity !== 1) {
        requireCapability(filters.has('opacity'), layerIssue(layer.id, 'filter:opacity', 'opacity'))
      }
      if (layer.visual.blendMode !== 'normal') {
        requireCapability(filters.has(`blend:${layer.visual.blendMode}`), issue(
          layer.id,
          'layer',
          `filter:blend:${layer.visual.blendMode}`,
          `Layer ${layer.id} requires ${layer.visual.blendMode} blend composition.`,
          'Use normal blending, bake the layer to a proxy, or select a backend advertising the requested blend mode.'
        ))
      }
      if (layer.visual.fadeInFrames > 0 || layer.visual.fadeOutFrames > 0) {
        requireCapability(filters.has('fade'), layerIssue(layer.id, 'filter:fade', 'visual fades'))
      }
      for (const effect of layer.effects.filter(({ enabled }) => enabled)) {
        requireCapability(effects.has(effect.type), issue(
          effect.id, 'effect', `effect:${effect.type}`,
          `Effect ${effect.type} on ${layer.id} is unsupported by ${capabilities.id}.`,
          `Disable ${effect.type}, approve an explicit fallback, or select a backend that advertises it.`
        ))
      }
      for (const keyframes of layer.keyframes) {
        requireCapability(filters.has('keyframes'), issue(
          keyframes.id, 'layer', 'filter:keyframes',
          `Keyframed property ${keyframes.property} on ${layer.id} is unsupported by ${capabilities.id}.`,
          'Bake the animation to a proxy or select a keyframe-capable backend.'
        ))
      }
    }
    if (rendersAudio && layer.audio.enabled && hasAudio) {
      requireCapability(filters.has('audio-mix'), layerIssue(layer.id, 'filter:audio-mix', 'audio mix'))
      if (layer.audio.fadeInFrames > 0 || layer.audio.fadeOutFrames > 0) {
        requireCapability(filters.has('audio-fade'), layerIssue(layer.id, 'filter:audio-fade', 'audio fades'))
      }
    }
  }
  if (rendersVideo && (ir.textPolicy === 'burned' || ir.textPolicy === 'both') && ir.textLayers.length > 0) {
    requireCapability(filters.has('drawtext'), issue(
      ir.textLayers[0]!.id, 'text', 'filter:drawtext',
      `Backend ${capabilities.id} cannot render required text layers.`,
      "Use sidecar captions, install drawtext/font support, or explicitly approve a fallback."
    ))
    for (const text of ir.textLayers) {
      requireCapability(fonts.has('*') || fonts.has(text.style.fontFamily), issue(
        text.id, 'text', `font:${text.style.fontFamily}`,
        `Required font ${text.style.fontFamily} is unavailable for ${text.id}.`,
        'Install the font, select an approved replacement, or export sidecar captions.'
      ))
      if (text.style.fontWeight !== undefined) {
        requireCapability(filters.has('text-font-weight'), issue(
          text.id, 'text', 'filter:text-font-weight',
          `Text layer ${text.id} requires explicit font weight ${text.style.fontWeight}.`,
          'Use the default weight, export a sidecar, or select a backend with font-weight support.'
        ))
      }
      if (text.style.maxWidthRatio !== undefined) {
        requireCapability(filters.has('text-wrap'), issue(
          text.id, 'text', 'filter:text-wrap',
          `Text layer ${text.id} requires a rendered-width bound.`,
          'Remove the explicit width bound, export a sidecar, or select a text-layout-capable backend.'
        ))
      }
      if (text.animation.kind !== 'none') {
        requireCapability(filters.has(`text-animation:${text.animation.kind}`), issue(
          text.id, 'text', `filter:text-animation:${text.animation.kind}`,
          `Text layer ${text.id} requires ${text.animation.kind} animation.`,
          'Disable the animation, bake it to a proxy, or select a backend that advertises this animation.'
        ))
      }
    }
  }
  return {
    supported: unsupported.length === 0,
    target,
    backendId: capabilities.id,
    backendVersion: capabilities.version,
    capabilitiesDigest: renderCapabilitiesDigest(capabilities),
    hardwareAcceleration: capabilities.hardwareAcceleration,
    unsupported
  }
}

export function assertRenderIrSupported(report: RenderCapabilityReport): void {
  if (report.supported) return
  throw engineError(
    'render_unsupported',
    `Render backend ${report.backendId} cannot execute ${report.unsupported.length} required IR node(s): ` +
      report.unsupported.map(({ nodeId, capability }) => `${nodeId} (${capability})`).join(', '),
    {
      backendId: report.backendId,
      backendVersion: report.backendVersion,
      capabilitiesDigest: report.capabilitiesDigest,
      unsupported: report.unsupported
    }
  )
}

export function resolveInteractivePlayback(ir: CanonicalRenderIr): InteractivePlaybackDecision {
  const irDigest = renderIrDigest(ir)
  const reasons: string[] = []
  const visualLayers = ir.layers.filter((layer) => {
    const sourceId = layer.source.kind === 'asset' ? layer.source.sourceId : undefined
    const source = sourceId
      ? ir.sources.find(({ id }) => id === sourceId)
      : undefined
    return source?.video !== undefined || source?.still !== undefined || layer.source.kind === 'sequence'
  })
  const layer = visualLayers[0]
  const sourceId = layer?.source.kind === 'asset' ? layer.source.sourceId : undefined
  const source = sourceId
    ? ir.sources.find(({ id }) => id === sourceId)
    : undefined
  if (visualLayers.length !== 1) reasons.push('visual-layer-count')
  if (!layer || !source?.video) reasons.push('source-video-unavailable')
  if (layer) {
    if (layer.source.kind !== 'asset') reasons.push('nested-sequence')
    if (layer.timeline.startFrame !== ir.range.startFrame || layer.timeline.endFrame !== ir.range.endFrame) reasons.push('range-or-gap')
    if (layer.sourceMap.speed.numerator !== layer.sourceMap.speed.denominator) reasons.push('retimed-source')
    if (layer.sourceMap.startUs !== 0 || (source && layer.sourceMap.endUs !== source.durationUs)) reasons.push('trimmed-source')
    if (!identityTransform(layer.visual.transform)) reasons.push('visual-transform')
    if (Object.values(layer.visual.crop).some((value) => value !== 0)) reasons.push('crop')
    if (layer.visual.opacity !== 1) reasons.push('opacity')
    if (layer.visual.fadeInFrames !== 0 || layer.visual.fadeOutFrames !== 0) reasons.push('visual-fade')
    if (layer.effects.some(({ enabled }) => enabled)) reasons.push('effect')
    if (layer.keyframes.length > 0) reasons.push('keyframes')
    if (source?.audio && (!layer.audio.enabled || layer.audio.volume !== 1)) reasons.push('audio-mix')
    if (source?.audio && (layer.audio.fadeInFrames !== 0 || layer.audio.fadeOutFrames !== 0)) reasons.push('audio-fade')
  }
  if (source?.video && (source.video.width !== ir.canvas.width || source.video.height !== ir.canvas.height)) {
    reasons.push('canvas-scaling')
  }
  if (source?.video?.rotation !== 0) reasons.push('source-rotation')
  if (source?.video && !sameRational(source.video.frameRate, ir.fps)) reasons.push('frame-rate-conversion')
  if (source?.video && source.video.codec.toLowerCase() !== 'h264') reasons.push('source-video-codec')
  if (source?.audio && !['aac', 'mp3'].includes(source.audio.codec.toLowerCase())) reasons.push('source-audio-codec')
  if (source && !source.container.toLowerCase().split(',').some((container) => container.trim() === 'mp4')) {
    reasons.push('source-container')
  }
  if ((ir.textPolicy === 'burned' || ir.textPolicy === 'both') && ir.textLayers.length > 0) reasons.push('burned-text')
  return reasons.length === 0 && layer && source
    ? {
        mode: 'source-fast-path',
        irDigest,
        projectId: ir.projectId,
        sequenceId: ir.sequenceId,
        revision: ir.revision,
        sourceId: source.id,
        layerId: layer.id,
        reasons: []
      }
    : {
        mode: 'composed-proof',
        irDigest,
        projectId: ir.projectId,
        sequenceId: ir.sequenceId,
        revision: ir.revision,
        reasons: [...new Set(reasons)].sort()
      }
}

export function defaultFfmpegCapabilities(): RenderBackendCapabilities {
  return {
    id: 'ffmpeg',
    version: 'negotiated',
    codecs: ['aac', 'ffv1', 'h264', 'h265', 'png', 'prores'],
    filters: [
      'audio-fade', 'audio-mix', 'color-source', 'concat', 'crop',
      'drawtext', 'fade', 'opacity', 'overlay', 'pad', 'rotate', 'scale'
    ],
    effects: [],
    colorSpaces: ['bt709'],
    fonts: ['sans-serif'],
    maxSources: RENDER_IR_LIMITS.sources,
    maxLayers: RENDER_IR_LIMITS.layers,
    maxTextLayers: RENDER_IR_LIMITS.textLayers,
    hardwareAcceleration: 'optional'
  }
}

function activeSequenceProjection(project: VideoProject): SequenceProjection {
  return activeSequence(project)
}

function sequenceDurationFrames(sequence: SequenceProjection): number {
  return Math.max(
    0,
    ...sequence.items.map((item) => item.timelineStartFrame + item.durationFrames),
    ...sequence.captions.map((caption) => caption.endFrame)
  )
}

function renderSource(asset: MediaAsset): RenderIrSource {
  const reference = asset.mediaHandleId
    ? { kind: 'media-handle' as const, reference: asset.mediaHandleId }
    : asset.workspaceRelativePath
      ? { kind: 'workspace-file' as const, reference: asset.workspaceRelativePath }
      : undefined
  if (!reference) throw engineError('render_unsupported', `Asset ${asset.id} has no durable media reference`)
  return {
    id: asset.id,
    assetId: asset.id,
    reference,
    durationUs: asset.durationUs,
    container: asset.container,
    ...(asset.video ? {
      video: {
        ...structuredClone(asset.video),
        rotation: asset.video.rotation ?? 0
      }
    } : {}),
    ...(asset.audio ? { audio: structuredClone(asset.audio) } : {}),
    ...(asset.still ? {
      still: {
        ...structuredClone(asset.still),
        loop: asset.still.loop ?? false
      }
    } : {})
  }
}

function renderLayer(
  project: VideoProject,
  item: ExtendedTimelineItem,
  trackOrder: number,
  itemOrder: number,
  sourceIds: ReadonlySet<string>
): RenderIrMediaLayer {
  const nestedSequenceId = item.nestedSequenceId
  if (nestedSequenceId && !project.sequences.some(({ id }) => id === nestedSequenceId)) {
    throw engineError('invalid_project', `Timeline item ${item.id} refers to missing sequence ${nestedSequenceId}`)
  }
  if (!nestedSequenceId && !sourceIds.has(item.assetId)) {
    throw engineError('invalid_project', `Timeline item ${item.id} refers to missing asset ${item.assetId}`)
  }
  const crop = item.crop ?? { left: 0, top: 0, right: 0, bottom: 0 }
  const effects = (item.effects ?? []).map((effect) => ({
    id: effect.id,
    type: effect.type,
    enabled: effect.enabled,
    parameters: Object.fromEntries(Object.entries(effect.parameters).sort(([left], [right]) => left.localeCompare(right)))
  }))
  const keyframes = (item.keyframes ?? []).map((track) => ({
    id: track.id,
    property: track.property,
    interpolation: track.interpolation,
    points: [...track.points].sort((left, right) => left.frame - right.frame || left.id.localeCompare(right.id))
  }))
  return {
    id: item.id,
    kind: 'media',
    trackId: item.trackId,
    trackOrder,
    itemOrder,
    source: nestedSequenceId
      ? { kind: 'sequence', sequenceId: nestedSequenceId }
      : { kind: 'asset', sourceId: item.assetId },
    timeline: itemRange(item),
    sourceMap: {
      startUs: item.sourceStartUs,
      endUs: item.sourceEndUs,
      speed: structuredClone(item.speed)
    },
    visual: {
      fit: project.canvas.fit,
      transform: structuredClone(item.transform),
      crop: structuredClone(crop),
      opacity: item.visible === false ? 0 : item.opacity,
      fadeInFrames: item.fadeInFrames,
      fadeOutFrames: item.fadeOutFrames,
      blendMode: item.blendMode ?? 'normal'
    },
    audio: {
      enabled: !(project.tracks.find(({ id }) => id === item.trackId)?.muted ?? false) && item.muted !== true,
      volume: item.volume ?? 1,
      fadeInFrames: item.fadeInFrames,
      fadeOutFrames: item.fadeOutFrames
    },
    effects,
    keyframes
  }
}

function renderTextLayer(project: VideoProject, caption: Caption, trackOrder: number): RenderIrTextLayer {
  const words = (caption.words ?? []).map((word) => structuredClone(word))
  if (words.length > RENDER_IR_LIMITS.wordsPerTextLayer) {
    throw engineError('render_unsupported', `Text layer ${caption.id} exceeds the ${RENDER_IR_LIMITS.wordsPerTextLayer} word limit`)
  }
  return {
    id: caption.id,
    kind: 'text',
    trackId: caption.trackId,
    trackOrder,
    timeline: { startFrame: caption.startFrame, endFrame: caption.endFrame },
    text: caption.text,
    placement: caption.placement,
    style: {
      fontFamily: caption.style?.fontFamily ?? 'sans-serif',
      fontSize: caption.style?.fontSize ?? Math.max(18, Math.min(96, Math.round(project.canvas.height / 24))),
      color: caption.style?.color ?? '#FFFFFF',
      background: caption.style?.background ?? '#000000',
      ...(caption.style?.fontWeight === undefined ? {} : { fontWeight: caption.style.fontWeight }),
      ...(caption.style?.maxWidthRatio === undefined ? {} : { maxWidthRatio: caption.style.maxWidthRatio })
    },
    words,
    animation: {
      kind: caption.animation?.kind ?? 'none',
      durationFrames: caption.animation?.durationFrames ?? 0
    }
  }
}

function itemRange(item: TimelineItem): RenderFrameRange {
  return {
    startFrame: item.timelineStartFrame,
    endFrame: item.timelineStartFrame + item.durationFrames
  }
}

function intersects(left: RenderFrameRange, right: RenderFrameRange): boolean {
  return left.startFrame < right.endFrame && right.startFrame < left.endFrame
}

function validateFrameRange(range: RenderFrameRange, maximum?: number): void {
  nonNegativeInteger(range.startFrame, 'range.startFrame')
  positiveInteger(range.endFrame, 'range.endFrame')
  if (range.endFrame <= range.startFrame) invalid('Render range must be non-empty')
  if (maximum !== undefined && range.endFrame > maximum) invalid('Render range exceeds the composed sequence')
}

function validateReference(reference: RenderSourceReference): void {
  if (reference.kind !== 'media-handle' && reference.kind !== 'workspace-file') invalid('Unsupported source reference kind')
  boundedString(reference.reference, 'source reference', 512)
  if (containsNullOrLineBreak(reference.reference)) invalid('Source reference contains control characters')
}

function validateBackendCapabilities(capabilities: RenderBackendCapabilities): void {
  boundedString(capabilities.id, 'backend id', 128)
  boundedString(capabilities.version, 'backend version', 128)
  for (const [name, values] of Object.entries({
    codecs: capabilities.codecs,
    filters: capabilities.filters,
    effects: capabilities.effects,
    colorSpaces: capabilities.colorSpaces,
    fonts: capabilities.fonts
  })) {
    if (!Array.isArray(values) || values.length > 512) invalid(`Backend ${name} catalog is invalid`)
    values.forEach((value) => boundedString(value, `backend ${name}`, 128))
  }
  positiveInteger(capabilities.maxSources, 'backend maxSources')
  positiveInteger(capabilities.maxLayers, 'backend maxLayers')
  positiveInteger(capabilities.maxTextLayers, 'backend maxTextLayers')
  if (!['none', 'optional', 'required'].includes(capabilities.hardwareAcceleration)) {
    invalid('Backend hardwareAcceleration declaration is invalid')
  }
}

function normalizeCapabilities(capabilities: RenderBackendCapabilities): RenderBackendCapabilities {
  const sorted = (values: string[]): string[] => [...new Set(values)].sort()
  return {
    ...capabilities,
    codecs: sorted(capabilities.codecs),
    filters: sorted(capabilities.filters),
    effects: sorted(capabilities.effects),
    colorSpaces: sorted(capabilities.colorSpaces),
    fonts: sorted(capabilities.fonts)
  }
}

function issue(
  nodeId: string,
  nodeType: UnsupportedRenderNode['nodeType'],
  capability: string,
  message: string,
  guidance: string
): UnsupportedRenderNode {
  return { nodeId, nodeType, capability, message, guidance }
}

function layerIssue(layerId: string, capability: string, label: string): UnsupportedRenderNode {
  return issue(
    layerId,
    'layer',
    capability,
    `Layer ${layerId} requires ${label}, which the selected backend does not advertise.`,
    `Remove ${label}, bake the layer to a proxy, or select a compatible backend.`
  )
}

function identityTransform(transform: TimelineItem['transform']): boolean {
  return transform.x === 0 && transform.y === 0 && transform.scaleX === 1 &&
    transform.scaleY === 1 && transform.rotation === 0
}

function sameRational(left: Rational, right: Rational): boolean {
  return left.numerator * right.denominator === right.numerator * left.denominator
}

function requiresOverlayFilter(ir: CanonicalRenderIr): boolean {
  if ((ir.textPolicy === 'burned' || ir.textPolicy === 'both') && ir.textLayers.length > 0) return true
  const visualLayers = ir.layers.filter((layer) => {
    if (layer.source.kind === 'sequence') return true
    const sourceId = layer.source.sourceId
    const source = ir.sources.find(({ id }) => id === sourceId)
    return source?.video !== undefined || source?.still !== undefined
  })
  if (visualLayers.length === 0) return false
  const trackId = visualLayers[0]!.trackId
  let cursor = ir.range.startFrame
  for (const layer of visualLayers) {
    if (
      layer.trackId !== trackId ||
      layer.timeline.startFrame !== cursor ||
      !identityTransform(layer.visual.transform) ||
      Object.values(layer.visual.crop).some((value) => value !== 0) ||
      layer.visual.opacity !== 1 ||
      layer.visual.blendMode !== 'normal' ||
      layer.visual.fadeInFrames !== 0 ||
      layer.visual.fadeOutFrames !== 0 ||
      layer.effects.some(({ enabled }) => enabled) ||
      layer.keyframes.length > 0
    ) return true
    cursor = layer.timeline.endFrame
  }
  return cursor !== ir.range.endFrame
}

function assertCanonicalOrder(ir: CanonicalRenderIr): void {
  assertOrdered(ir.sources, (left, right) => left.id.localeCompare(right.id), 'sources')
  assertOrdered(ir.layers, (left, right) =>
    left.trackOrder - right.trackOrder ||
    left.trackId.localeCompare(right.trackId) ||
    left.timeline.startFrame - right.timeline.startFrame ||
    left.id.localeCompare(right.id), 'layers')
  assertOrdered(ir.textLayers, (left, right) =>
    left.trackOrder - right.trackOrder ||
    left.timeline.startFrame - right.timeline.startFrame ||
    left.id.localeCompare(right.id), 'textLayers')
}

function assertOrdered<T>(values: readonly T[], compare: (left: T, right: T) => number, label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (compare(values[index - 1]!, values[index]!) > 0) invalid(`Render IR ${label} are not in canonical order`)
  }
}

function validateColor(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^#[0-9A-Fa-f]{6}$/u.test(value)) invalid(`${label} must be a six-digit hexadecimal color`)
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)]))
  }
  return value
}

function boundedId(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,191}$/u.test(value) ||
    value === '.' || value === '..'
  ) {
    invalid(`${label} must be a bounded identifier`)
  }
}

function boundedString(value: unknown, label: string, maximum: number): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || value.includes('\0')) {
    invalid(`${label} must be a bounded string`)
  }
}

function nonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(`${label} must be a non-negative integer`)
}

function positiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) invalid(`${label} must be a positive integer`)
}

function finiteBetween(value: unknown, minimum: number, maximum: number, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    invalid(`${label} must be between ${minimum} and ${maximum}`)
  }
}

function finite(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(`${label} must be finite`)
}

function invalid(message: string): never {
  throw engineError('render_unsupported', message)
}
