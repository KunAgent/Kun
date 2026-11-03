import { RGBA, StyledText, TextAttributes, type TextChunk } from '@opentui/core'
import type { KunTheme } from './theme.js'

const SGR = new RegExp(String.raw`\u001B\[([0-9;]*)m`, 'gu')

type Style = { fg?: RGBA; bg?: RGBA; attributes: number }

let palette: KunTheme | undefined

/**
 * Page formatters still speak the 16 ANSI colors. With a theme set, those
 * indexes and DIM resolve to theme colors so pages match the truecolor UI.
 */
export function setAnsiTheme(theme: KunTheme): void {
  palette = theme
}

function indexColor(index: number): RGBA {
  const theme = palette
  if (!theme) return RGBA.fromIndex(index)
  switch (index % 8) {
    case 0: return index >= 8 ? theme.faint : theme.bg
    case 1: return theme.danger
    case 2: return theme.success
    case 3: return theme.warning
    case 4: return theme.info
    case 5: return theme.accent
    case 6: return theme.brand
    default: return index >= 8 ? theme.text : theme.muted
  }
}

function themedBase(base: Style): Style {
  const theme = palette
  if (!theme) return base
  const dim = (base.attributes & TextAttributes.DIM) !== 0
  return {
    ...base,
    fg: base.fg ?? (dim ? theme.muted : theme.text),
    attributes: base.attributes & ~TextAttributes.DIM
  }
}

/**
 * Convert SGR-styled text (from `visual.*` formatters and highlight.js
 * output) into opentui chunks. Only SGR is accepted; every other control
 * sequence was already stripped by sanitizeTerminalText.
 */
export function ansiToStyled(value: string, requested: Style = { attributes: 0 }): StyledText {
  const base = themedBase(requested)
  const chunks: TextChunk[] = []
  let style: Style = { ...base }
  let last = 0
  const push = (text: string): void => {
    if (!text) return
    chunks.push({
      __isChunk: true,
      text,
      ...(style.fg ? { fg: style.fg } : {}),
      ...(style.bg ? { bg: style.bg } : {}),
      ...(style.attributes ? { attributes: style.attributes } : {})
    })
  }
  for (const match of value.matchAll(SGR)) {
    push(value.slice(last, match.index))
    last = match.index + match[0].length
    style = applySgr(style, match[1] ?? '', base)
  }
  push(value.slice(last))
  return new StyledText(chunks)
}

function applySgr(current: Style, params: string, base: Style): Style {
  const codes = params === '' ? [0] : params.split(';').map((part) => Number(part))
  let style = { ...current }
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index]!
    if (code === 0) style = { ...base }
    else if (code === 1) style.attributes |= TextAttributes.BOLD
    else if (code === 2) {
      if (palette) style.fg = palette.muted
      else style.attributes |= TextAttributes.DIM
    }
    else if (code === 3) style.attributes |= TextAttributes.ITALIC
    else if (code === 4) style.attributes |= TextAttributes.UNDERLINE
    else if (code === 7) style.attributes |= TextAttributes.INVERSE
    else if (code === 9) style.attributes |= TextAttributes.STRIKETHROUGH
    else if (code === 22) {
      style.attributes &= ~(TextAttributes.BOLD | TextAttributes.DIM)
      if (palette) style.fg = base.fg
    }
    else if (code === 23) style.attributes &= ~TextAttributes.ITALIC
    else if (code === 24) style.attributes &= ~TextAttributes.UNDERLINE
    else if (code === 27) style.attributes &= ~TextAttributes.INVERSE
    else if (code === 29) style.attributes &= ~TextAttributes.STRIKETHROUGH
    else if (code >= 30 && code <= 37) style.fg = indexColor(code - 30)
    else if (code >= 90 && code <= 97) style.fg = indexColor(code - 90 + 8)
    else if (code === 39) style.fg = base.fg
    else if (code >= 40 && code <= 47) style.bg = indexColor(code - 40)
    else if (code === 49) style.bg = base.bg
    else if ((code === 38 || code === 48) && codes[index + 1] === 5) {
      const value = codes[index + 2] ?? 0
      const color = value < 16 ? indexColor(value) : RGBA.fromIndex(value)
      if (code === 38) style.fg = color
      else style.bg = color
      index += 2
    } else if ((code === 38 || code === 48) && codes[index + 1] === 2) {
      const color = RGBA.fromInts(codes[index + 2] ?? 0, codes[index + 3] ?? 0, codes[index + 4] ?? 0)
      if (code === 38) style.fg = color
      else style.bg = color
      index += 4
    }
  }
  return style
}
