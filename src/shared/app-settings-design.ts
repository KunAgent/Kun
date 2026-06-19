import type { DesignSettingsPatchV1, DesignSettingsV1, DesignSystemPreset } from './app-settings-types'

export const DESIGN_SYSTEM_PRESETS: readonly DesignSystemPreset[] = [
  'none',
  'shadcn',
  'radix',
  'material',
  'ios',
  'fluent',
  'ant',
  'chakra',
  'carbon',
  'polaris',
  'bootstrap',
  'geist',
  'brutalism',
  'editorial'
]

const DESIGN_TYPES = ['', 'brand', 'product'] as const
const DESIGN_VIEWPORTS = ['mobile', 'tablet', 'desktop'] as const
const DESIGN_CANVAS_VIEWS = ['preview', 'code'] as const
const DESIGN_BACKGROUNDS = ['light', 'dark'] as const
const DESIGN_RADII = ['', 'sharp', 'soft', 'rounded', 'pill'] as const
const DESIGN_DENSITIES = ['', 'compact', 'cozy', 'spacious'] as const
const DESIGN_FONT_STYLES = ['', 'system', 'geometric', 'humanist', 'serif', 'mono'] as const

const MAX_TONE_CHIPS = 12
const MAX_TONE_LENGTH = 32
const MAX_BRAND_COLOR_LENGTH = 32
const MAX_GUIDELINES_LENGTH = 4000
const MAX_PROMPT_LENGTH = 6000
const MAX_STACK_HINT_LENGTH = 200
const MAX_MODEL_LENGTH = 128
const MAX_EFFORT_LENGTH = 32
const MAX_PATH_LENGTH = 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

function trimmedString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/** Free text: preserve internal formatting, only cap length. */
function cappedString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeTone(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim().slice(0, MAX_TONE_LENGTH)
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
    if (out.length >= MAX_TONE_CHIPS) break
  }
  return out
}

function normalizeDesignSystemPreset(value: unknown): DesignSystemPreset {
  return oneOf(value, DESIGN_SYSTEM_PRESETS, 'none')
}

export function defaultDesignSettings(): DesignSettingsV1 {
  return {
    defaultWorkspaceRoot: '',
    brandColor: '',
    tone: [],
    designSystemPreset: 'none',
    designType: '',
    designGuidelines: '',
    radius: '',
    density: '',
    fontStyle: '',
    model: '',
    providerId: '',
    reasoningEffort: '',
    generationPrompt: '',
    implementStackHint: '',
    injectIntoCode: true,
    publishDesignSystem: true,
    defaultViewport: 'desktop',
    defaultCanvasView: 'preview',
    canvasBackground: 'light',
    liveRefresh: true,
    deviceFrame: true
  }
}

export function normalizeDesignSettings(input: DesignSettingsPatchV1 | undefined): DesignSettingsV1 {
  const source = isRecord(input) ? (input as DesignSettingsPatchV1) : {}
  return {
    defaultWorkspaceRoot: trimmedString(source.defaultWorkspaceRoot, MAX_PATH_LENGTH),
    brandColor: trimmedString(source.brandColor, MAX_BRAND_COLOR_LENGTH),
    tone: normalizeTone(source.tone),
    designSystemPreset: normalizeDesignSystemPreset(source.designSystemPreset),
    designType: oneOf(source.designType, DESIGN_TYPES, ''),
    designGuidelines: cappedString(source.designGuidelines, MAX_GUIDELINES_LENGTH),
    radius: oneOf(source.radius, DESIGN_RADII, ''),
    density: oneOf(source.density, DESIGN_DENSITIES, ''),
    fontStyle: oneOf(source.fontStyle, DESIGN_FONT_STYLES, ''),
    model: trimmedString(source.model, MAX_MODEL_LENGTH),
    providerId: trimmedString(source.providerId, MAX_MODEL_LENGTH),
    reasoningEffort: trimmedString(source.reasoningEffort, MAX_EFFORT_LENGTH),
    generationPrompt: cappedString(source.generationPrompt, MAX_PROMPT_LENGTH),
    implementStackHint: trimmedString(source.implementStackHint, MAX_STACK_HINT_LENGTH),
    injectIntoCode: boolean(source.injectIntoCode, true),
    publishDesignSystem: boolean(source.publishDesignSystem, true),
    defaultViewport: oneOf(source.defaultViewport, DESIGN_VIEWPORTS, 'desktop'),
    defaultCanvasView: oneOf(source.defaultCanvasView, DESIGN_CANVAS_VIEWS, 'preview'),
    canvasBackground: oneOf(source.canvasBackground, DESIGN_BACKGROUNDS, 'light'),
    liveRefresh: boolean(source.liveRefresh, true),
    deviceFrame: boolean(source.deviceFrame, true)
  }
}

export function mergeDesignSettings(
  current: DesignSettingsV1,
  patch: DesignSettingsPatchV1 | undefined
): DesignSettingsV1 {
  if (!patch) return normalizeDesignSettings(current)
  return normalizeDesignSettings({ ...current, ...patch })
}
