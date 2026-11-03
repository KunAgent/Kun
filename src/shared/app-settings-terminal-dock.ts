import type {
  TerminalAgentProfileV1,
  TerminalAppearanceSettingsV1,
  TerminalBehaviorSettingsV1,
  TerminalCursorStyle,
  TerminalProfileEnvEntryV1,
  TerminalSettingsPatchV1,
  TerminalStartDirectory
} from './app-settings-types-terminal'

export const TERMINAL_FONT_SIZE_RANGE = { min: 9, max: 24 } as const
export const TERMINAL_LINE_HEIGHT_RANGE = { min: 1, max: 2 } as const
export const TERMINAL_SCROLLBACK_RANGE = { min: 500, max: 100_000 } as const
export const TERMINAL_MAX_PROFILES = 24
export const TERMINAL_MAX_PROFILE_ENV = 16
export const TERMINAL_MAX_AGENT_IDS = 64
export const TERMINAL_CURSOR_STYLES: readonly TerminalCursorStyle[] = ['block', 'bar', 'underline']
export const TERMINAL_START_DIRECTORIES: readonly TerminalStartDirectory[] = ['workspace', 'home']

/** Placeholders replaced by the task typed in the launcher. */
export const TERMINAL_TASK_PLACEHOLDERS = ['{任务}', '{task}'] as const

const PROFILE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
// A font-family list may hold quotes and commas but never CSS declaration syntax.
const FONT_FAMILY_UNSAFE_RE = /[;{}<>\\]/

export function defaultTerminalAppearance(): TerminalAppearanceSettingsV1 {
  return { fontFamily: '', fontSize: 13, lineHeight: 1.45, cursorStyle: 'block', cursorBlink: true }
}

export function defaultTerminalBehavior(): TerminalBehaviorSettingsV1 {
  return {
    shell: '',
    startDirectory: 'workspace',
    scrollback: 10_000,
    shellIntegration: true,
    restoreSessions: true,
    showKunProcesses: true,
    statusAlerts: true,
    confirmClose: true,
    copyOnSelect: false,
    macOptionIsMeta: false
  }
}

function clampNumber(value: unknown, fallback: number, range: { min: number; max: number }, step = 1): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const stepped = Math.round(value / step) * step
  return Math.min(range.max, Math.max(range.min, Number(stepped.toFixed(4))))
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? value as T : fallback
}

function isAbsolutePathString(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)
}

export function normalizeTerminalAppearance(
  input: Partial<TerminalAppearanceSettingsV1> | undefined
): TerminalAppearanceSettingsV1 {
  const defaults = defaultTerminalAppearance()
  const fontFamily = typeof input?.fontFamily === 'string' ? input.fontFamily.trim().slice(0, 200) : ''
  return {
    fontFamily: FONT_FAMILY_UNSAFE_RE.test(fontFamily) ? '' : fontFamily,
    fontSize: clampNumber(input?.fontSize, defaults.fontSize, TERMINAL_FONT_SIZE_RANGE),
    lineHeight: clampNumber(input?.lineHeight, defaults.lineHeight, TERMINAL_LINE_HEIGHT_RANGE, 0.05),
    cursorStyle: oneOf(input?.cursorStyle, TERMINAL_CURSOR_STYLES, defaults.cursorStyle),
    cursorBlink: boolean(input?.cursorBlink, defaults.cursorBlink)
  }
}

export function normalizeTerminalBehavior(
  input: Partial<TerminalBehaviorSettingsV1> | undefined
): TerminalBehaviorSettingsV1 {
  const defaults = defaultTerminalBehavior()
  const shell = typeof input?.shell === 'string' ? input.shell.trim().slice(0, 1_024) : ''
  return {
    shell: shell && isAbsolutePathString(shell) ? shell : '',
    startDirectory: oneOf(input?.startDirectory, TERMINAL_START_DIRECTORIES, defaults.startDirectory),
    scrollback: clampNumber(input?.scrollback, defaults.scrollback, TERMINAL_SCROLLBACK_RANGE, 100),
    shellIntegration: boolean(input?.shellIntegration, defaults.shellIntegration),
    restoreSessions: boolean(input?.restoreSessions, defaults.restoreSessions),
    showKunProcesses: boolean(input?.showKunProcesses, defaults.showKunProcesses),
    statusAlerts: boolean(input?.statusAlerts, defaults.statusAlerts),
    confirmClose: boolean(input?.confirmClose, defaults.confirmClose),
    copyOnSelect: boolean(input?.copyOnSelect, defaults.copyOnSelect),
    macOptionIsMeta: boolean(input?.macOptionIsMeta, defaults.macOptionIsMeta)
  }
}

function normalizeEnv(value: unknown): TerminalProfileEnvEntryV1[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const env: TerminalProfileEnvEntryV1[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const key = typeof entry.key === 'string' ? entry.key.trim() : ''
    const raw = typeof entry.value === 'string' ? entry.value : ''
    if (!ENV_KEY_RE.test(key) || seen.has(key) || raw.includes('\0')) continue
    seen.add(key)
    env.push({ key, value: raw.slice(0, 4_096) })
    if (env.length >= TERMINAL_MAX_PROFILE_ENV) break
  }
  return env
}

export function normalizeTerminalProfile(value: unknown): TerminalAgentProfileV1 | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Partial<TerminalAgentProfileV1>
  const id = typeof input.id === 'string' ? input.id.trim() : ''
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : ''
  const command = typeof input.command === 'string' ? input.command.trim().slice(0, 1_024) : ''
  if (!PROFILE_ID_RE.test(id) || !name || !command || command.includes('\n')) return null
  const args = typeof input.args === 'string' ? input.args.replace(/[\r\n]+/g, ' ').trim().slice(0, 4_096) : ''
  const icon = typeof input.icon === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(input.icon) ? input.icon : 'terminal'
  const cwd = typeof input.cwd === 'string' ? input.cwd.trim().slice(0, 4_096) : ''
  return { id, name, command, args, icon, cwd: cwd && isAbsolutePathString(cwd) ? cwd : '', env: normalizeEnv(input.env) }
}

export function normalizeTerminalProfiles(value: unknown): TerminalAgentProfileV1[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const profiles: TerminalAgentProfileV1[] = []
  for (const entry of value) {
    const profile = normalizeTerminalProfile(entry)
    if (!profile || seen.has(profile.id)) continue
    seen.add(profile.id)
    profiles.push(profile)
    if (profiles.length >= TERMINAL_MAX_PROFILES) break
  }
  return profiles
}

export function normalizeTerminalAgentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const id = entry.trim()
    if (!id || id.length > 128 || ids.includes(id)) continue
    ids.push(id)
    if (ids.length >= TERMINAL_MAX_AGENT_IDS) break
  }
  return ids
}

export function normalizeTerminalDockSettings(input: TerminalSettingsPatchV1 | undefined) {
  return {
    appearance: normalizeTerminalAppearance(input?.appearance),
    behavior: normalizeTerminalBehavior(input?.behavior),
    profiles: normalizeTerminalProfiles(input?.profiles),
    hiddenAgentIds: normalizeTerminalAgentIds(input?.hiddenAgentIds),
    agentOrder: normalizeTerminalAgentIds(input?.agentOrder)
  }
}

/**
 * Split an argument string the way a POSIX shell would for plain words,
 * single quotes, double quotes and backslash escapes. No expansion happens.
 */
export function splitProfileArgs(value: string): string[] {
  const args: string[] = []
  let current = ''
  let started = false
  let quote: '"' | "'" | null = null
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!
    if (quote === "'") {
      if (char === "'") quote = null
      else current += char
      continue
    }
    if (quote === '"') {
      if (char === '"') quote = null
      else if (char === '\\' && index + 1 < value.length && '"\\$`'.includes(value[index + 1]!)) current += value[++index]
      else current += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      started = true
    } else if (char === '\\' && index + 1 < value.length) {
      current += value[++index]
      started = true
    } else if (/\s/.test(char)) {
      if (started) args.push(current)
      current = ''
      started = false
    } else {
      current += char
      started = true
    }
  }
  if (started) args.push(current)
  return args
}

function containsPlaceholder(value: string): boolean {
  return TERMINAL_TASK_PLACEHOLDERS.some((placeholder) => value.includes(placeholder))
}

function isPlaceholderOnly(arg: string): boolean {
  if ((TERMINAL_TASK_PLACEHOLDERS as readonly string[]).includes(arg)) return true
  const separator = arg.indexOf('=')
  return separator > 0 && (TERMINAL_TASK_PLACEHOLDERS as readonly string[]).includes(arg.slice(separator + 1))
}

function replacePlaceholders(value: string, task: string): string {
  return TERMINAL_TASK_PLACEHOLDERS.reduce((text, placeholder) => text.split(placeholder).join(task), value)
}

export function profileTakesTask(profile: Pick<TerminalAgentProfileV1, 'command' | 'args'>): boolean {
  return containsPlaceholder(profile.command) || containsPlaceholder(profile.args)
}

/** argv for a profile launch; placeholder-only args vanish when the task is blank. */
export function resolveProfileArgv(profile: Pick<TerminalAgentProfileV1, 'command' | 'args'>, task: string): string[] {
  const trimmed = task.trim()
  const args = splitProfileArgs(profile.args).flatMap((arg) =>
    !trimmed && isPlaceholderOnly(arg) ? [] : [replacePlaceholders(arg, trimmed)])
  return [replacePlaceholders(profile.command, trimmed), ...args]
}

/** Quote one word for POSIX shells; plain words stay readable. */
export function quoteShellWord(value: string): string {
  if (value === '') return "''"
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** The command line written into the shell for a profile launch. */
export function profileCommandLine(
  profile: Pick<TerminalAgentProfileV1, 'command' | 'args' | 'env'>,
  task: string
): string {
  const env = profile.env.map((entry) => `${entry.key}=${quoteShellWord(entry.value)}`)
  return [...env, ...resolveProfileArgv(profile, task).map(quoteShellWord)].join(' ')
}
