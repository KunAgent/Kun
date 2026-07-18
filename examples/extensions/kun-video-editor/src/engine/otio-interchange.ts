import { createHash } from 'node:crypto'
import { engineError } from './errors.js'
import {
  VideoProjectSchema,
  validateProjectRoundTrip,
  type Caption,
  type EffectInstance,
  type KeyframeTrack,
  type Rational,
  type Sequence,
  type TimelineItem,
  type Track,
  type VideoProject
} from './schema.js'
import { framesToMicroseconds, microsecondsToFrames, rescaleFrames } from './time.js'
import { containsNullOrLineBreak, replaceNullOrLineBreaks } from '../text-safety.js'

export const OTIO_ADAPTER_ID = 'kun.otio-json' as const
export const OTIO_ADAPTER_VERSION = '1.0.0' as const

export const OTIO_LIMITS = Object.freeze({
  documentBytes: 4 * 1024 * 1024,
  lossEntries: 128,
  timecodeMappings: 20_000,
  objectNodes: 100_000
})

export type InterchangeLossEntry = {
  code: string
  severity: 'info' | 'warning'
  feature: string
  nodeId: string
  preservation: 'otio-standard' | 'kun-metadata'
  message: string
}

export type InterchangeLossManifest = {
  adapterId: typeof OTIO_ADAPTER_ID
  adapterVersion: typeof OTIO_ADAPTER_VERSION
  portableLossless: boolean
  kunRoundTripLossless: boolean
  entries: InterchangeLossEntry[]
  truncated: number
}

export type OtioTimecodeMapping = {
  id: string
  sequenceId: string
  startFrame: number
  endFrame: number
  startTimecode: string
  endTimecode: string
  frameRate: Rational
}

export type OtioInterchangeExport = {
  adapterId: typeof OTIO_ADAPTER_ID
  adapterVersion: typeof OTIO_ADAPTER_VERSION
  projectId: string
  projectRevision: number
  document: Record<string, unknown>
  documentDigest: string
  projectDigest: string
  timecodeMappings: OtioTimecodeMapping[]
  lossManifest: InterchangeLossManifest
}

export type OtioInterchangeImport = {
  adapterId: typeof OTIO_ADAPTER_ID
  adapterVersion: typeof OTIO_ADAPTER_VERSION
  project: VideoProject
  sourceDocumentDigest: string
  fidelity: 'kun-metadata' | 'portable-otio'
  mediaRelinkRequired: string[]
  timecodeMappings: OtioTimecodeMapping[]
  lossManifest: InterchangeLossManifest
}

type LossCollector = {
  entries: InterchangeLossEntry[]
  truncated: number
  keys: Set<string>
}

export function exportProjectToOtio(project: VideoProject): OtioInterchangeExport {
  const validated = validateProjectRoundTrip(project)
  const portableProject = sanitizeProject(validated)
  const projectDigest = canonicalDigest(portableProject)
  const loss = lossCollector()
  const timecodeMappings: OtioTimecodeMapping[] = []
  const children = validated.sequences
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((sequence) => otioTimeline(validated, sequence, loss, timecodeMappings))
  if (validated.sequences.length > 1) {
    addLoss(loss, {
      code: 'multiple-sequences-collection',
      severity: 'info',
      feature: 'multiple-sequences',
      nodeId: validated.id,
      preservation: 'otio-standard',
      message: 'Sequences are represented as Timeline children of an OTIO SerializableCollection.'
    })
  }
  if (validated.linkGroups.length > 0) {
    addLoss(loss, metadataLoss(
      'link-groups-custom-metadata', 'link-groups', validated.id,
      'A/V and sync link groups are preserved in Kun metadata because OTIO has no portable link-group contract.'
    ))
  }
  if (validated.transcripts.length > 0) {
    addLoss(loss, metadataLoss(
      'transcripts-custom-metadata', 'transcripts', validated.id,
      'Timed transcripts are preserved in Kun metadata and are not portable OTIO timeline objects.'
    ))
  }
  if (validated.derivedReferences.length > 0) {
    addLoss(loss, metadataLoss(
      'derived-media-custom-metadata', 'derived-media', validated.id,
      'Derived-media provenance is preserved in Kun metadata; cache payloads are not exported through OTIO.'
    ))
  }
  const manifest = lossManifest(loss)
  const document: Record<string, unknown> = {
    OTIO_SCHEMA: 'SerializableCollection.1',
    name: validated.name,
    metadata: {
      kun: {
        adapterId: OTIO_ADAPTER_ID,
        adapterVersion: OTIO_ADAPTER_VERSION,
        projectId: validated.id,
        projectRevision: validated.currentRevision,
        frameRate: structuredClone(validated.fps),
        projectDigest,
        project: portableProject,
        lossManifest: manifest
      }
    },
    children
  }
  assertDocumentBounds(document)
  const documentDigest = canonicalDigest(document)
  return {
    adapterId: OTIO_ADAPTER_ID,
    adapterVersion: OTIO_ADAPTER_VERSION,
    projectId: validated.id,
    projectRevision: validated.currentRevision,
    document,
    documentDigest,
    projectDigest,
    timecodeMappings,
    lossManifest: manifest
  }
}

export function serializeOtioInterchange(value: OtioInterchangeExport): Uint8Array {
  if (value.adapterId !== OTIO_ADAPTER_ID || value.adapterVersion !== OTIO_ADAPTER_VERSION) {
    invalid('Unsupported OTIO adapter identity')
  }
  assertDocumentBounds(value.document)
  if (canonicalDigest(value.document) !== value.documentDigest) invalid('OTIO document digest does not match its content')
  return Buffer.from(`${stableStringify(value.document)}\n`, 'utf8')
}

export function importProjectFromOtio(value: unknown): OtioInterchangeImport {
  const document = parseDocument(value)
  assertDocumentBounds(document)
  const documentDigest = canonicalDigest(document)
  validateKunMediaReferences(document)
  const metadata = optionalRecord(document.metadata)
  const kun = optionalRecord(metadata?.kun)
  if (!kun || kun.adapterId !== OTIO_ADAPTER_ID || kun.adapterVersion !== OTIO_ADAPTER_VERSION) {
    return importPortableOtio(document, documentDigest)
  }
  const projectDigest = stringValue(kun.projectDigest, 'metadata.kun.projectDigest', 64)
  const rawProject = structuredClone(record(kun.project, 'metadata.kun.project'))
  if (canonicalDigest(rawProject) !== projectDigest) invalid('OTIO project metadata digest does not match its content')
  const project = validateProjectRoundTrip(VideoProjectSchema.parse(rawProject))
  if (project.id !== kun.projectId || project.currentRevision !== kun.projectRevision) {
    invalid('OTIO project identity or revision metadata is inconsistent')
  }
  const loss = parseLossManifest(kun.lossManifest)
  const mappings = collectTimecodeMappings(document, project.fps)
  return {
    adapterId: OTIO_ADAPTER_ID,
    adapterVersion: OTIO_ADAPTER_VERSION,
    project,
    sourceDocumentDigest: documentDigest,
    fidelity: 'kun-metadata',
    mediaRelinkRequired: project.assets.map(({ id }) => id).sort(),
    timecodeMappings: mappings,
    lossManifest: loss
  }
}

function importPortableOtio(
  document: Record<string, unknown>,
  documentDigest: string
): OtioInterchangeImport {
  const timelines = arrayValue(document.children, 'OTIO collection children')
    .map((value, index) => record(value, `OTIO timeline ${index}`))
  if (timelines.length === 0 || timelines.some(({ OTIO_SCHEMA }) => OTIO_SCHEMA !== 'Timeline.1')) {
    invalid('Portable OTIO import requires at least one Timeline.1 child')
  }
  const fps = portableFrameRate(timelines[0]!)
  const assets = new Map<string, VideoProject['assets'][number]>()
  const loss = lossCollector()
  addLoss(loss, metadataLoss(
    'portable-import-default-canvas', 'canvas', 'canvas',
    'OTIO does not define a project canvas; import uses a 1920x1080 BT.709-compatible default.'
  ))
  addLoss(loss, metadataLoss(
    'portable-import-no-kun-snapshot', 'project-metadata', 'project',
    'This OTIO document has no Kun round-trip snapshot; only the bounded portable timeline subset is imported.'
  ))
  const sequences = timelines.map((timeline, sequenceIndex) =>
    portableSequence(timeline, sequenceIndex, fps, assets, loss))
  const projectId = `otio-${documentDigest.slice(0, 24)}`
  const active = sequences[0]!
  const timestamp = '1970-01-01T00:00:00.000Z'
  const project: VideoProject = {
    schemaVersion: 2,
    id: projectId,
    name: safeOtioName(document.name, 'Imported OTIO project'),
    createdAt: timestamp,
    updatedAt: timestamp,
    fps,
    canvas: {
      preset: '16:9', width: 1_920, height: 1_080, fit: 'fit', background: '#000000'
    },
    assets: [...assets.values()].sort((left, right) => left.id.localeCompare(right.id)),
    tracks: structuredClone(active.tracks),
    items: structuredClone(active.items),
    captions: structuredClone(active.captions),
    sequences,
    activeSequenceId: active.id,
    linkGroups: [],
    selection: {
      generation: 0,
      revision: 0,
      sequenceId: active.id,
      playheadFrame: 0,
      selectedAssetIds: [],
      selectedItemIds: [],
      selectedCaptionIds: [],
      selectedWordIds: []
    },
    transcripts: [],
    derivedReferences: [],
    currentRevision: 0,
    eventGeneration: 0,
    revisions: [{
      revision: 0,
      parentRevision: null,
      author: 'system',
      sourceOperation: 'interchange.otio.import',
      timestamp,
      summary: 'Imported bounded portable OTIO timeline',
      operations: [],
      inverseOperations: []
    }],
    undoStack: [],
    redoStack: [],
    agentUndoStack: [],
    recovery: {
      mode: 'healthy',
      unreadableManifestKinds: [],
      interruptedJobIds: [],
      notes: ['Media references require Host-authorized relink after OTIO import.']
    }
  }
  const validated = validateProjectRoundTrip(project)
  const mappings: OtioTimecodeMapping[] = []
  for (const sequence of validated.sequences) {
    for (const item of sequence.items) {
      addMapping(
        mappings, fps, sequence.id, item.id,
        item.timelineStartFrame, item.timelineStartFrame + item.durationFrames
      )
    }
    for (const caption of sequence.captions) {
      addMapping(mappings, fps, sequence.id, caption.id, caption.startFrame, caption.endFrame)
    }
  }
  return {
    adapterId: OTIO_ADAPTER_ID,
    adapterVersion: OTIO_ADAPTER_VERSION,
    project: validated,
    sourceDocumentDigest: documentDigest,
    fidelity: 'portable-otio',
    mediaRelinkRequired: validated.assets.map(({ id }) => id).sort(),
    timecodeMappings: mappings,
    lossManifest: lossManifest(loss, false)
  }
}

function portableSequence(
  timeline: Record<string, unknown>,
  sequenceIndex: number,
  fps: Rational,
  assets: Map<string, VideoProject['assets'][number]>,
  loss: LossCollector
): Sequence {
  const timelineMetadata = optionalRecord(optionalRecord(timeline.metadata)?.kun)
  const sequenceId = optionalOtioId(timelineMetadata?.id) ?? `sequence-${sequenceIndex + 1}`
  const stack = record(timeline.tracks, `OTIO timeline ${sequenceIndex} tracks`)
  if (stack.OTIO_SCHEMA !== 'Stack.1') invalid(`OTIO timeline ${sequenceIndex} tracks must be Stack.1`)
  const tracks: Track[] = []
  const items: TimelineItem[] = []
  const captions: Caption[] = []
  for (const [trackIndex, rawTrack] of arrayValue(stack.children, 'OTIO stack children').entries()) {
    const trackNode = record(rawTrack, `OTIO track ${trackIndex}`)
    if (trackNode.OTIO_SCHEMA !== 'Track.1') invalid(`OTIO track ${trackIndex} must be Track.1`)
    const metadata = optionalRecord(optionalRecord(trackNode.metadata)?.kun)
    const declaredKind = metadata?.kind
    const kind: Track['kind'] = declaredKind === 'caption'
      ? 'caption'
      : trackNode.kind === 'Audio'
        ? 'audio'
        : 'video'
    const trackId = optionalOtioId(metadata?.id) ?? `${sequenceId}.track-${trackIndex + 1}`
    tracks.push({
      id: trackId,
      name: safeOtioName(trackNode.name, kind === 'audio' ? 'Audio' : kind === 'caption' ? 'Captions' : 'Video'),
      kind,
      order: trackIndex,
      overlap: kind === 'audio' ? 'mix' : 'reject',
      ...(metadata?.muted === true ? { muted: true } : {}),
      ...(metadata?.locked === true ? { locked: true } : {})
    })
    let cursor = 0
    for (const [childIndex, rawChild] of arrayValue(trackNode.children, `OTIO track ${trackIndex} children`).entries()) {
      const child = record(rawChild, `OTIO track ${trackIndex} child ${childIndex}`)
      const durationFrames = otioRangeDuration(child.source_range, fps)
      if (child.OTIO_SCHEMA === 'Gap.1') {
        cursor += durationFrames
        continue
      }
      if (child.OTIO_SCHEMA !== 'Clip.2') invalid('Portable OTIO tracks support only Clip.2 and Gap.1 children')
      const childMetadata = optionalRecord(optionalRecord(child.metadata)?.kun)
      const timelineStartFrame = nonNegativeOtioInteger(childMetadata?.timelineStartFrame) ?? cursor
      const stableId = optionalOtioId(childMetadata?.id) ?? `${trackId}.clip-${childIndex + 1}`
      if (kind === 'caption' && optionalRecord(childMetadata?.caption)) {
        const captionValue = structuredClone(childMetadata!.caption) as Caption
        captionValue.id = stableId
        captionValue.trackId = trackId
        captionValue.startFrame = timelineStartFrame
        captionValue.endFrame = timelineStartFrame + durationFrames
        captions.push(captionValue)
      } else {
        items.push(portableClip(
          child, childMetadata, stableId, trackId, timelineStartFrame,
          durationFrames, kind, fps, assets, loss
        ))
      }
      cursor = Math.max(cursor, timelineStartFrame + durationFrames)
    }
  }
  if (tracks.length === 0) invalid(`Portable OTIO sequence ${sequenceId} has no tracks`)
  return {
    id: sequenceId,
    name: safeOtioName(timeline.name, `Sequence ${sequenceIndex + 1}`),
    tracks,
    items,
    captions,
    viewState: { zoom: 1, scrollFrame: 0, open: sequenceIndex === 0 }
  }
}

function portableClip(
  clip: Record<string, unknown>,
  metadata: Record<string, unknown> | undefined,
  itemId: string,
  trackId: string,
  timelineStartFrame: number,
  durationFrames: number,
  trackKind: Track['kind'],
  fps: Rational,
  assets: Map<string, VideoProject['assets'][number]>,
  loss: LossCollector
): TimelineItem {
  const reference = record(clip.media_reference, `OTIO clip ${itemId} media_reference`)
  if (reference.OTIO_SCHEMA !== 'ExternalReference.1') {
    invalid(`Portable OTIO clip ${itemId} requires an ExternalReference.1`)
  }
  const target = stringValue(reference.target_url, `OTIO clip ${itemId} target_url`, 512)
  const assetId = decodeURIComponent(target.slice('kun-media://'.length))
  if (!optionalOtioId(assetId)) invalid(`OTIO clip ${itemId} media ID is invalid`)
  const sourceRange = record(clip.source_range, `OTIO clip ${itemId} source_range`)
  const sourceStartFrame = otioRationalFrame(sourceRange.start_time, fps)
  const sourceDurationFrames = Math.max(1, otioRationalFrame(sourceRange.duration, fps))
  const sourceStartUs = framesToMicroseconds(sourceStartFrame, fps)
  const sourceEndUs = framesToMicroseconds(sourceStartFrame + sourceDurationFrames, fps)
  const availableDuration = reference.available_range
    ? Math.max(1, otioRangeDuration(reference.available_range, fps))
    : sourceStartFrame + sourceDurationFrames
  const durationUs = framesToMicroseconds(availableDuration, fps)
  const existing = assets.get(assetId)
  if (existing) existing.durationUs = Math.max(existing.durationUs, durationUs)
  else {
    assets.set(assetId, {
      id: assetId,
      name: safeOtioName(reference.name ?? clip.name, assetId),
      kind: trackKind === 'audio' ? 'audio' : 'video',
      mediaHandleId: `otio_offline_${assetId}`,
      durationUs,
      container: 'unknown',
      transcriptIds: [],
      availability: 'offline',
      recovery: { reason: 'missing' }
    })
    addLoss(loss, metadataLoss(
      'portable-media-relink-required', 'media-reference', assetId,
      `Media ${assetId} remains offline until the Host authorizes a relink.`
    ))
  }
  const effects = portableEffects(clip.effects, itemId, loss)
  const speed = portableSpeed(clip.effects)
  return {
    id: itemId,
    assetId,
    trackId,
    timelineStartFrame,
    durationFrames,
    sourceStartUs,
    sourceEndUs,
    speed,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    opacity: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    ...(effects.length > 0 ? { effects } : {}),
    ...(Array.isArray(metadata?.keyframes) ? { keyframes: structuredClone(metadata.keyframes) as KeyframeTrack[] } : {})
  }
}

function portableEffects(value: unknown, itemId: string, loss: LossCollector): EffectInstance[] {
  if (value === undefined) return []
  const effects: EffectInstance[] = []
  for (const [index, raw] of arrayValue(value, `OTIO clip ${itemId} effects`).entries()) {
    const effect = record(raw, `OTIO clip ${itemId} effect ${index}`)
    if (effect.OTIO_SCHEMA === 'LinearTimeWarp.1') continue
    if (effect.OTIO_SCHEMA !== 'Effect.1') {
      addLoss(loss, metadataLoss(
        'portable-effect-unsupported', 'effects', `${itemId}.effect-${index + 1}`,
        `Unsupported OTIO effect schema ${String(effect.OTIO_SCHEMA)} was omitted.`
      ))
      continue
    }
    const kun = optionalRecord(optionalRecord(effect.metadata)?.kun)
    const full = kun && typeof kun.type === 'string' && optionalRecord(kun.parameters)
      ? kun as unknown as EffectInstance
      : undefined
    effects.push(full ? structuredClone(full) : {
      id: optionalOtioId(kun?.id) ?? `${itemId}.effect-${index + 1}`,
      type: safeOtioName(effect.effect_name ?? effect.name, 'otio.effect'),
      enabled: true,
      parameters: {}
    })
    addLoss(loss, metadataLoss(
      'portable-effect-parameters', 'effects', effects.at(-1)!.id,
      'Portable OTIO effect parameters may require manual review after import.'
    ))
  }
  return effects
}

function portableSpeed(value: unknown): Rational {
  if (!Array.isArray(value)) return { numerator: 1, denominator: 1 }
  const warp = value
    .map((entry) => optionalRecord(entry))
    .find((entry) => entry?.OTIO_SCHEMA === 'LinearTimeWarp.1')
  if (!warp || typeof warp.time_scalar !== 'number' || !Number.isFinite(warp.time_scalar) || warp.time_scalar <= 0) {
    return { numerator: 1, denominator: 1 }
  }
  const denominator = 1_000_000
  const numerator = Math.max(1, Math.round(warp.time_scalar * denominator))
  const divisor = gcd(numerator, denominator)
  return { numerator: numerator / divisor, denominator: denominator / divisor }
}

function portableFrameRate(timeline: Record<string, unknown>): Rational {
  const global = optionalRecord(timeline.global_start_time)
  if (global && typeof global.rate === 'number') return rateRational(global.rate)
  return { numerator: 30, denominator: 1 }
}

function rateRational(rate: number): Rational {
  if (!Number.isFinite(rate) || rate <= 0 || rate > 240) invalid('OTIO frame rate is invalid')
  const common: Array<[number, Rational]> = [
    [23.976, { numerator: 24_000, denominator: 1_001 }],
    [29.97, { numerator: 30_000, denominator: 1_001 }],
    [59.94, { numerator: 60_000, denominator: 1_001 }]
  ]
  const matched = common.find(([candidate]) => Math.abs(candidate - rate) < 0.001)
  if (matched) return matched[1]
  if (Number.isInteger(rate)) return { numerator: rate, denominator: 1 }
  const denominator = 1_000_000
  const numerator = Math.round(rate * denominator)
  const divisor = gcd(numerator, denominator)
  return { numerator: numerator / divisor, denominator: denominator / divisor }
}

function otioRangeDuration(value: unknown, fps: Rational): number {
  return Math.max(1, otioRationalFrame(record(value, 'OTIO time range').duration, fps))
}

function otioRationalFrame(value: unknown, targetFps: Rational): number {
  const time = record(value, 'OTIO RationalTime')
  if (time.OTIO_SCHEMA !== 'RationalTime.1') invalid('OTIO time value must be RationalTime.1')
  if (typeof time.value !== 'number' || !Number.isSafeInteger(time.value) || time.value < 0) {
    invalid('OTIO RationalTime value must be a non-negative integer frame')
  }
  if (typeof time.rate !== 'number') invalid('OTIO RationalTime rate is missing')
  return rescaleFrames(time.value, rateRational(time.rate), targetFps, 'nearest')
}

function optionalOtioId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._~-]{0,191}$/u.test(value)
    ? value
    : undefined
}

function nonNegativeOtioInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) invalid(`${label} must be an array`)
  return value
}

function safeOtioName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const safe = replaceNullOrLineBreaks(value, ' ').trim().slice(0, 255)
  return safe || fallback
}

function gcd(left: number, right: number): number {
  let a = left
  let b = right
  while (b !== 0) {
    const remainder = a % b
    a = b
    b = remainder
  }
  return a
}

function otioTimeline(
  project: VideoProject,
  sequence: Sequence,
  loss: LossCollector,
  mappings: OtioTimecodeMapping[]
): Record<string, unknown> {
  const tracks = sequence.tracks
    .slice()
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((track) => otioTrack(project, sequence, track, loss, mappings))
  return {
    OTIO_SCHEMA: 'Timeline.1',
    name: sequence.name,
    global_start_time: rationalTime(0, project.fps),
    metadata: {
      kun: {
        id: sequence.id,
        viewState: structuredClone(sequence.viewState),
        frameRate: structuredClone(project.fps)
      }
    },
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      name: `${sequence.name} tracks`,
      metadata: { kun: { id: `${sequence.id}.tracks` } },
      children: tracks,
      effects: [],
      markers: []
    }
  }
}

function otioTrack(
  project: VideoProject,
  sequence: Sequence,
  track: Track,
  loss: LossCollector,
  mappings: OtioTimecodeMapping[]
): Record<string, unknown> {
  const timelineEntries = track.kind === 'caption'
    ? sequence.captions
        .filter(({ trackId }) => trackId === track.id)
        .map((caption) => ({
          startFrame: caption.startFrame,
          endFrame: caption.endFrame,
          id: caption.id,
          value: otioCaption(project, sequence, caption, loss, mappings)
        }))
    : sequence.items
        .filter(({ trackId }) => trackId === track.id)
        .map((item) => ({
          startFrame: item.timelineStartFrame,
          endFrame: item.timelineStartFrame + item.durationFrames,
          id: item.id,
          value: otioClip(project, sequence, item, loss, mappings)
        }))
  timelineEntries.sort((left, right) => left.startFrame - right.startFrame || left.id.localeCompare(right.id))
  const children: Record<string, unknown>[] = []
  let cursor = 0
  for (const entry of timelineEntries) {
    if (entry.startFrame > cursor) children.push(otioGap(entry.startFrame - cursor, project.fps, track.id, cursor))
    if (entry.startFrame < cursor) {
      addLoss(loss, metadataLoss(
        'overlap-custom-metadata', 'track-overlap', entry.id,
        `Overlapping timing on track ${track.id} is exact in Kun metadata but sequential OTIO Track semantics may flatten it.`
      ))
    }
    children.push(entry.value)
    cursor = Math.max(cursor, entry.endFrame)
  }
  return {
    OTIO_SCHEMA: 'Track.1',
    name: track.name,
    kind: track.kind === 'audio' ? 'Audio' : 'Video',
    metadata: {
      kun: {
        id: track.id,
        kind: track.kind,
        order: track.order,
        overlap: track.overlap,
        muted: track.muted ?? false,
        locked: track.locked ?? false
      }
    },
    children,
    effects: [],
    markers: []
  }
}

function otioClip(
  project: VideoProject,
  sequence: Sequence,
  item: TimelineItem,
  loss: LossCollector,
  mappings: OtioTimecodeMapping[]
): Record<string, unknown> {
  const asset = project.assets.find(({ id }) => id === item.assetId)
  if (!asset && !item.nestedSequenceId) invalid(`Timeline item ${item.id} refers to a missing asset`)
  const sourceStartFrame = microsecondsToFrames(item.sourceStartUs, project.fps, 'nearest')
  const sourceDurationFrames = Math.max(
    1,
    microsecondsToFrames(item.sourceEndUs - item.sourceStartUs, project.fps, 'nearest')
  )
  const effects = otioEffects(item.effects ?? [], item.keyframes ?? [], item, loss)
  if (item.nestedSequenceId) {
    addLoss(loss, metadataLoss(
      'nested-sequence-reference-custom-metadata', 'nested-sequence', item.id,
      `Nested sequence ${item.nestedSequenceId} is preserved by stable ID in Kun metadata; OTIO consumers may flatten it.`
    ))
  }
  if (!identityVisual(item)) {
    addLoss(loss, metadataLoss(
      'visual-transform-custom-metadata', 'visual-transform', item.id,
      'Transform, crop, opacity, and fades are preserved in Kun metadata rather than portable OTIO fields.'
    ))
  }
  if (item.keyframes?.length) {
    addLoss(loss, metadataLoss(
      'keyframes-custom-metadata', 'keyframes', item.id,
      'Keyframe interpolation and property paths are preserved in Kun metadata.'
    ))
  }
  if (item.effects?.length) {
    addLoss(loss, metadataLoss(
      'effect-parameters-custom-metadata', 'effects', item.id,
      'Effect identities are emitted as OTIO Effect objects; parameters remain Kun metadata.'
    ))
  }
  addMapping(mappings, project.fps, sequence.id, item.id, item.timelineStartFrame, item.timelineStartFrame + item.durationFrames)
  return {
    OTIO_SCHEMA: 'Clip.2',
    name: item.nestedSequenceId
      ? project.sequences.find(({ id }) => id === item.nestedSequenceId)?.name ?? item.nestedSequenceId
      : asset!.name,
    source_range: timeRange(sourceStartFrame, sourceDurationFrames, project.fps),
    media_reference: item.nestedSequenceId
      ? {
          OTIO_SCHEMA: 'MissingReference.1',
          name: `Nested sequence ${item.nestedSequenceId}`,
          metadata: { kun: { nestedSequenceId: item.nestedSequenceId } },
          available_range: null
        }
      : {
          OTIO_SCHEMA: 'ExternalReference.1',
          name: asset!.name,
          target_url: `kun-media://${encodeURIComponent(asset!.id)}`,
          available_range: timeRange(
            0,
            Math.max(1, microsecondsToFrames(asset!.durationUs, project.fps, 'nearest')),
            project.fps
          ),
          metadata: { kun: { assetId: asset!.id } }
        },
    effects,
    markers: [],
    metadata: {
      kun: {
        id: item.id,
        sequenceId: sequence.id,
        assetId: item.assetId,
        timelineStartFrame: item.timelineStartFrame,
        durationFrames: item.durationFrames,
        sourceStartUs: item.sourceStartUs,
        sourceEndUs: item.sourceEndUs,
        speed: structuredClone(item.speed),
        transform: structuredClone(item.transform),
        opacity: item.opacity,
        fadeInFrames: item.fadeInFrames,
        fadeOutFrames: item.fadeOutFrames,
        ...(item.crop ? { crop: structuredClone(item.crop) } : {}),
        ...(item.volume === undefined ? {} : { volume: item.volume }),
        ...(item.linkGroupId ? { linkGroupId: item.linkGroupId } : {}),
        ...(item.nestedSequenceId ? { nestedSequenceId: item.nestedSequenceId } : {}),
        effects: structuredClone(item.effects ?? []),
        keyframes: structuredClone(item.keyframes ?? []),
        startTimecode: frameTimecode(item.timelineStartFrame, project.fps),
        endTimecode: frameTimecode(item.timelineStartFrame + item.durationFrames, project.fps)
      }
    }
  }
}

function otioCaption(
  project: VideoProject,
  sequence: Sequence,
  caption: Caption,
  loss: LossCollector,
  mappings: OtioTimecodeMapping[]
): Record<string, unknown> {
  addLoss(loss, metadataLoss(
    'caption-custom-metadata', 'caption', caption.id,
    'Editable caption text, word timing, style, and animation are preserved in Kun metadata.'
  ))
  addMapping(mappings, project.fps, sequence.id, caption.id, caption.startFrame, caption.endFrame)
  return {
    OTIO_SCHEMA: 'Clip.2',
    name: caption.text,
    source_range: timeRange(0, caption.endFrame - caption.startFrame, project.fps),
    media_reference: {
      OTIO_SCHEMA: 'MissingReference.1',
      name: 'Kun caption',
      metadata: { kun: { kind: 'caption' } },
      available_range: null
    },
    effects: [],
    markers: [],
    metadata: {
      kun: {
        id: caption.id,
        sequenceId: sequence.id,
        kind: 'caption',
        timelineStartFrame: caption.startFrame,
        durationFrames: caption.endFrame - caption.startFrame,
        caption: structuredClone(caption),
        startTimecode: frameTimecode(caption.startFrame, project.fps),
        endTimecode: frameTimecode(caption.endFrame, project.fps)
      }
    }
  }
}

function otioEffects(
  effects: readonly EffectInstance[],
  keyframes: readonly KeyframeTrack[],
  item: TimelineItem,
  loss: LossCollector
): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = effects.map((effect) => ({
    OTIO_SCHEMA: 'Effect.1',
    name: effect.type,
    effect_name: effect.type,
    metadata: { kun: structuredClone(effect) }
  }))
  if (item.speed.numerator !== item.speed.denominator) {
    result.unshift({
      OTIO_SCHEMA: 'LinearTimeWarp.1',
      name: 'Kun speed',
      effect_name: 'LinearTimeWarp',
      time_scalar: item.speed.numerator / item.speed.denominator,
      metadata: { kun: { speed: structuredClone(item.speed) } }
    })
  }
  if (keyframes.length > 0 && effects.length === 0) {
    addLoss(loss, metadataLoss(
      'keyframes-without-effect-custom-metadata', 'keyframes', item.id,
      'Property keyframes without an OTIO Effect are retained only in clip-level Kun metadata.'
    ))
  }
  return result
}

function otioGap(durationFrames: number, fps: Rational, trackId: string, startFrame: number): Record<string, unknown> {
  return {
    OTIO_SCHEMA: 'Gap.1',
    name: 'Gap',
    source_range: timeRange(0, durationFrames, fps),
    effects: [],
    markers: [],
    metadata: { kun: { id: `${trackId}.gap.${startFrame}`, startFrame, durationFrames } }
  }
}

function timeRange(startFrame: number, durationFrames: number, fps: Rational): Record<string, unknown> {
  return {
    OTIO_SCHEMA: 'TimeRange.1',
    start_time: rationalTime(startFrame, fps),
    duration: rationalTime(durationFrames, fps)
  }
}

function rationalTime(frame: number, fps: Rational): Record<string, unknown> {
  return {
    OTIO_SCHEMA: 'RationalTime.1',
    value: frame,
    rate: fps.numerator / fps.denominator,
    metadata: { kun: { frame, frameRate: structuredClone(fps) } }
  }
}

export function frameTimecode(frame: number, fps: Rational): string {
  if (!Number.isSafeInteger(frame) || frame < 0) invalid('Timecode frame must be a non-negative integer')
  const nominalRate = Math.max(1, Math.round(fps.numerator / fps.denominator))
  const frames = frame % nominalRate
  const totalSeconds = Math.floor(frame / nominalRate)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3_600)
  return [hours, minutes, seconds, frames].map((value) => String(value).padStart(2, '0')).join(':')
}

function addMapping(
  mappings: OtioTimecodeMapping[],
  fps: Rational,
  sequenceId: string,
  id: string,
  startFrame: number,
  endFrame: number
): void {
  if (mappings.length >= OTIO_LIMITS.timecodeMappings) invalid('OTIO timecode mapping limit exceeded')
  mappings.push({
    id,
    sequenceId,
    startFrame,
    endFrame,
    startTimecode: frameTimecode(startFrame, fps),
    endTimecode: frameTimecode(endFrame, fps),
    frameRate: structuredClone(fps)
  })
}

function collectTimecodeMappings(document: Record<string, unknown>, fps: Rational): OtioTimecodeMapping[] {
  const mappings: OtioTimecodeMapping[] = []
  visit(document, (node) => {
    const metadata = optionalRecord(node.metadata)
    const kun = optionalRecord(metadata?.kun)
    if (
      typeof kun?.id !== 'string' ||
      typeof kun.sequenceId !== 'string' ||
      !Number.isSafeInteger(kun.timelineStartFrame) ||
      !Number.isSafeInteger(kun.durationFrames)
    ) return
    addMapping(
      mappings,
      fps,
      kun.sequenceId,
      kun.id,
      Number(kun.timelineStartFrame),
      Number(kun.timelineStartFrame) + Number(kun.durationFrames)
    )
  })
  return mappings.sort((left, right) =>
    left.sequenceId.localeCompare(right.sequenceId) ||
    left.startFrame - right.startFrame ||
    left.id.localeCompare(right.id))
}

function sanitizeProject(project: VideoProject): VideoProject {
  const copy = structuredClone(project)
  copy.assets = copy.assets.map((asset) => {
    const sanitized = { ...asset }
    delete sanitized.workspaceRelativePath
    // Schema v2 requires a durable reference. This value is a namespaced,
    // non-reusable offline placeholder, never the source grant or a path.
    sanitized.mediaHandleId = `otio_offline_${asset.id}`
    sanitized.availability = 'offline'
    sanitized.recovery = { reason: 'missing' }
    return sanitized
  })
  return validateProjectRoundTrip(copy)
}

function identityVisual(item: TimelineItem): boolean {
  return item.transform.x === 0 && item.transform.y === 0 &&
    item.transform.scaleX === 1 && item.transform.scaleY === 1 &&
    item.transform.rotation === 0 && item.opacity === 1 &&
    item.fadeInFrames === 0 && item.fadeOutFrames === 0 &&
    !item.crop
}

function validateKunMediaReferences(document: Record<string, unknown>): void {
  visit(document, (node) => {
    if (node.OTIO_SCHEMA !== 'ExternalReference.1') return
    if (typeof node.target_url !== 'string' || !/^kun-media:\/\/[A-Za-z0-9._~%-]+$/u.test(node.target_url)) {
      invalid('OTIO external references must use bounded kun-media URLs')
    }
  })
}

function visit(value: unknown, callback: (node: Record<string, unknown>) => void): void {
  const stack: unknown[] = [value]
  let count = 0
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || typeof current !== 'object') continue
    count += 1
    if (count > OTIO_LIMITS.objectNodes) invalid('OTIO object-node limit exceeded')
    if (Array.isArray(current)) {
      stack.push(...current)
      continue
    }
    const node = current as Record<string, unknown>
    callback(node)
    stack.push(...Object.values(node))
  }
}

function parseDocument(value: unknown): Record<string, unknown> {
  const parsed = value instanceof Uint8Array || typeof value === 'string'
    ? JSON.parse(Buffer.from(value).toString('utf8')) as unknown
    : value
  const document = record(parsed, 'OTIO document')
  if (document.OTIO_SCHEMA !== 'SerializableCollection.1') invalid('OTIO root must be SerializableCollection.1')
  if (!Array.isArray(document.children)) invalid('OTIO collection children must be an array')
  return document
}

function parseLossManifest(value: unknown): InterchangeLossManifest {
  const manifest = record(value, 'lossManifest')
  if (manifest.adapterId !== OTIO_ADAPTER_ID || manifest.adapterVersion !== OTIO_ADAPTER_VERSION) {
    invalid('OTIO loss manifest adapter identity is invalid')
  }
  if (typeof manifest.portableLossless !== 'boolean' || typeof manifest.kunRoundTripLossless !== 'boolean') {
    invalid('OTIO loss manifest flags are invalid')
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length > OTIO_LIMITS.lossEntries) {
    invalid('OTIO loss manifest entries exceed their bound')
  }
  if (!Number.isSafeInteger(manifest.truncated) || Number(manifest.truncated) < 0) invalid('OTIO loss manifest truncation is invalid')
  return structuredClone(manifest) as InterchangeLossManifest
}

function lossCollector(): LossCollector {
  return { entries: [], truncated: 0, keys: new Set() }
}

function addLoss(collector: LossCollector, entry: InterchangeLossEntry): void {
  const key = `${entry.code}:${entry.nodeId}`
  if (collector.keys.has(key)) return
  collector.keys.add(key)
  if (collector.entries.length >= OTIO_LIMITS.lossEntries) {
    collector.truncated += 1
    return
  }
  collector.entries.push(entry)
}

function metadataLoss(
  code: string,
  feature: string,
  nodeId: string,
  message: string
): InterchangeLossEntry {
  return { code, severity: 'warning', feature, nodeId, preservation: 'kun-metadata', message }
}

function lossManifest(
  collector: LossCollector,
  kunRoundTripLossless = true
): InterchangeLossManifest {
  const entries = collector.entries.slice().sort((left, right) =>
    left.code.localeCompare(right.code) || left.nodeId.localeCompare(right.nodeId))
  return {
    adapterId: OTIO_ADAPTER_ID,
    adapterVersion: OTIO_ADAPTER_VERSION,
    portableLossless: entries.every(({ severity }) => severity === 'info') && collector.truncated === 0,
    kunRoundTripLossless,
    entries,
    truncated: collector.truncated
  }
}

function assertDocumentBounds(document: Record<string, unknown>): void {
  if (document.OTIO_SCHEMA !== 'SerializableCollection.1') invalid('OTIO root schema is invalid')
  visit(document, () => undefined)
  const bytes = Buffer.byteLength(stableStringify(document), 'utf8')
  if (bytes > OTIO_LIMITS.documentBytes) invalid('OTIO document exceeds its byte limit')
}

function canonicalDigest(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
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

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object`)
  return value as Record<string, unknown>
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || containsNullOrLineBreak(value)) {
    invalid(`${label} must be a bounded string`)
  }
  return value
}

function invalid(message: string): never {
  throw engineError('render_unsupported', message)
}
