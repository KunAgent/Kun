import { RGBA, StyledText, TextAttributes, type TextChunk } from '@opentui/core'

const SGR = new RegExp(String.raw`\u001B\[([0-9;]*)m`, 'gu')

type Style = { fg?: RGBA; bg?: RGBA; attributes: number }

/**
 * Convert SGR-styled text (from `visual.*` formatters and highlight.js
 * output) into opentui chunks. Only SGR is accepted; every other control
 * sequence was already stripped by sanitizeTerminalText.
 */
export function ansiToStyled(value: string, base: Style = { attributes: 0 }): StyledText {
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
    else if (code === 2) style.attributes |= TextAttributes.DIM
    else if (code === 3) style.attributes |= TextAttributes.ITALIC
    else if (code === 4) style.attributes |= TextAttributes.UNDERLINE
    else if (code === 7) style.attributes |= TextAttributes.INVERSE
    else if (code === 9) style.attributes |= TextAttributes.STRIKETHROUGH
    else if (code === 22) style.attributes &= ~(TextAttributes.BOLD | TextAttributes.DIM)
    else if (code === 23) style.attributes &= ~TextAttributes.ITALIC
    else if (code === 24) style.attributes &= ~TextAttributes.UNDERLINE
    else if (code === 27) style.attributes &= ~TextAttributes.INVERSE
    else if (code === 29) style.attributes &= ~TextAttributes.STRIKETHROUGH
    else if (code >= 30 && code <= 37) style.fg = RGBA.fromIndex(code - 30)
    else if (code >= 90 && code <= 97) style.fg = RGBA.fromIndex(code - 90 + 8)
    else if (code === 39) style.fg = base.fg
    else if (code >= 40 && code <= 47) style.bg = RGBA.fromIndex(code - 40)
    else if (code === 49) style.bg = base.bg
    else if ((code === 38 || code === 48) && codes[index + 1] === 5) {
      const color = RGBA.fromIndex(codes[index + 2] ?? 0)
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
