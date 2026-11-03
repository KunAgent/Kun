// Personal assistant presets: logos and how to frame them. Adding a product is one entry here
// (plus its install notes in @kun/assistant-agent); anything else is a custom assistant.
import type { AssistantPresetKind } from '@shared/assistant-mailbox'
import cueLogo from '../../../../asset/img/assistants/cue.png'
import grokLogo from '../../../../asset/img/assistants/grok_bot.png'
import museLogo from '../../../../asset/img/assistants/muse.svg?url'
import dotsLogo from '../../../../asset/img/assistants/dots.png'
import harkLogo from '../../../../asset/img/assistants/hark.png'
import todayLogo from '../../../../asset/img/assistants/today.png'

export type AssistantPreset = {
  kind: AssistantPresetKind
  name: string
  maker: string
  logo: string
  /** `cover`: a full-bleed app icon cropped round; `glyph`: a transparent mark on a white disc. */
  frame: 'cover' | 'glyph'
  /** Glyph size relative to the disc. */
  scale: number
  /** i18n key of the one-line setup hint shown in the picker. */
  noteKey: string
}

export const ASSISTANT_PRESETS: readonly AssistantPreset[] = [
  { kind: 'cue', name: 'Cue', maker: 'Manus', logo: cueLogo, frame: 'glyph', scale: 0.74, noteKey: 'assistantPresetNoteCue' },
  { kind: 'grok_bot', name: 'Grok Bot', maker: 'xAI', logo: grokLogo, frame: 'cover', scale: 1, noteKey: 'assistantPresetNoteGrokBot' },
  { kind: 'muse', name: 'Muse', maker: 'Meta', logo: museLogo, frame: 'glyph', scale: 0.78, noteKey: 'assistantPresetNoteMuse' },
  { kind: 'dots', name: 'dots', maker: 'OpenAI', logo: dotsLogo, frame: 'glyph', scale: 0.86, noteKey: 'assistantPresetNoteDots' },
  { kind: 'hark', name: 'Hark', maker: 'Hark', logo: harkLogo, frame: 'glyph', scale: 0.6, noteKey: 'assistantPresetNoteHark' },
  { kind: 'today', name: 'Today', maker: 'Today AI', logo: todayLogo, frame: 'cover', scale: 1, noteKey: 'assistantPresetNoteToday' }
]

export function assistantPreset(kind: string): AssistantPreset | undefined {
  return ASSISTANT_PRESETS.find((preset) => preset.kind === kind)
}

/** Product label for a kind: the preset's name, a custom product name, or nothing. */
export function assistantProductLabel(kind: string, product?: string): string {
  return product?.trim() || assistantPreset(kind)?.name || ''
}

const TINTS = [
  ['#dff3ee', '#0b6b5f'], ['#e7eefb', '#2c4f8f'], ['#eee7fc', '#5b34b8'],
  ['#fbefd6', '#7a4e00'], ['#fde4e4', '#9b2c2c'], ['#e4f1fb', '#1f5f8b']
] as const

/** A stable colour pair and initial for assistants without a logo. */
export function assistantMonogram(name: string): { initial: string; background: string; ink: string } {
  const text = name.replace(/^(我的|my)\s*/i, '').trim() || name
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  const [background, ink] = TINTS[hash % TINTS.length]
  return { initial: [...text][0]?.toUpperCase() ?? '?', background, ink }
}
