import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import type { AgentModelBinding } from '@shared/rooms-api'
import { modelBindingKey } from './agent-client'
import type { DirectModelOption } from './room-direct-model-groups'

export type AgentModelRole = 'main' | 'fast'
/** Why a row cannot be picked, or a limit it still carries when it can. */
export type AgentModelRowNote = 'scope' | 'unavailable' | 'noBackground' | 'privateOnly'

export type AgentModelRow = {
  key: string
  option: DirectModelOption
  label: string
  selected: boolean
  disabled: boolean
  note?: AgentModelRowNote
  /** [start, end) of the query inside `label`, for highlighting. */
  match?: [number, number]
}

export type AgentModelGroup = {
  key: string
  providerId?: string
  presetSource?: string
  label: string
  /** Every model this connection offers, before filtering. */
  total: number
  rows: AgentModelRow[]
  /** Set when the whole group shares one unavailability reason, shown once under its header. */
  reason?: AgentModelRowNote
}

export type AgentModelSections = {
  available: AgentModelGroup[]
  unavailable: AgentModelGroup[]
  /** Pickable rows in visual order, for keyboard navigation. */
  navigable: AgentModelRow[]
}

const UNAVAILABLE_NOTES = new Set<AgentModelRowNote>(['scope', 'unavailable'])

/** A row that cannot run this role at all, as opposed to one that only carries a limit. */
export function agentModelNoteBlocks(note: AgentModelRowNote | undefined): boolean {
  return note !== undefined && note !== 'privateOnly'
}

export function agentModelRowNote(option: DirectModelOption, role: AgentModelRole): AgentModelRowNote | undefined {
  if (!option.available || !option.providerId) {
    return 'reason' in option && option.reason === 'agent_scope_unsupported' ? 'scope' : 'unavailable'
  }
  if (role === 'fast' && !option.fastAvailable) return 'noBackground'
  if (role === 'main' && !option.groupAvailable) return 'privateOnly'
  return undefined
}

function codeGroupFor(option: DirectModelOption, codeGroups: readonly ModelProviderModelGroup[]) {
  return option.providerId ? codeGroups.find((group) => group.providerId === option.providerId) : undefined
}

/** The option a binding points at; a binding without an account matches the provider's model. */
export function findAgentModelOption(options: readonly DirectModelOption[], binding: AgentModelBinding | null | undefined) {
  if (!binding) return undefined
  const key = modelBindingKey(binding)
  return options.find((option) => modelBindingKey(option) === key) ?? (binding.accountId ? undefined
    : options.find((option) => option.providerId === binding.providerId && option.model === binding.model))
}

/** Model name as Code shows it, falling back to the runtime's model id. */
export function agentModelLabel(option: Pick<DirectModelOption, 'model' | 'providerId'>, codeGroups: readonly ModelProviderModelGroup[]): string {
  const code = option.providerId ? codeGroups.find((group) => group.providerId === option.providerId) : undefined
  return code?.modelInfo?.[option.model]?.displayName?.trim() || option.model
}

/** Provider name as Code shows it; the account is added only when one provider has several. */
export function agentProviderLabel(binding: Pick<AgentModelBinding, 'providerId' | 'accountId'> | undefined,
  options: readonly DirectModelOption[], codeGroups: readonly ModelProviderModelGroup[]): string {
  if (!binding) return ''
  const option = options.find((item) => item.providerId === binding.providerId)
  const code = binding.providerId ? codeGroups.find((group) => group.providerId === binding.providerId) : undefined
  const base = code?.label || option?.providerLabel || binding.providerId || ''
  const accounts = new Set(options.filter((item) => item.providerId === binding.providerId).map((item) => item.accountId ?? ''))
  return accounts.size > 1 && binding.accountId ? `${base} · ${binding.accountId}` : base
}

function matchRange(label: string, query: string): [number, number] | undefined {
  if (!query) return undefined
  const start = label.toLowerCase().indexOf(query)
  return start < 0 ? undefined : [start, start + query.length]
}

/**
 * The picker's list: groups by provider and account in runtime order, with
 * connections that cannot run this Agent moved to the bottom. The query
 * matches the model, its provider or its account.
 */
export function agentModelSections({ options, codeGroups, selected, role, query = '' }: {
  options: readonly DirectModelOption[]
  codeGroups: readonly ModelProviderModelGroup[]
  selected: AgentModelBinding | null | undefined
  role: AgentModelRole
  query?: string
}): AgentModelSections {
  const needle = query.trim().toLowerCase()
  const selectedKey = modelBindingKey(selected)
  const groups = new Map<string, AgentModelGroup>()
  for (const option of options) {
    const groupKey = JSON.stringify([option.providerId ?? option.providerLabel, option.accountId ?? ''])
    const code = codeGroupFor(option, codeGroups)
    const label = agentProviderLabel(option, options, codeGroups) || option.providerLabel
    const group = groups.get(groupKey) ?? { key: groupKey, providerId: option.providerId, presetSource: code?.presetSource,
      label, total: 0, rows: [] }
    group.total += 1
    groups.set(groupKey, group)
    const rowLabel = agentModelLabel(option, codeGroups)
    const haystack = [rowLabel, option.model, group.label, option.providerId ?? '', option.accountId ?? ''].join(' ').toLowerCase()
    if (needle && !haystack.includes(needle)) continue
    const note = agentModelRowNote(option, role)
    const key = modelBindingKey(option)
    group.rows.push({ key, option, label: rowLabel, selected: Boolean(selectedKey) && key === selectedKey,
      disabled: agentModelNoteBlocks(note), note, match: matchRange(rowLabel, needle) })
  }
  const available: AgentModelGroup[] = []
  const unavailable: AgentModelGroup[] = []
  for (const group of groups.values()) {
    if (!group.rows.length) continue
    const notes = new Set(group.rows.map((row) => row.note))
    const blocked = group.rows.every((row) => row.note !== undefined && UNAVAILABLE_NOTES.has(row.note))
    if (blocked) {
      const reason = notes.size === 1 ? group.rows[0]!.note : undefined
      unavailable.push(reason ? { ...group, reason, rows: group.rows.map((row) => ({ ...row, note: undefined })) } : group)
    } else available.push(group)
  }
  const navigable = available.flatMap((group) => group.rows.filter((row) => !row.disabled))
  return { available, unavailable, navigable }
}

export const AGENT_MODEL_POPOVER_MIN_WIDTH = 300
export const AGENT_MODEL_POPOVER_MAX_HEIGHT = 520
const POPOVER_MIN_HEIGHT = 180
const POPOVER_MARGIN = 12
const POPOVER_GAP = 6

export type AgentModelPopoverPlacement = { left: number; top: number; width: number; maxHeight: number; above: boolean }

/**
 * Opens under the trigger at its width and flips above only when the space
 * below cannot hold the list. Rects come in zoomed viewport pixels; the
 * result is in layout pixels for a fixed element under the zoomed body.
 */
export function agentModelPopoverPlacement({ anchor, contentHeight, viewportWidth, viewportHeight, scale = 1 }: {
  anchor: Pick<DOMRect, 'left' | 'top' | 'bottom' | 'width'>
  contentHeight: number
  viewportWidth: number
  viewportHeight: number
  scale?: number
}): AgentModelPopoverPlacement {
  const zoom = Number.isFinite(scale) && scale > 0 ? scale : 1
  const left0 = anchor.left / zoom, top0 = anchor.top / zoom, bottom0 = anchor.bottom / zoom
  const vw = viewportWidth / zoom, vh = viewportHeight / zoom
  const width = Math.max(0, Math.min(Math.max(anchor.width / zoom, AGENT_MODEL_POPOVER_MIN_WIDTH), vw - POPOVER_MARGIN * 2))
  const left = Math.min(Math.max(left0, POPOVER_MARGIN), Math.max(POPOVER_MARGIN, vw - POPOVER_MARGIN - width))
  const below = Math.max(0, vh - bottom0 - POPOVER_MARGIN - POPOVER_GAP)
  const above = Math.max(0, top0 - POPOVER_MARGIN - POPOVER_GAP)
  const wanted = Math.min(Math.max(contentHeight, POPOVER_MIN_HEIGHT), AGENT_MODEL_POPOVER_MAX_HEIGHT)
  const openAbove = below < wanted && above > below
  const maxHeight = Math.min(AGENT_MODEL_POPOVER_MAX_HEIGHT, Math.max(openAbove ? above : below, POPOVER_MIN_HEIGHT))
  const visible = Math.min(Math.max(contentHeight, 0) || maxHeight, maxHeight)
  const top = openAbove ? Math.max(POPOVER_MARGIN, top0 - POPOVER_GAP - visible) : bottom0 + POPOVER_GAP
  return { left, top, width, maxHeight, above: openAbove }
}
