import { truncateToWidth, visibleWidth } from './ansi-text.js'
import { sanitizeTerminalText } from './layout.js'

const RESET = '\x1b[0m'
const ansi = (code: number) => (value: string): string => `\x1b[${code}m${value}${RESET}`

export type TuiThemeName = 'kun' | 'ocean' | 'mono'

let activeTheme: TuiThemeName = 'kun'

const palettes: Record<TuiThemeName, Record<'brand' | 'focus' | 'user' | 'success' | 'danger' | 'warning', number | null>> = {
  kun: { brand: 36, focus: 36, user: 33, success: 32, danger: 31, warning: 33 },
  ocean: { brand: 34, focus: 36, user: 35, success: 32, danger: 31, warning: 33 },
  mono: { brand: 1, focus: 4, user: 1, success: 1, danger: 1, warning: 1 }
}

const tone = (name: keyof (typeof palettes)['kun']) => (value: string): string => {
  const code = palettes[activeTheme][name]
  return code === null ? value : ansi(code)(value)
}

export function setVisualTheme(theme: TuiThemeName): void {
  activeTheme = theme
}

export function visualTheme(): TuiThemeName {
  return activeTheme
}

export const visual = {
  strong: ansi(1),
  muted: ansi(2),
  italic: ansi(3),
  underline: ansi(4),
  strikethrough: ansi(9),
  brand: tone('brand'),
  focus: tone('focus'),
  user: tone('user'),
  success: tone('success'),
  danger: tone('danger'),
  warning: tone('warning')
} as const

export type VisualDensity = 'wide' | 'compact' | 'narrow'

export function visualDensity(width: number): VisualDensity {
  if (width >= 96) return 'wide'
  if (width >= 60) return 'compact'
  return 'narrow'
}

export function joinVisualSides(left: string, right: string, width: number): string {
  const safeWidth = Math.max(1, width)
  if (!right) return truncateToWidth(left, safeWidth)
  const rightLimit = Math.max(8, Math.floor(safeWidth * 0.48))
  const clippedRight = truncateToWidth(right, rightLimit)
  const leftLimit = Math.max(1, safeWidth - visibleWidth(clippedRight) - 1)
  const clippedLeft = truncateToWidth(left, leftLimit)
  const gap = ' '.repeat(Math.max(1, safeWidth - visibleWidth(clippedLeft) - visibleWidth(clippedRight)))
  return `${clippedLeft}${gap}${clippedRight}`
}

export function breadcrumb(
  parts: readonly string[],
  width: number,
  right = ''
): string {
  const left = parts
    .filter(Boolean)
    .map((part, index) => index === 0
      ? visual.brand(visual.strong(sanitizeTerminalText(part)))
      : sanitizeTerminalText(part))
    .join(visual.muted(' / '))
  // Route identity wins over secondary status in a narrow terminal.
  const secondary = right && visualDensity(width) !== 'narrow'
    ? ` ${visual.muted(sanitizeTerminalText(right))}`
    : ''
  return joinVisualSides(` ${left}`, secondary, width)
}

export function sectionLabel(label: string, width: number, right = ''): string {
  const safeLabel = sanitizeTerminalText(label)
  const left = safeLabel ? ` ${visual.muted(safeLabel)} ` : ''
  const rightText = right ? ` ${visual.muted(sanitizeTerminalText(right))}` : ''
  const fill = Math.max(0, width - visibleWidth(left) - visibleWidth(rightText))
  return truncateToWidth(`${left}${visual.muted('─'.repeat(fill))}${rightText}`, Math.max(1, width))
}

export function selectionRow(
  left: string,
  right: string,
  width: number,
  selected: boolean,
  indent = 1
): string {
  const rail = selected ? visual.focus('│') : ' '
  const contentWidth = Math.max(1, width - indent - 2)
  const primary = selected ? visual.strong(left) : left
  return truncateToWidth(
    `${' '.repeat(Math.max(0, indent))}${rail} ${joinVisualSides(primary, visual.muted(right), contentWidth)}`,
    Math.max(1, width)
  )
}

export type ContextAction = {
  key: string
  label: string
  tone?: 'normal' | 'danger' | 'warning'
}

export function contextualFooter(actions: readonly ContextAction[], width: number): string {
  const rendered = actions.map((action) => {
    const key = action.tone === 'danger'
      ? visual.danger(visual.strong(action.key))
      : action.tone === 'warning'
        ? visual.warning(visual.strong(action.key))
        : visual.focus(visual.strong(action.key))
    return `${key} ${visual.muted(sanitizeTerminalText(action.label))}`
  }).join(visual.muted('  ·  '))
  return truncateToWidth(` ${rendered}`, Math.max(1, width))
}

export function pageFrame(input: {
  path: readonly string[]
  body: readonly string[]
  footer: readonly ContextAction[]
  width: number
  right?: string
  description?: string
}): string[] {
  const width = Math.max(12, input.width)
  return [
    breadcrumb(input.path, width, input.right),
    sectionLabel('', width),
    ...(input.description
      ? [truncateToWidth(` ${visual.muted(sanitizeTerminalText(input.description))}`, width), '']
      : ['']),
    ...input.body.map((line) => truncateToWidth(line, width)),
    '',
    sectionLabel('', width),
    contextualFooter(input.footer, width)
  ]
}

export function statusGlyph(
  status: 'running' | 'queued' | 'success' | 'failed' | 'warning' | 'idle',
  frame = 0
): string {
  switch (status) {
    case 'running': return visual.focus(['◐', '◓', '◑', '◒'][Math.abs(frame) % 4]!)
    case 'queued': return visual.warning('○')
    case 'success': return visual.success('✓')
    case 'failed': return visual.danger('×')
    case 'warning': return visual.warning('!')
    case 'idle': return visual.muted('·')
  }
}
