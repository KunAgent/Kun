import { StyledText, TextAttributes, type RGBA, type TextChunk } from '@opentui/core'
import { Show, type JSX } from 'solid-js'
import { cellWidth } from '../layout.js'
import { ansiToStyled } from './ansi.js'
import { useApp } from './context.js'
import { tone, type KunTheme, type ToneName } from './theme.js'
import { Txt } from './txt.js'

export type Seg = {
  text: string
  tone?: ToneName
  /** Explicit colors win over the tone (mode colors, panel edges). */
  color?: RGBA
  bg?: RGBA
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
}

export type SegInput = Seg | string | false | null | undefined

/** Build theme-styled text from semantic segments. */
export function styled(theme: KunTheme, segments: readonly SegInput[]): StyledText {
  const chunks: TextChunk[] = []
  for (const segment of segments) {
    if (!segment) continue
    const value = typeof segment === 'string' ? { text: segment } : segment
    if (!value.text) continue
    const base = tone(theme, value.tone ?? 'normal')
    let attributes = base.attributes
    if (value.bold) attributes |= TextAttributes.BOLD
    if (value.italic) attributes |= TextAttributes.ITALIC
    if (value.underline) attributes |= TextAttributes.UNDERLINE
    if (value.strike) attributes |= TextAttributes.STRIKETHROUGH
    const fg = value.color ?? base.fg
    chunks.push({
      __isChunk: true,
      text: value.text,
      ...(fg ? { fg } : {}),
      ...(value.bg ? { bg: value.bg } : {}),
      ...(attributes ? { attributes } : {})
    })
  }
  return new StyledText(chunks)
}

export const seg = {
  muted: (text: string, extra: Partial<Seg> = {}): Seg => ({ text, tone: 'muted', ...extra }),
  faint: (text: string, extra: Partial<Seg> = {}): Seg => ({ text, tone: 'faint', ...extra }),
  think: (text: string, extra: Partial<Seg> = {}): Seg => ({ text, tone: 'think', ...extra }),
  info: (text: string, extra: Partial<Seg> = {}): Seg => ({ text, tone: 'info', ...extra }),
  color: (text: string, color: RGBA, extra: Partial<Seg> = {}): Seg => ({ text, color, ...extra }),
  brand: (text: string, extra: Partial<Seg> = {}): Seg => ({ text, tone: 'brand', ...extra }),
  focus: (text: string, extra: Partial<Seg> = {}): Seg => ({ text, tone: 'focus', ...extra }),
  user: (text: string, extra: Partial<Seg> = {}): Seg => ({ text, tone: 'user', ...extra }),
  success: (text: string, extra: Partial<Seg> = {}): Seg => ({ text, tone: 'success', ...extra }),
  warning: (text: string, extra: Partial<Seg> = {}): Seg => ({ text, tone: 'warning', ...extra }),
  danger: (text: string, extra: Partial<Seg> = {}): Seg => ({ text, tone: 'danger', ...extra }),
  accent: (text: string, extra: Partial<Seg> = {}): Seg => ({ text, tone: 'accent', ...extra }),
  bold: (text: string, extra: Partial<Seg> = {}): Seg => ({ text, bold: true, ...extra })
}

/**
 * Clip segments at the end to `maxWidth` cells with an ellipsis. opentui's
 * native truncation elides the middle, which suits paths and tool rows but
 * not footers, hints and labels.
 */
export function truncateSegments(segments: readonly SegInput[], maxWidth: number): SegInput[] {
  const out: SegInput[] = []
  let used = 0
  const limit = Math.max(1, maxWidth)
  const total = segments.reduce((sum, segment) => sum + (segment ? cellWidth(typeof segment === 'string' ? segment : segment.text) : 0), 0)
  if (total <= limit) return [...segments]
  for (const segment of segments) {
    if (!segment) continue
    const value = typeof segment === 'string' ? { text: segment } : segment
    let text = ''
    for (const char of Array.from(value.text)) {
      const width = cellWidth(char)
      if (used + width > limit - 1) break
      text += char
      used += width
    }
    if (text) out.push({ ...value, text })
    if (used >= limit - 1 || text.length < value.text.length) break
  }
  out.push({ text: '…', tone: 'muted' })
  return out
}

/** Single terminal row, clipped with an ellipsis instead of wrapping. */
export function Line(props: { segments: readonly SegInput[]; onMouseDown?: () => void; maxWidth?: number }): JSX.Element {
  const app = useApp()
  return (
    <Txt
      content={styled(app.theme(), props.maxWidth ? truncateSegments(props.segments, props.maxWidth) : props.segments)}
      wrapMode="none"
      truncate
      selectable
      flexShrink={0}
      {...(props.onMouseDown ? { onMouseDown: props.onMouseDown } : {})}
    />
  )
}

/** Wrapping paragraph with a uniform tone. */
export function Paragraph(props: { text: string; tone?: ToneName; italic?: boolean; indent?: number }): JSX.Element {
  const app = useApp()
  return (
    <box paddingLeft={props.indent ?? 0} flexShrink={0}>
      <Txt content={styled(app.theme(), [{ text: props.text, tone: props.tone ?? 'normal', italic: props.italic ?? false }])} wrapMode="word" />
    </box>
  )
}

/** SGR-styled single line from the line-based report formatters. */
export function AnsiLine(props: { text: string; wrap?: boolean; onMouseDown?: () => void }): JSX.Element {
  return (
    <Txt
      content={ansiToStyled(props.text)}
      wrapMode={props.wrap ? 'word' : 'none'}
      truncate={!props.wrap}
      flexShrink={0}
      {...(props.onMouseDown ? { onMouseDown: props.onMouseDown } : {})}
    />
  )
}

function segmentsWidth(segments: readonly SegInput[]): number {
  return segments.reduce((sum, segment) => sum + (segment ? cellWidth(typeof segment === 'string' ? segment : segment.text) : 0), 0)
}

/**
 * Left content that truncates first (at its end), right content that stays
 * intact. `width` is the row's width in cells; it defaults to the terminal.
 */
export function SplitRow(props: {
  left: readonly SegInput[]
  right?: readonly SegInput[]
  width?: number
  onMouseDown?: () => void
}): JSX.Element {
  const app = useApp()
  const left = (): SegInput[] => {
    const right = props.right?.some(Boolean) ? segmentsWidth(props.right) + 1 : 0
    return truncateSegments(props.left, (props.width ?? app.width()) - right)
  }
  return (
    <box flexDirection="row" width="100%" flexShrink={0} {...(props.onMouseDown ? { onMouseDown: props.onMouseDown } : {})}>
      <box flexGrow={1} flexShrink={1} minWidth={0}>
        <Txt content={styled(app.theme(), left())} wrapMode="none" truncate />
      </box>
      <Show when={props.right && props.right.some(Boolean)}>
        <box flexShrink={0} marginLeft={1}>
          <Txt content={styled(app.theme(), props.right!)} wrapMode="none" />
        </box>
      </Show>
    </box>
  )
}
