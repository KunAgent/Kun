import { keyEventType, matchesKey, type TuiKeyEvent, type TuiKeyEventType } from './keys.js'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type TuiKeyAction =
  | 'leader'
  | 'command_list'
  | 'app_exit'
  | 'app_suspend'
  | 'session_new'
  | 'session_list'
  | 'session_timeline'
  | 'session_rename'
  | 'session_interrupt'
  | 'session_compact'
  | 'session_export'
  | 'session_status'
  | 'session_pin'
  | 'session_delete'
  | 'session_undo'
  | 'session_redo'
  | 'session_child_first'
  | 'session_parent'
  | 'session_sibling_next'
  | 'session_sibling_previous'
  | 'messages_copy'
  | 'messages_page_up'
  | 'messages_page_down'
  | 'messages_line_up'
  | 'messages_line_down'
  | 'messages_half_page_up'
  | 'messages_half_page_down'
  | 'messages_first'
  | 'messages_last'
  | 'model_list'
  | 'model_provider_list'
  | 'model_favorite_toggle'
  | 'model_cycle_recent'
  | 'model_cycle_recent_reverse'
  | 'variant_cycle'
  | 'agent_list'
  | 'agent_cycle'
  | 'agent_cycle_reverse'
  | 'thinking_toggle'
  | 'pointer_mode_toggle'
  | 'tool_details_toggle'
  | 'subagent_detach'
  | 'input_editor'
  | 'input_steer'
  | 'input_paste'
  | 'input_newline'
  | 'input_clear'
  | 'sidebar_toggle'
  | 'theme_list'
  | 'session_share'
  | 'session_unshare'
  | 'share'
  | 'plugin_list'
  | 'console_toggle'
  | 'diff_toggle'
  | 'terminal_toggle'
  | 'session_quick_1'
  | 'session_quick_2'
  | 'session_quick_3'
  | 'session_quick_4'
  | 'session_quick_5'
  | 'session_quick_6'
  | 'session_quick_7'
  | 'session_quick_8'
  | 'session_quick_9'

type KeyId = string
type KeyEventType = TuiKeyEventType

export type TuiKeyBinding = {
  keys: readonly KeyId[]
  event: KeyEventType
  preventDefault: boolean
  fallthrough: boolean
}

export type TuiKeymapLoadResult = {
  keymap: TuiKeymap
  warnings: string[]
  path: string
}

type AdvancedKeyBinding = {
  key?: unknown
  event?: unknown
  preventDefault?: unknown
  fallthrough?: unknown
}

type ParsedConfig = {
  leader_timeout?: unknown
  keybinds?: unknown
}

const DEFAULT_BINDINGS: Record<TuiKeyAction, string | readonly string[]> = {
  leader: 'ctrl+x',
  command_list: 'ctrl+p',
  app_exit: ['ctrl+c', 'ctrl+d', '<leader>q'],
  app_suspend: 'ctrl+z',
  session_new: '<leader>n',
  session_list: '<leader>l',
  session_timeline: '<leader>g',
  session_rename: 'ctrl+r',
  session_interrupt: 'escape',
  session_compact: '<leader>c',
  session_export: '<leader>x',
  session_status: '<leader>s',
  session_pin: 'ctrl+f',
  session_delete: 'ctrl+d',
  session_undo: '<leader>u',
  session_redo: '<leader>r',
  session_child_first: '<leader>down',
  session_parent: '<leader>up',
  session_sibling_next: '<leader>right',
  session_sibling_previous: '<leader>left',
  messages_copy: '<leader>y',
  // Home/End stay with the composer's cursor; the conversation uses the
  // modified forms.
  messages_page_up: ['pageup', 'ctrl+alt+b'],
  messages_page_down: ['pagedown', 'ctrl+alt+f'],
  messages_line_up: 'ctrl+alt+y',
  messages_line_down: 'ctrl+alt+e',
  messages_half_page_up: 'ctrl+alt+u',
  messages_half_page_down: 'ctrl+alt+d',
  messages_first: ['ctrl+home', 'alt+home'],
  messages_last: ['ctrl+end', 'ctrl+alt+g'],
  model_list: '<leader>m',
  model_provider_list: 'ctrl+a',
  model_favorite_toggle: 'ctrl+f',
  model_cycle_recent: 'f2',
  model_cycle_recent_reverse: 'shift+f2',
  variant_cycle: 'ctrl+t',
  agent_list: '<leader>a',
  agent_cycle: 'tab',
  agent_cycle_reverse: 'shift+tab',
  thinking_toggle: 'none',
  pointer_mode_toggle: '<leader>p',
  tool_details_toggle: 'ctrl+o',
  subagent_detach: 'ctrl+b',
  input_editor: 'ctrl+g',
  input_steer: 'ctrl+s',
  // Terminal emulators frequently reserve their platform paste shortcut
  // before a TUI can see it. Keep Kimi's Ctrl+V/Windows Alt+V behavior, while
  // accepting the common terminal alternatives whenever they are forwarded.
  input_paste: process.platform === 'darwin'
    ? ['super+v', 'ctrl+v', 'alt+v', 'ctrl+shift+v', '<leader>v']
    : process.platform === 'win32'
      ? ['ctrl+v', 'alt+v', 'ctrl+shift+v', 'super+v', '<leader>v']
      : ['ctrl+v', 'ctrl+shift+v', 'alt+v', 'super+v', '<leader>v'],
  input_newline: ['shift+return', 'ctrl+return', 'alt+return', 'ctrl+j'],
  input_clear: 'ctrl+c',
  sidebar_toggle: '<leader>b',
  theme_list: 'none',
  session_share: 'none',
  session_unshare: 'none',
  share: 'none',
  plugin_list: 'none',
  console_toggle: 'none',
  diff_toggle: 'none',
  terminal_toggle: 'none',
  session_quick_1: '<leader>1',
  session_quick_2: '<leader>2',
  session_quick_3: '<leader>3',
  session_quick_4: '<leader>4',
  session_quick_5: '<leader>5',
  session_quick_6: '<leader>6',
  session_quick_7: '<leader>7',
  session_quick_8: '<leader>8',
  session_quick_9: '<leader>9'
}

const ACTIONS = new Set<TuiKeyAction>(Object.keys(DEFAULT_BINDINGS) as TuiKeyAction[])

const VALID_SYMBOL_KEYS = new Set([
  '`', '-', '=', '[', ']', '\\', ';', "'", ',', '.', '/', '!', '@', '#', '$',
  '%', '^', '&', '*', '(', ')', '_', '+', '|', '~', '{', '}', ':', '<', '>', '?'
])

export class TuiKeymap {
  readonly leaderTimeoutMs: number
  private readonly bindings: ReadonlyMap<TuiKeyAction, readonly TuiKeyBinding[]>

  constructor(bindings: ReadonlyMap<TuiKeyAction, readonly TuiKeyBinding[]>, leaderTimeoutMs: number) {
    this.bindings = bindings
    this.leaderTimeoutMs = leaderTimeoutMs
  }

  matches(action: TuiKeyAction, data: TuiKeyEvent): boolean {
    return Boolean(this.match(action, data))
  }

  match(action: TuiKeyAction, data: TuiKeyEvent): TuiKeyBinding | undefined {
    return (this.bindings.get(action) ?? []).find((binding) =>
      binding.keys.length === 1 && eventMatches(binding.event, data) && matchesKey(data, binding.keys[0]!)
    )
  }

  matchesLeader(data: TuiKeyEvent): boolean {
    return this.matches('leader', data)
  }

  leaderAction(data: TuiKeyEvent): TuiKeyAction | undefined {
    return this.leaderMatch(data)?.action
  }

  leaderMatch(data: TuiKeyEvent): { action: TuiKeyAction; binding: TuiKeyBinding } | undefined {
    for (const [action, bindings] of this.bindings) {
      if (action === 'leader') continue
      const binding = bindings.find((binding) =>
        binding.keys.length === 2 && eventMatches(binding.event, data) && matchesKey(data, binding.keys[1]!)
      )
      if (binding) return { action, binding }
    }
    return undefined
  }

  display(action: TuiKeyAction): string {
    const binding = this.bindings.get(action)?.[0]
    if (!binding) return 'unbound'
    return binding.keys.map(formatKey).join(' ')
  }

  leaderActions(): Array<{ action: TuiKeyAction; key: string }> {
    const actions: Array<{ action: TuiKeyAction; key: string }> = []
    for (const [action, bindings] of this.bindings) {
      const binding = bindings.find((entry) => entry.keys.length === 2)
      if (binding) actions.push({ action, key: formatKey(binding.keys[1]!) })
    }
    return actions
  }
}

export async function loadTuiKeymap(path = join(homedir(), '.kun', 'tui.json')): Promise<TuiKeymapLoadResult> {
  try {
    const raw = await readFile(path, 'utf8')
    return { ...parseTuiKeymapConfig(JSON.parse(raw)), path }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...parseTuiKeymapConfig({}), path }
    }
    const fallback = parseTuiKeymapConfig({})
    return {
      keymap: fallback.keymap,
      warnings: [`Could not load ${path}: ${safeConfigError(error)}. Using default keybindings.`],
      path
    }
  }
}

export function parseTuiKeymapConfig(input: unknown): Omit<TuiKeymapLoadResult, 'path'> {
  const warnings: string[] = []
  const config = isRecord(input) ? input as ParsedConfig : {}
  if (!isRecord(input)) warnings.push('tui.json must contain a JSON object; using defaults.')
  const leaderTimeoutMs = normalizeLeaderTimeout(config.leader_timeout, warnings)
  const requested = isRecord(config.keybinds) ? config.keybinds : {}
  if (config.keybinds !== undefined && !isRecord(config.keybinds)) {
    warnings.push('keybinds must be an object; using defaults.')
  }

  const leaderValue = Object.prototype.hasOwnProperty.call(requested, 'leader')
    ? requested.leader
    : DEFAULT_BINDINGS.leader
  const leaderDisabled = leaderValue === false || leaderValue === 'none'
  const rawLeader = firstEnabledKey(leaderValue) ?? 'ctrl+x'
  const leader = leaderDisabled ? undefined : normalizeKey(rawLeader)
  if (!leaderDisabled && !leader) warnings.push(`Invalid leader key ${String(rawLeader)}; using Ctrl+X.`)
  const resolvedLeader = leaderDisabled ? undefined : leader ?? 'ctrl+x'
  const bindings = new Map<TuiKeyAction, readonly TuiKeyBinding[]>()

  for (const action of ACTIONS) {
    const configured = Object.prototype.hasOwnProperty.call(requested, action)
      ? requested[action]
      : DEFAULT_BINDINGS[action]
    bindings.set(action, action === 'leader' && leaderDisabled
      ? []
      : parseBindings(configured, resolvedLeader, action, warnings))
  }

  for (const name of Object.keys(requested)) {
    if (ACTIONS.has(name as TuiKeyAction)) continue
    warnings.push(`Unknown keybind action ${name} was ignored.`)
  }

  return { keymap: new TuiKeymap(bindings, leaderTimeoutMs), warnings }
}

function parseBindings(
  value: unknown,
  leader: KeyId | undefined,
  action: TuiKeyAction,
  warnings: string[]
): readonly TuiKeyBinding[] {
  if (value === false || value === 'none') return []
  const values = Array.isArray(value) ? value : [value]
  const bindings: TuiKeyBinding[] = []
  for (const entry of values) {
    const advanced = isRecord(entry) ? entry as AdvancedKeyBinding : undefined
    const rawKey = advanced ? advanced.key : entry
    if (rawKey === false || rawKey === 'none') continue
    if (typeof rawKey !== 'string') {
      warnings.push(`Invalid keybind for ${action}; that entry was ignored.`)
      continue
    }
    for (const alternative of rawKey.split(',').map((part) => part.trim()).filter(Boolean)) {
      const isLeaderSequence = alternative.toLowerCase().startsWith('<leader>')
      if (isLeaderSequence && !leader) continue
      const expanded = isLeaderSequence
        ? [leader!, alternative.slice('<leader>'.length).trim()]
        : [alternative]
      const keys = expanded.map(normalizeKey)
      if (keys.some((key) => !key)) {
        warnings.push(`Invalid key ${alternative} for ${action}; that binding was ignored.`)
        continue
      }
      const event = normalizeEvent(advanced?.event, action, warnings)
      bindings.push({
        keys: keys as KeyId[],
        event,
        preventDefault: typeof advanced?.preventDefault === 'boolean' ? advanced.preventDefault : true,
        fallthrough: typeof advanced?.fallthrough === 'boolean' ? advanced.fallthrough : false
      })
    }
  }
  return bindings
}

function normalizeLeaderTimeout(value: unknown, warnings: string[]): number {
  if (value === undefined) return 2_000
  if (typeof value === 'number' && Number.isFinite(value) && value >= 100 && value <= 30_000) {
    return Math.round(value)
  }
  warnings.push('leader_timeout must be between 100 and 30000ms; using 2000ms.')
  return 2_000
}

function normalizeEvent(value: unknown, action: string, warnings: string[]): KeyEventType {
  if (value === undefined || value === 'press') return 'press'
  if (value === 'repeat' || value === 'release') return value
  warnings.push(`Invalid event for ${action}; using press.`)
  return 'press'
}

function eventMatches(event: KeyEventType, data: TuiKeyEvent): boolean {
  return keyEventType(data) === event
}

function firstEnabledKey(value: unknown): string | undefined {
  if (typeof value === 'string' && value !== 'none') return value.split(',')[0]?.trim()
  if (Array.isArray(value)) return value.find((entry): entry is string => typeof entry === 'string' && entry !== 'none')
  if (isRecord(value) && typeof value.key === 'string') return value.key
  return undefined
}

function normalizeKey(input: string): KeyId | undefined {
  const value = input.trim().replace(/^return$/i, 'enter').replace(/\+return$/i, '+enter')
  if (!value || value.includes('<leader>')) return undefined
  const parts = value.toLowerCase().split('+')
  const key = parts.at(-1)
  if (!key || (
    !/^(?:[a-z0-9]|escape|esc|enter|tab|space|backspace|delete|insert|clear|home|end|pageup|pagedown|up|down|left|right|f(?:[1-9]|1[0-2]))$/i.test(key) &&
    !VALID_SYMBOL_KEYS.has(key)
  )) return undefined
  const modifiers = parts.slice(0, -1)
  if (new Set(modifiers).size !== modifiers.length || modifiers.some((part) => !['ctrl', 'shift', 'alt', 'super'].includes(part))) return undefined
  const canonicalKey = key.toLowerCase() === 'pageup' ? 'pageUp' : key.toLowerCase() === 'pagedown' ? 'pageDown' : key.toLowerCase()
  return [...modifiers, canonicalKey].join('+')
}

function formatKey(key: KeyId): string {
  return key.split('+').map((part) => {
    if (part === 'ctrl') return 'Ctrl'
    if (part === 'shift') return 'Shift'
    if (part === 'alt') return 'Alt'
    if (part === 'super') return 'Super'
    if (part === 'escape') return 'Esc'
    if (part === 'pageUp') return 'PgUp'
    if (part === 'pageDown') return 'PgDn'
    return part.length === 1 ? part.toUpperCase() : `${part[0]?.toUpperCase()}${part.slice(1)}`
  }).join('+')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeConfigError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/[\r\n\t]+/g, ' ').slice(0, 240)
}
