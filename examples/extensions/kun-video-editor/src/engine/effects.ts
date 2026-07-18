import { engineError } from './errors.js'
import { sampleKeyframedProperties, validateKeyframeTrack } from './keyframes.js'
import type {
  BlendMode,
  EffectInstance,
  EffectParameter,
  KeyframeTrack,
  SetItemEffectsOperation,
  SetItemKeyframesOperation,
  TimelineItem
} from './schema.js'

export type NumericEffectParameter = {
  kind: 'number'
  minimum: number
  maximum: number
  defaultValue: number
  step: number
  keyframeable: true
}

export type BooleanEffectParameter = {
  kind: 'boolean'
  defaultValue: boolean
  keyframeable: false
}

export type EnumEffectParameter = {
  kind: 'enum'
  values: string[]
  defaultValue: string
  keyframeable: false
}

export type EffectCatalogEntry = {
  type: string
  category: 'color' | 'blur' | 'detail' | 'style'
  labelKey: string
  parameters: Record<string, NumericEffectParameter | BooleanEffectParameter | EnumEffectParameter>
}

export type EffectCatalog = {
  schemaVersion: 1
  effects: EffectCatalogEntry[]
  blendModes: Array<{ id: BlendMode; labelKey: string }>
  textAnimations: Array<{ id: 'none' | 'word-highlight' | 'fade'; labelKey: string; maximumDurationFrames: number }>
  keyframeProperties: string[]
}

export type SampledItemProperties = {
  transform: TimelineItem['transform']
  crop: NonNullable<TimelineItem['crop']>
  opacity: number
  volume: number
  effects: EffectInstance[]
}

const EFFECTS: Readonly<Record<string, EffectCatalogEntry>> = Object.freeze({
  'color.basic': effect('color.basic', 'color', 'video.effect.colorBasic', {
    brightness: numeric(-1, 1, 0, 0.01),
    contrast: numeric(0, 2, 1, 0.01),
    saturation: numeric(0, 3, 1, 0.01),
    gamma: numeric(0.1, 10, 1, 0.05)
  }),
  'color.temperature': effect('color.temperature', 'color', 'video.effect.colorTemperature', {
    temperature: numeric(-1, 1, 0, 0.01),
    tint: numeric(-1, 1, 0, 0.01)
  }),
  blur: effect('blur', 'blur', 'video.effect.blur', { radius: numeric(0, 100, 2, 1) }),
  sharpen: effect('sharpen', 'detail', 'video.effect.sharpen', { amount: numeric(0, 5, 1, 0.05) }),
  vignette: effect('vignette', 'style', 'video.effect.vignette', { intensity: numeric(0, 1, 0.35, 0.01) })
})

const COMPOSITION_PROPERTIES = Object.freeze([
  'transform.x', 'transform.y', 'transform.scaleX', 'transform.scaleY', 'transform.rotation',
  'crop.left', 'crop.top', 'crop.right', 'crop.bottom', 'opacity', 'volume'
])

export function boundedEffectCatalog(): EffectCatalog {
  return {
    schemaVersion: 1,
    effects: Object.values(EFFECTS).map((entry) => structuredClone(entry)),
    blendModes: [
      { id: 'normal', labelKey: 'video.blend.normal' },
      { id: 'multiply', labelKey: 'video.blend.multiply' },
      { id: 'screen', labelKey: 'video.blend.screen' },
      { id: 'overlay', labelKey: 'video.blend.overlay' }
    ],
    textAnimations: [
      { id: 'none', labelKey: 'video.textAnimation.none', maximumDurationFrames: 0 },
      { id: 'word-highlight', labelKey: 'video.textAnimation.wordHighlight', maximumDurationFrames: 300 },
      { id: 'fade', labelKey: 'video.textAnimation.fade', maximumDurationFrames: 300 }
    ],
    keyframeProperties: [...COMPOSITION_PROPERTIES]
  }
}

export function validateCatalogEffect(effect: EffectInstance): EffectInstance {
  const entry = EFFECTS[effect.type]
  if (!entry) invalid(`Unsupported effect type: ${effect.type}`)
  const unknown = Object.keys(effect.parameters).filter((key) => !(key in entry.parameters))
  if (unknown.length > 0) invalid(`Unsupported effect parameter(s): ${unknown.sort().join(', ')}`)
  const parameters: Record<string, EffectParameter> = {}
  for (const [name, definition] of Object.entries(entry.parameters)) {
    const value = effect.parameters[name] ?? definition.defaultValue
    if (definition.kind === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < definition.minimum || value > definition.maximum) {
        invalid(`${effect.type}.${name} must be between ${definition.minimum} and ${definition.maximum}`)
      }
    } else if (definition.kind === 'boolean') {
      if (typeof value !== 'boolean') invalid(`${effect.type}.${name} must be boolean`)
    } else if (typeof value !== 'string' || !definition.values.includes(value)) {
      invalid(`${effect.type}.${name} must be one of ${definition.values.join(', ')}`)
    }
    parameters[name] = value
  }
  return { ...structuredClone(effect), parameters }
}

export function planUpsertEffect(item: TimelineItem, effectValue: EffectInstance): SetItemEffectsOperation {
  const next = validateCatalogEffect(effectValue)
  const effects = structuredClone(item.effects ?? [])
  const index = effects.findIndex(({ id }) => id === next.id)
  if (index >= 0) effects[index] = next
  else effects.push(next)
  effects.sort((left, right) => left.id.localeCompare(right.id))
  return { type: 'set-item-effects', itemId: item.id, effects }
}

export function planRemoveEffect(item: TimelineItem, effectId: string): SetItemEffectsOperation {
  const effects = (item.effects ?? []).filter(({ id }) => id !== effectId).map((effect) => structuredClone(effect))
  if (effects.length === (item.effects?.length ?? 0)) invalid(`Effect does not exist: ${effectId}`)
  const removedPrefix = `effect.${effectId}.`
  const keyframes = (item.keyframes ?? []).filter(({ property }) => !property.startsWith(removedPrefix))
  if (keyframes.length !== (item.keyframes?.length ?? 0)) {
    invalid(`Remove keyframes for ${effectId} before deleting the effect`)
  }
  return { type: 'set-item-effects', itemId: item.id, effects }
}

export function planUpsertKeyframeTrack(
  item: TimelineItem,
  track: KeyframeTrack
): SetItemKeyframesOperation {
  validateKeyframeTrack(track)
  validateKeyframeProperty(item, track)
  const keyframes = structuredClone(item.keyframes ?? [])
  const index = keyframes.findIndex(({ id }) => id === track.id)
  if (index >= 0) keyframes[index] = structuredClone(track)
  else keyframes.push(structuredClone(track))
  const properties = new Set<string>()
  for (const candidate of keyframes) {
    if (properties.has(candidate.property)) invalid(`Duplicate keyframe property: ${candidate.property}`)
    properties.add(candidate.property)
  }
  keyframes.sort((left, right) => left.property.localeCompare(right.property) || left.id.localeCompare(right.id))
  return { type: 'set-item-keyframes', itemId: item.id, keyframes }
}

export function planRemoveKeyframeTrack(item: TimelineItem, trackId: string): SetItemKeyframesOperation {
  const keyframes = (item.keyframes ?? []).filter(({ id }) => id !== trackId).map((track) => structuredClone(track))
  if (keyframes.length === (item.keyframes?.length ?? 0)) invalid(`Keyframe track does not exist: ${trackId}`)
  return { type: 'set-item-keyframes', itemId: item.id, keyframes }
}

export function sampleTimelineItem(item: TimelineItem, localFrame: number): SampledItemProperties {
  if (!Number.isSafeInteger(localFrame) || localFrame < 0 || localFrame > item.durationFrames) {
    invalid('Keyframe sample frame is outside the clip')
  }
  const sampled: SampledItemProperties = {
    transform: structuredClone(item.transform),
    crop: structuredClone(item.crop ?? { left: 0, top: 0, right: 0, bottom: 0 }),
    opacity: item.opacity,
    volume: item.volume ?? 1,
    effects: (item.effects ?? []).map((effect) => validateCatalogEffect(effect))
  }
  const values = sampleKeyframedProperties(item.keyframes ?? [], localFrame)
  for (const [property, value] of Object.entries(values)) applySampledProperty(sampled, property, value)
  if (sampled.crop.left + sampled.crop.right >= 1 || sampled.crop.top + sampled.crop.bottom >= 1) {
    invalid('Sampled crop removes the complete frame')
  }
  return sampled
}

export function validateKeyframeProperty(item: TimelineItem, track: KeyframeTrack): void {
  if (COMPOSITION_PROPERTIES.includes(track.property)) {
    track.points.forEach(({ value }) => validateCompositionValue(track.property, value))
    return
  }
  const match = /^effect\.([A-Za-z0-9][A-Za-z0-9._~-]{0,127})\.([A-Za-z0-9][A-Za-z0-9._~-]{0,127})$/u.exec(track.property)
  if (!match) invalid(`Unsupported keyframe property: ${track.property}`)
  const effectValue = item.effects?.find(({ id }) => id === match[1])
  if (!effectValue) invalid(`Keyframe effect does not exist: ${match[1]}`)
  const entry = EFFECTS[effectValue.type]
  const parameter = entry?.parameters[match[2]!]
  if (!entry || parameter?.kind !== 'number' || !parameter.keyframeable) {
    invalid(`Effect parameter is not keyframeable: ${track.property}`)
  }
  track.points.forEach(({ value }) => {
    if (value < parameter.minimum || value > parameter.maximum) {
      invalid(`${track.property} must be between ${parameter.minimum} and ${parameter.maximum}`)
    }
  })
}

function applySampledProperty(target: SampledItemProperties, property: string, value: number): void {
  validateCompositionValue(property, value)
  switch (property) {
    case 'transform.x': target.transform.x = value; return
    case 'transform.y': target.transform.y = value; return
    case 'transform.scaleX': target.transform.scaleX = value; return
    case 'transform.scaleY': target.transform.scaleY = value; return
    case 'transform.rotation': target.transform.rotation = value; return
    case 'crop.left': target.crop.left = value; return
    case 'crop.top': target.crop.top = value; return
    case 'crop.right': target.crop.right = value; return
    case 'crop.bottom': target.crop.bottom = value; return
    case 'opacity': target.opacity = value; return
    case 'volume': target.volume = value; return
  }
  const match = /^effect\.([A-Za-z0-9][A-Za-z0-9._~-]{0,127})\.([A-Za-z0-9][A-Za-z0-9._~-]{0,127})$/u.exec(property)
  const effectValue = match ? target.effects.find(({ id }) => id === match[1]) : undefined
  if (!match || !effectValue) invalid(`Unsupported sampled property: ${property}`)
  const definition = EFFECTS[effectValue.type]?.parameters[match[2]!]
  if (definition?.kind !== 'number') invalid(`Effect parameter is not numeric: ${property}`)
  if (value < definition.minimum || value > definition.maximum) {
    invalid(`${property} must be between ${definition.minimum} and ${definition.maximum}`)
  }
  effectValue.parameters[match[2]!] = value
}

function validateCompositionValue(property: string, value: number): void {
  if (!Number.isFinite(value)) invalid(`${property} must be finite`)
  if (property === 'opacity' && (value < 0 || value > 1)) invalid('opacity must be between 0 and 1')
  if (property === 'volume' && (value < 0 || value > 4)) invalid('volume must be between 0 and 4')
  if ((property === 'transform.scaleX' || property === 'transform.scaleY') && (value < 0.01 || value > 100)) {
    invalid(`${property} must be between 0.01 and 100`)
  }
  if (property.startsWith('crop.') && (value < 0 || value > 1)) invalid(`${property} must be between 0 and 1`)
}

function effect(
  type: string,
  category: EffectCatalogEntry['category'],
  labelKey: string,
  parameters: EffectCatalogEntry['parameters']
): EffectCatalogEntry {
  return { type, category, labelKey, parameters }
}

function numeric(minimum: number, maximum: number, defaultValue: number, step: number): NumericEffectParameter {
  return { kind: 'number', minimum, maximum, defaultValue, step, keyframeable: true }
}

function invalid(message: string): never {
  throw engineError('invalid_operation', message)
}
