import {
  MODEL_REASONING_EFFORTS,
  type ModelReasoningEffort,
  type ModelProviderModelProfileV1
} from '@shared/app-settings'
import {
  isComposerChatModelId,
  modelProfileSupportsTextChat
} from '@shared/app-settings-provider-core'
import { DEFAULT_COMPOSER_MODEL_IDS } from '@shared/default-composer-models'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'

export type ComposerReasoningEffort = ModelReasoningEffort
export const REASONING_OPTIONS: Array<{ id: ComposerReasoningEffort; labelKey: string }> = [
  { id: 'auto', labelKey: 'composerReasoningAuto' },
  { id: 'off', labelKey: 'composerReasoningOff' },
  { id: 'low', labelKey: 'composerReasoningLow' },
  { id: 'medium', labelKey: 'composerReasoningMedium' },
  { id: 'high', labelKey: 'composerReasoningHigh' },
  { id: 'max', labelKey: 'composerReasoningMax' }
]
export const LEGACY_REASONING_EFFORTS: ComposerReasoningEffort[] = ['off', 'low', 'medium', 'high', 'max']

export type FloatingMenuPlacement = {
  left: number
  top: number
  width: number
  maxHeight: number
}

export type FloatingSubmenuPlacement = {
  left: number
  top: number
  width: number
  maxHeight: number
}

export type FloatingReasoningPopoverPlacement = {
  left: number
  top: number
  width: number
}

export type FloatingMenuAnchorRect = Pick<DOMRect, 'bottom' | 'right' | 'top'>
export type FloatingSubmenuAnchorRect = Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top'>
export type FloatingReasoningPopoverAnchorRect = Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top'>

export type ComposerModelMenuGroup = {
  providerId: string
  presetSource?: string
  label: string
  modelIds: string[]
  modelProfiles?: Record<string, ModelProviderModelProfileV1>
  nativeHarnessId?: string
  modelInfo?: ModelProviderModelGroup['modelInfo']
}

export const FLOATING_MENU_MARGIN = 12
export const FLOATING_MENU_GAP = 7
export const FLOATING_MENU_WIDTH = 208
export const FLOATING_MENU_MIN_WIDTH = 176
export const FLOATING_MENU_MIN_HEIGHT = 112
export const FLOATING_MENU_MAX_HEIGHT = 336
export const FLOATING_SUBMENU_GAP = 6
export const FLOATING_SUBMENU_WIDTH = 232
export const FLOATING_SUBMENU_MIN_HEIGHT = 80
export const FLOATING_SUBMENU_MAX_HEIGHT = 320
export const FLOATING_REASONING_POPOVER_WIDTH = 286
export const FLOATING_REASONING_POPOVER_ESTIMATED_HEIGHT = 110
export const FLOATING_REASONING_POPOVER_GAP = 12
export const REASONING_RAIL_THUMB_RADIUS = 18
export const UNGROUPED_MODEL_PROVIDER_ID = '__composer_models__'
export const REASONING_RAIL_ORDER: ComposerReasoningEffort[] = ['off', 'low', 'medium', 'high', 'max', 'auto']
export const DEFAULT_COMPOSER_MODEL_KEYS = new Set(
  DEFAULT_COMPOSER_MODEL_IDS.map((id) => normalizeModelCapabilityKey(id))
)

export function buildComposerModelMenuGroups({
  composerModelGroups,
  modelOptions,
  ungroupedLabel
}: {
  composerModelGroups: readonly ModelProviderModelGroup[]
  modelOptions: readonly string[]
  ungroupedLabel: string
}): ComposerModelMenuGroup[] {
  const configuredModelKeys = new Set<string>()
  const groups = composerModelGroups
    .map((group) => {
      const seenInProvider = new Set<string>()
      const ids = group.modelIds
        .map((id) => id.trim())
        .filter((id) => {
          const key = normalizeModelCapabilityKey(id)
          if (!key || seenInProvider.has(key)) return false
          if (!composerMenuSupportsModel(group, id)) return false
          markModelSeen(seenInProvider, group, id)
          markModelSeen(configuredModelKeys, group, id)
          return true
        })
      return {
        ...group,
        label: group.label.trim() || group.providerId,
        modelIds: ids,
        modelProfiles: group.modelProfiles
      }
    })
    .filter((group) => group.modelIds.length > 0)

  const ungrouped: string[] = []
  const seenUngrouped = new Set<string>()
  for (const rawId of modelOptions) {
    const id = rawId.trim()
    const key = normalizeModelCapabilityKey(id)
    if (!key || configuredModelKeys.has(key) || seenUngrouped.has(key) || !isComposerChatModelId(id)) continue
    seenUngrouped.add(key)
    ungrouped.push(id)
  }

  if (ungrouped.length > 0) {
    groups.push({
      providerId: UNGROUPED_MODEL_PROVIDER_ID,
      label: ungroupedLabel,
      modelIds: ungrouped,
      modelProfiles: {}
    })
  }
  return groups
}

export function buildComposerModelOptions(composerPickList: readonly string[]): string[] {
  const ordered = new Set<string>()
  for (const id of composerPickList) {
    const normalized = id.trim()
    if (normalized) ordered.add(normalized)
  }
  return [...ordered]
}

export function filterComposerModelIds(
  modelIds: readonly string[],
  query: string,
  modelInfo?: ComposerModelMenuGroup['modelInfo']
): string[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return [...modelIds]
  return modelIds.filter((id) => `${id} ${modelInfo?.[id]?.displayName ?? ''}`.toLowerCase().includes(normalizedQuery))
}

export function shouldShowProviderSetupPrompt(groups: readonly ComposerModelMenuGroup[]): boolean {
  const hasConfiguredProviderModels = groups.some((group) =>
    group.providerId !== UNGROUPED_MODEL_PROVIDER_ID
  )
  if (hasConfiguredProviderModels) return false
  const ungroupedModels = groups.flatMap((group) =>
    group.providerId === UNGROUPED_MODEL_PROVIDER_ID ? group.modelIds : []
  )
  return ungroupedModels.every((id) =>
    DEFAULT_COMPOSER_MODEL_KEYS.has(normalizeModelCapabilityKey(id))
  )
}

export function normalizeComposerReasoningEffort(
  value: string | undefined,
  profile?: Pick<ModelProviderModelProfileV1, 'reasoning'>
): ComposerReasoningEffort {
  const normalized = normalizeComposerReasoningEffortValue(value)
  if (!profile?.reasoning) {
    return normalized && LEGACY_REASONING_EFFORTS.includes(normalized) ? normalized : 'max'
  }
  const supported = profile.reasoning.supportedEfforts
  if (normalized && supported.includes(normalized)) return normalized
  return profile.reasoning.defaultEffort
}

export function normalizeComposerReasoningEffortValue(
  value: string | undefined
): ComposerReasoningEffort | undefined {
  const normalized = value?.trim().toLowerCase()
  return MODEL_REASONING_EFFORTS.includes(normalized as ComposerReasoningEffort)
    ? normalized as ComposerReasoningEffort
    : undefined
}

export function composerReasoningEffortRequestValue(
  value: ComposerReasoningEffort
): string | undefined {
  return value
}

export function composerReasoningEffortHasEnergyMotion(
  effort: ComposerReasoningEffort
): boolean {
  return effort === 'high' || effort === 'max' || effort === 'auto'
}

export function orderComposerReasoningRailEfforts(
  efforts: readonly ComposerReasoningEffort[]
): ComposerReasoningEffort[] {
  const supported = new Set(efforts)
  return REASONING_RAIL_ORDER.filter((effort) => supported.has(effort))
}

export function composerReasoningRailPosition(
  efforts: readonly ComposerReasoningEffort[],
  current: ComposerReasoningEffort
): number {
  if (efforts.length === 0) return 0
  if (efforts.length === 1) return efforts[0] === 'auto' ? 1 : 0
  const index = Math.max(0, efforts.indexOf(current))
  return index / (efforts.length - 1)
}

export function composerReasoningEffortForRailPosition(
  efforts: readonly ComposerReasoningEffort[],
  position: number
): ComposerReasoningEffort | undefined {
  if (efforts.length === 0) return undefined
  const normalized = Math.min(1, Math.max(0, Number.isFinite(position) ? position : 0))
  const index = efforts.length === 1 ? 0 : Math.round(normalized * (efforts.length - 1))
  return efforts[index]
}

export function composerReasoningRailPointerPosition(
  clientX: number,
  railLeft: number,
  railWidth: number
): number {
  const usableWidth = railWidth - REASONING_RAIL_THUMB_RADIUS * 2
  if (!Number.isFinite(clientX) || !Number.isFinite(railLeft) || usableWidth <= 0) return 0
  return Math.min(1, Math.max(
    0,
    (clientX - railLeft - REASONING_RAIL_THUMB_RADIUS) / usableWidth
  ))
}

export function composerReasoningEffortForRailKey(
  efforts: readonly ComposerReasoningEffort[],
  current: ComposerReasoningEffort,
  key: string
): ComposerReasoningEffort | undefined {
  if (efforts.length === 0) return undefined
  const currentIndex = Math.max(0, efforts.indexOf(current))
  const lastIndex = efforts.length - 1
  if (key === 'ArrowLeft') return efforts[Math.max(0, currentIndex - 1)]
  if (key === 'ArrowRight') return efforts[Math.min(lastIndex, currentIndex + 1)]
  if (key === 'Home') return efforts[0]
  if (key === 'End') return efforts[lastIndex]
  return undefined
}

export function composerReasoningRailThumbCenter(position: number): string {
  const normalized = Math.min(1, Math.max(0, Number.isFinite(position) ? position : 0))
  const pixelOffset = REASONING_RAIL_THUMB_RADIUS * (1 - normalized * 2)
  return `calc(${normalized * 100}% + ${pixelOffset}px)`
}

export function calculateFloatingMenuPlacement({
  anchorRect,
  menuHeight,
  viewportHeight,
  viewportWidth,
  preferredWidth = FLOATING_MENU_WIDTH,
  coordinateScale = 1
}: {
  anchorRect: FloatingMenuAnchorRect
  menuHeight: number
  viewportHeight: number
  viewportWidth: number
  preferredWidth?: number
  coordinateScale?: number
}): FloatingMenuPlacement {
  const scale = Number.isFinite(coordinateScale) && coordinateScale > 0 ? coordinateScale : 1
  const normalizedAnchorRect = {
    bottom: anchorRect.bottom / scale,
    right: anchorRect.right / scale,
    top: anchorRect.top / scale
  }
  const normalizedViewportHeight = viewportHeight / scale
  const normalizedViewportWidth = viewportWidth / scale
  const viewportMaxWidth = Math.max(
    FLOATING_MENU_MIN_WIDTH,
    normalizedViewportWidth - FLOATING_MENU_MARGIN * 2
  )
  const width = Math.min(preferredWidth, viewportMaxWidth)
  const left = clamp(
    normalizedAnchorRect.right - width,
    FLOATING_MENU_MARGIN,
    normalizedViewportWidth - FLOATING_MENU_MARGIN - width
  )
  const contentHeight = Math.max(menuHeight, FLOATING_MENU_MIN_HEIGHT)
  const spaceAbove = Math.max(0, normalizedAnchorRect.top - FLOATING_MENU_MARGIN - FLOATING_MENU_GAP)
  const spaceBelow = Math.max(
    0,
    normalizedViewportHeight - normalizedAnchorRect.bottom - FLOATING_MENU_MARGIN - FLOATING_MENU_GAP
  )
  const targetHeight = Math.min(contentHeight, FLOATING_MENU_MAX_HEIGHT)
  const openAbove = spaceAbove >= targetHeight || spaceAbove >= spaceBelow
  const availableHeight = Math.max(openAbove ? spaceAbove : spaceBelow, FLOATING_MENU_MIN_HEIGHT)
  const maxHeight = Math.min(FLOATING_MENU_MAX_HEIGHT, availableHeight)
  const visibleHeight = Math.min(contentHeight, maxHeight)
  const preferredTop = openAbove
    ? normalizedAnchorRect.top - FLOATING_MENU_GAP - visibleHeight
    : normalizedAnchorRect.bottom + FLOATING_MENU_GAP
  const top = clamp(
    preferredTop,
    FLOATING_MENU_MARGIN,
    Math.max(FLOATING_MENU_MARGIN, normalizedViewportHeight - FLOATING_MENU_MARGIN - visibleHeight)
  )

  return { left, top, width, maxHeight }
}

export function calculateFloatingReasoningPopoverPlacement({
  anchorRect,
  popoverHeight,
  viewportHeight,
  viewportWidth,
  coordinateScale = 1
}: {
  anchorRect: FloatingReasoningPopoverAnchorRect
  popoverHeight: number
  viewportHeight: number
  viewportWidth: number
  coordinateScale?: number
}): FloatingReasoningPopoverPlacement {
  const scale = Number.isFinite(coordinateScale) && coordinateScale > 0 ? coordinateScale : 1
  const normalizedAnchorRect = {
    bottom: anchorRect.bottom / scale,
    left: anchorRect.left / scale,
    right: anchorRect.right / scale,
    top: anchorRect.top / scale
  }
  const normalizedViewportHeight = viewportHeight / scale
  const normalizedViewportWidth = viewportWidth / scale
  const width = Math.min(
    FLOATING_REASONING_POPOVER_WIDTH,
    Math.max(FLOATING_MENU_MIN_WIDTH, normalizedViewportWidth - FLOATING_MENU_MARGIN * 2)
  )
  const height = Math.max(0, popoverHeight)
  const spaceAbove = Math.max(
    0,
    normalizedAnchorRect.top - FLOATING_MENU_MARGIN - FLOATING_REASONING_POPOVER_GAP
  )
  const spaceBelow = Math.max(
    0,
    normalizedViewportHeight - normalizedAnchorRect.bottom - FLOATING_MENU_MARGIN - FLOATING_REASONING_POPOVER_GAP
  )
  const openAbove = spaceAbove >= height || spaceAbove >= spaceBelow
  const preferredTop = openAbove
    ? normalizedAnchorRect.top - FLOATING_REASONING_POPOVER_GAP - height
    : normalizedAnchorRect.bottom + FLOATING_REASONING_POPOVER_GAP
  const top = clamp(
    preferredTop,
    FLOATING_MENU_MARGIN,
    Math.max(FLOATING_MENU_MARGIN, normalizedViewportHeight - FLOATING_MENU_MARGIN - height)
  )
  const left = clamp(
    (normalizedAnchorRect.left + normalizedAnchorRect.right - width) / 2,
    FLOATING_MENU_MARGIN,
    normalizedViewportWidth - FLOATING_MENU_MARGIN - width
  )
  return { left, top, width }
}

export function calculateFloatingSubmenuPlacement({
  anchorRect,
  submenuHeight,
  viewportHeight,
  viewportWidth,
  coordinateScale = 1,
  preferredWidth = FLOATING_SUBMENU_WIDTH,
  maximumHeight = FLOATING_SUBMENU_MAX_HEIGHT
}: {
  anchorRect: FloatingSubmenuAnchorRect
  submenuHeight: number
  viewportHeight: number
  viewportWidth: number
  coordinateScale?: number
  preferredWidth?: number
  maximumHeight?: number
}): FloatingSubmenuPlacement {
  const scale = Number.isFinite(coordinateScale) && coordinateScale > 0 ? coordinateScale : 1
  const normalizedAnchorRect = {
    bottom: anchorRect.bottom / scale,
    left: anchorRect.left / scale,
    right: anchorRect.right / scale,
    top: anchorRect.top / scale
  }
  const normalizedViewportHeight = viewportHeight / scale
  const normalizedViewportWidth = viewportWidth / scale
  const viewportMaxWidth = Math.max(
    FLOATING_MENU_MIN_WIDTH,
    normalizedViewportWidth - FLOATING_MENU_MARGIN * 2
  )
  const width = Math.min(preferredWidth, viewportMaxWidth)
  const spaceRight = normalizedViewportWidth - normalizedAnchorRect.right - FLOATING_MENU_MARGIN
  const spaceLeft = normalizedAnchorRect.left - FLOATING_MENU_MARGIN
  const openRight = spaceRight >= width + FLOATING_SUBMENU_GAP || spaceRight >= spaceLeft
  const preferredLeft = openRight
    ? normalizedAnchorRect.right + FLOATING_SUBMENU_GAP
    : normalizedAnchorRect.left - width - FLOATING_SUBMENU_GAP
  const left = clamp(
    preferredLeft,
    FLOATING_MENU_MARGIN,
    normalizedViewportWidth - FLOATING_MENU_MARGIN - width
  )
  const contentHeight = Math.max(submenuHeight, FLOATING_SUBMENU_MIN_HEIGHT)
  const maxHeight = Math.min(
    maximumHeight,
    Math.max(FLOATING_SUBMENU_MIN_HEIGHT, normalizedViewportHeight - FLOATING_MENU_MARGIN * 2)
  )
  const visibleHeight = Math.min(contentHeight, maxHeight)
  const preferredTop = normalizedAnchorRect.top - 8
  const top = clamp(
    preferredTop,
    FLOATING_MENU_MARGIN,
    Math.max(FLOATING_MENU_MARGIN, normalizedViewportHeight - FLOATING_MENU_MARGIN - visibleHeight)
  )

  return { left, top, width, maxHeight }
}

export function currentBodyZoom(): number {
  if (typeof window === 'undefined') return 1
  const zoom = window.getComputedStyle(document.body).zoom
  const parsed = Number.parseFloat(zoom)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

export function reasoningLabelKey(value: ComposerReasoningEffort): string {
  return REASONING_OPTIONS.find((option) => option.id === value)?.labelKey ?? 'composerReasoningMax'
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function fullModelLabel(model: string, autoLabel: string): string {
  const trimmed = model.trim()
  if (!trimmed || trimmed.toLowerCase() === 'auto') return autoLabel
  return trimmed
}

export function estimatedModelSubmenuHeight(modelCount: number): number {
  return 34 + Math.max(1, modelCount) * 36 + 12
}

export function estimatedReasoningSubmenuHeight(optionCount: number): number {
  return 34 + Math.max(1, optionCount) * 36 + 12
}

export function normalizeModelCapabilityKey(modelId: string): string {
  return modelId.trim().toLowerCase()
}

export function modelIdsMatch(a: string, b: string): boolean {
  const left = normalizeModelCapabilityKey(a)
  return Boolean(left) && left === normalizeModelCapabilityKey(b)
}

export function composerModelMenuItemSelected(input: {
  groupProviderId: string
  selectedProviderId: string | null
  currentModel: string
  modelId: string
}): boolean {
  return (
    Boolean(input.selectedProviderId) &&
    input.groupProviderId === input.selectedProviderId &&
    modelIdsMatch(input.currentModel, input.modelId)
  )
}

export function markModelSeen(
  seen: Set<string>,
  group: Pick<ComposerModelMenuGroup, 'modelProfiles'>,
  modelId: string
): void {
  for (const id of [modelId, ...(modelProfileForModel(group, modelId)?.aliases ?? [])]) {
    const key = normalizeModelCapabilityKey(id)
    if (key) seen.add(key)
  }
}

export function modelProfileForModel(
  group: Pick<ComposerModelMenuGroup, 'modelProfiles'> | null | undefined,
  modelId: string
): ModelProviderModelProfileV1 | undefined {
  if (!group) return undefined
  const key = normalizeModelCapabilityKey(modelId)
  if (!key) return undefined
  const profiles = group.modelProfiles ?? {}
  const direct = profiles[key] ?? profiles[modelId.trim()]
  if (direct) return direct
  return Object.values(profiles).find((profile) =>
    profile.aliases?.some((alias) => normalizeModelCapabilityKey(alias) === key)
  )
}

export function modelProfileForSelection(
  groups: readonly ComposerModelMenuGroup[],
  modelId: string,
  providerId?: string | null
): ModelProviderModelProfileV1 | undefined {
  const selectedGroup = providerId
    ? groups.find((group) => group.providerId === providerId)
    : null
  if (selectedGroup && selectedGroup.modelIds.some((id) => modelIdsMatch(id, modelId))) {
    const profile = modelProfileForModel(selectedGroup, modelId)
    if (profile) return profile
  }
  for (const group of groups) {
    if (!group.modelIds.some((id) => modelIdsMatch(id, modelId))) continue
    const profile = modelProfileForModel(group, modelId)
    if (profile) return profile
  }
  for (const group of groups) {
    const profile = modelProfileForModel(group, modelId)
    if (profile) return profile
  }
  return undefined
}

export function reasoningOptionsForModel(
  profile: Pick<ModelProviderModelProfileV1, 'reasoning'> | undefined
): Array<{ id: ComposerReasoningEffort; labelKey: string }> {
  const supported = profile?.reasoning?.supportedEfforts ?? LEGACY_REASONING_EFFORTS
  return supported
    .map((effort) => REASONING_OPTIONS.find((option) => option.id === effort))
    .filter((option): option is { id: ComposerReasoningEffort; labelKey: string } => Boolean(option))
}

export function composerMenuSupportsModel(
  group: Pick<ComposerModelMenuGroup, 'modelProfiles'>,
  modelId: string
): boolean {
  if (!isComposerChatModelId(modelId)) return false
  return modelProfileSupportsTextChat(modelProfileForModel(group, modelId))
}
