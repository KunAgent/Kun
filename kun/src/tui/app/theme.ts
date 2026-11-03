import { RGBA, SyntaxStyle, TextAttributes, type CliRenderer } from '@opentui/core'
import type { ComposerMode } from '../chat-format.js'
import type { TuiThemeName } from '../visual-system.js'

export type ThemeMode = 'dark' | 'light'

/**
 * Truecolor theme in layers: the screen background, panels for the user's
 * messages and the prompt, raised surfaces for the tab strip, sidebar and
 * tool blocks. One accent (Kun teal by default) and one color per mode;
 * status colors only mark glyphs and counts. Dark and light variants follow
 * the terminal's background.
 */
export type KunTheme = {
  name: TuiThemeName
  mode: ThemeMode
  bg: RGBA
  panel: RGBA
  raised: RGBA
  high: RGBA
  band: RGBA
  sel: RGBA
  scrim: RGBA
  edge: RGBA
  text: RGBA
  muted: RGBA
  faint: RGBA
  brand: RGBA
  focus: RGBA
  user: RGBA
  success: RGBA
  warning: RGBA
  danger: RGBA
  accent: RGBA
  info: RGBA
  think: RGBA
  modes: Record<ComposerMode, RGBA>
  diff: { addBg: RGBA; delBg: RGBA; addFg: RGBA; delFg: RGBA }
  goalBg: RGBA
  graphBg: RGBA
  logoShadow: RGBA
  /** Attribute for emphasized tokens when a theme has no hue (mono). */
  emphasis: number
}

const hex = (value: string): RGBA => RGBA.fromHex(value)

type Base = Omit<KunTheme, 'name' | 'mode' | 'focus' | 'user' | 'modes' | 'emphasis'>

const DARK: Base = {
  bg: hex('#0a0a0b'),
  panel: hex('#17181b'),
  raised: hex('#121315'),
  high: hex('#25272b'),
  band: hex('#101113'),
  sel: hex('#183a3f'),
  scrim: RGBA.fromInts(0, 0, 0, 153),
  edge: hex('#2a2c30'),
  text: hex('#eeeeee'),
  muted: hex('#a9adb4'),
  faint: hex('#767a82'),
  brand: hex('#5ec4cf'),
  success: hex('#9ee77a'),
  warning: hex('#f5a742'),
  danger: hex('#ef6c6c'),
  accent: hex('#a383e2'),
  info: hex('#7699fe'),
  think: hex('#b98a4b'),
  diff: { addBg: hex('#16282b'), delBg: hex('#2c1c22'), addFg: hex('#4fd6be'), delFg: hex('#e26a75') },
  goalBg: hex('#142014'),
  graphBg: hex('#2a1f12'),
  logoShadow: hex('#1f383c')
}

const LIGHT: Base = {
  bg: hex('#ffffff'),
  panel: hex('#f1f1f0'),
  raised: hex('#f6f6f5'),
  high: hex('#e2e2e0'),
  band: hex('#e6e6e4'),
  sel: hex('#cfe9eb'),
  scrim: RGBA.fromInts(20, 20, 20, 97),
  edge: hex('#d9d9d7'),
  text: hex('#141414'),
  muted: hex('#4f5257'),
  faint: hex('#6f7378'),
  brand: hex('#0d7f89'),
  success: hex('#3b8a3b'),
  warning: hex('#b5651f'),
  danger: hex('#cc3a3f'),
  accent: hex('#7650b6'),
  info: hex('#3b6fd8'),
  think: hex('#a8763f'),
  diff: { addBg: hex('#e2f4ee'), delBg: hex('#fbe8eb'), addFg: hex('#1e725c'), delFg: hex('#c53b53') },
  goalBg: hex('#e9f5e6'),
  graphBg: hex('#fbf0e4'),
  logoShadow: hex('#c3e0e2')
}

function finish(name: TuiThemeName, mode: ThemeMode, base: Base, emphasis = 0): KunTheme {
  return {
    ...base,
    name,
    mode,
    focus: base.brand,
    user: base.brand,
    modes: { agent: base.brand, plan: base.accent, graph: base.warning, goal: base.success },
    emphasis
  }
}

export function createTheme(name: TuiThemeName, mode: ThemeMode = 'dark'): KunTheme {
  const base = mode === 'light' ? LIGHT : DARK
  switch (name) {
    case 'ocean':
      return finish(name, mode, mode === 'light'
        ? { ...base, brand: hex('#3b6fd8'), sel: hex('#dbe6fb'), logoShadow: hex('#cbd8f5') }
        : { ...base, brand: hex('#7699fe'), sel: hex('#1e2c4a'), logoShadow: hex('#1f2a44') })
    case 'mono':
      return finish(name, mode, {
        ...base,
        brand: base.text,
        success: base.text,
        warning: base.text,
        danger: base.text,
        accent: base.text,
        info: base.text,
        think: base.muted,
        sel: base.high,
        logoShadow: base.high
      }, TextAttributes.BOLD)
    case 'kun':
    default:
      return finish('kun', mode, base)
  }
}

export type ToneName =
  | 'normal' | 'muted' | 'faint' | 'brand' | 'focus' | 'user' | 'success' | 'warning' | 'danger' | 'accent' | 'info' | 'think'

/** Foreground color and attributes for a semantic tone. */
export function tone(theme: KunTheme, name: ToneName): { fg: RGBA; attributes: number } {
  switch (name) {
    case 'normal': return { fg: theme.text, attributes: 0 }
    case 'muted': return { fg: theme.muted, attributes: 0 }
    case 'faint': return { fg: theme.faint, attributes: 0 }
    case 'think': return { fg: theme.think, attributes: 0 }
    default: return { fg: theme[name], attributes: theme.emphasis }
  }
}

/** Color for a context-usage level from `contextRing`. */
export function ringColor(theme: KunTheme, level: 'ok' | 'warn' | 'danger'): RGBA {
  return level === 'danger' ? theme.danger : level === 'warn' ? theme.warning : theme.brand
}

export function markdownSyntaxStyle(theme: KunTheme, renderer: CliRenderer): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    default: { fg: theme.text },
    'markup.heading': { fg: theme.accent, bold: true },
    'markup.strong': { fg: theme.text, bold: true },
    'markup.italic': { italic: true },
    'markup.strikethrough': { fg: theme.faint },
    'markup.raw': { fg: theme.success },
    'markup.raw.block': { fg: theme.text },
    'markup.link': { fg: theme.brand, underline: true },
    'markup.link.label': { fg: theme.brand },
    'markup.link.url': { fg: theme.faint },
    'markup.quote': { fg: theme.warning, italic: true },
    'markup.list': { fg: theme.brand },
    conceal: { fg: theme.faint }
  }, renderer.nativeScene)
}
