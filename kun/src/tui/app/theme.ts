import { RGBA, SyntaxStyle, TextAttributes, type CliRenderer } from '@opentui/core'
import type { TuiThemeName } from '../visual-system.js'

/**
 * Kun deliberately uses the terminal's own 16-color palette (indexed colors)
 * rather than fixed RGB values, so the TUI follows the user's light/dark
 * terminal theme exactly like the previous ANSI renderer did.
 */
export type KunTheme = {
  name: TuiThemeName
  brand?: RGBA
  focus?: RGBA
  user?: RGBA
  success?: RGBA
  warning?: RGBA
  danger?: RGBA
  accent?: RGBA
  /** Attribute applied to emphasized tokens when a theme has no hue (mono). */
  emphasis: number
}

const index = (value: number): RGBA => RGBA.fromIndex(value)

export function createTheme(name: TuiThemeName): KunTheme {
  switch (name) {
    case 'ocean':
      return {
        name,
        brand: index(4),
        focus: index(6),
        user: index(5),
        success: index(2),
        warning: index(3),
        danger: index(1),
        accent: index(5),
        emphasis: 0
      }
    case 'mono':
      return { name, emphasis: TextAttributes.BOLD }
    case 'kun':
    default:
      return {
        name: 'kun',
        brand: index(6),
        focus: index(6),
        user: index(3),
        success: index(2),
        warning: index(3),
        danger: index(1),
        accent: index(5),
        emphasis: 0
      }
  }
}

export type ToneName = 'normal' | 'muted' | 'brand' | 'focus' | 'user' | 'success' | 'warning' | 'danger' | 'accent'

/** Foreground color and attributes for a semantic tone. */
export function tone(theme: KunTheme, name: ToneName): { fg?: RGBA; attributes: number } {
  switch (name) {
    case 'normal': return { attributes: 0 }
    case 'muted': return { attributes: TextAttributes.DIM }
    default: {
      const color = theme[name]
      return color ? { fg: color, attributes: 0 } : { attributes: theme.emphasis }
    }
  }
}

export function markdownSyntaxStyle(theme: KunTheme, renderer: CliRenderer): SyntaxStyle {
  const color = (value?: RGBA) => (value ? { fg: value } : {})
  return SyntaxStyle.fromStyles({
    default: {},
    'markup.heading': { ...color(theme.brand), bold: true },
    'markup.strong': { bold: true },
    'markup.italic': { italic: true },
    'markup.strikethrough': { dim: true },
    'markup.raw': { ...color(theme.warning) },
    'markup.raw.block': { ...color(theme.warning) },
    'markup.link': { ...color(theme.focus), underline: true },
    'markup.link.label': { ...color(theme.focus) },
    'markup.link.url': { dim: true },
    'markup.quote': { dim: true, italic: true },
    'markup.list': { ...color(theme.focus) },
    conceal: { dim: true }
  }, renderer.nativeScene)
}
