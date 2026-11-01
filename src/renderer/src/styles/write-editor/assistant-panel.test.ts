import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'
import { accentForeground, COLOR_PALETTE_PRESETS } from '../../lib/color-palettes'

const css = postcss.parse(readFileSync(resolve('src/renderer/src/styles/write-editor/assistant-panel.css'), 'utf8'))
const theme = postcss.parse(readFileSync(resolve('src/renderer/src/styles/base-shell/tokens-window-workspace.css'), 'utf8'))
const panelSelector = ".write-assistant-panel[data-work-assistant='panel']"

function findRule(root: postcss.Root, predicate: (rule: Rule) => boolean): Rule {
  let result: Rule | undefined
  root.walkRules((rule) => {
    if (!result && predicate(rule)) result = rule
  })
  if (!result) throw new Error('Expected stylesheet rule was not found')
  return result
}

const darkTheme = findRule(theme, (rule) => rule.selector === "[data-theme='dark']")
const panel = findRule(css, (rule) => rule.selector.trim().endsWith(panelSelector))
const definitions = new Map<string, string>()
for (const rule of [darkTheme, panel]) {
  rule.walkDecls((decl) => {
    if (decl.prop.startsWith('--')) definitions.set(decl.prop, decl.value)
  })
}

type Rgb = [number, number, number]

function color(input: string): Rgb {
  const variable = input.match(/^var\((--[\w-]+)(?:,\s*(.+))?\)$/)
  if (variable) {
    const value = definitions.get(variable[1]) ?? variable[2]
    if (!value) throw new Error(`Missing color token ${variable[1]}`)
    return color(value)
  }
  const mix = input.match(/^color-mix\(\s*in srgb,\s*(.+)\s+(\d+)%,\s*(.+)\)$/)
  if (mix) {
    const first = color(mix[1])
    const second = color(mix[3])
    const weight = Number(mix[2]) / 100
    return first.map((value, index) => value * weight + second[index] * (1 - weight)) as Rgb
  }
  if (input === 'black') return [0, 0, 0]
  if (input === 'white') return [255, 255, 255]
  if (/^#[\da-f]{6}$/i.test(input)) {
    return [1, 3, 5].map((index) => parseInt(input.slice(index, index + 2), 16)) as Rgb
  }
  throw new Error(`Unsupported color expression ${input}`)
}

function contrast(foreground: string, background: string): number {
  const luminance = (rgb: Rgb): number => rgb.map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
  const first = luminance(color(`var(${foreground})`))
  const second = luminance(color(`var(${background})`))
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

describe('docked Work assistant dark composer', () => {
  it('limits the redesign to the standard dark document panel', () => {
    const scoped: Rule[] = []
    css.walkRules((rule) => {
      if (rule.selector.includes(panelSelector)) scoped.push(rule)
    })
    expect(scoped.length).toBeGreaterThan(5)
    for (const rule of scoped) {
      for (const selector of rule.selectors) {
        expect(selector).toContain("html[data-theme='dark']")
        expect(selector).toContain(":not([data-ikun-mode='on'])")
        expect(selector).toContain(':not([data-ui-plugin])')
        expect(selector).toContain(":not([data-color-palette='parchment'])")
        expect(selector).toContain(panelSelector)
      }
    }
    const footer = findRule(css, (rule) => rule.selector.includes(panelSelector) && rule.selector.trim().endsWith('.write-assistant-footer'))
    const body = findRule(css, (rule) => rule.selector === '.write-assistant-body')
    expect(footer.toString()).toContain('color-mix(in srgb, var(--ds-bg-main) 88%, transparent)')
    expect(body.toString()).toContain('color-mix(in srgb, var(--ds-bg-main) 88%, transparent)')
    expect(footer.toString()).toContain('border-top: 0')
  })

  it('maintains readable text, controls and focus against the actual default dark tokens', () => {
    for (const text of ['--ds-text', '--ds-text-muted', '--ds-text-faint']) {
      expect(contrast(text, '--work-assistant-input-bg'), text).toBeGreaterThanOrEqual(4.5)
    }
    for (const background of ['--ds-bg-main', '--work-assistant-input-bg']) {
      expect(contrast('--work-assistant-input-border', background), background).toBeGreaterThanOrEqual(3)
      expect(contrast('--ds-focus-ring', background), background).toBeGreaterThanOrEqual(3)
    }
    expect(contrast('--work-assistant-hint', '--ds-bg-main')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('--work-assistant-hint', '--work-assistant-input-bg')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('--ds-accent', '--work-assistant-paper-active-bg')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('--ds-control-foreground', '--ds-accent')).toBeGreaterThanOrEqual(4.5)
  })

  it('preserves contrast across the supported built-in dark palettes', () => {
    const original = new Map(definitions)
    try {
      for (const { id, dark } of COLOR_PALETTE_PRESETS) {
        if (id === 'kun' || id === 'parchment') continue
        definitions.set('--kun-dark-ui-effective-background', dark.bg)
        definitions.set('--text-primary', dark.text)
        definitions.set('--text-secondary', dark.muted)
        definitions.set('--text-tertiary', `color-mix(in srgb, ${dark.muted} 76%, ${dark.bg})`)
        definitions.set('--ds-accent', dark.accent)
        definitions.set('--ds-focus-ring', dark.accent)
        definitions.set('--ds-control-foreground', accentForeground(dark.accent))
        expect(contrast('--work-assistant-hint', '--ds-bg-main'), id).toBeGreaterThanOrEqual(4.5)
        expect(contrast('--work-assistant-hint', '--work-assistant-input-bg'), id).toBeGreaterThanOrEqual(4.5)
        expect(contrast('--work-assistant-input-border', '--ds-bg-main'), id).toBeGreaterThanOrEqual(3)
        expect(contrast('--work-assistant-input-border', '--work-assistant-input-bg'), id).toBeGreaterThanOrEqual(3)
        expect(contrast('--ds-focus-ring', '--work-assistant-input-bg'), id).toBeGreaterThanOrEqual(3)
        expect(contrast('--ds-accent', '--work-assistant-paper-active-bg'), id).toBeGreaterThanOrEqual(4.5)
        expect(contrast('--ds-control-foreground', '--ds-accent'), id).toBeGreaterThanOrEqual(4.5)
      }
    } finally {
      definitions.clear()
      for (const [key, value] of original) definitions.set(key, value)
    }
  })

  it('uses two rows in narrow panels and retains keyboard and reduced-motion affordances', () => {
    const container = css.nodes.find((node) => node.type === 'atrule' && node.name === 'container' && node.params === '(max-width: 320px)')
    expect(container?.toString()).toContain('flex-wrap: wrap')
    expect(container?.toString()).toContain('.ds-composer-toolbar-start')
    expect(container?.toString()).toContain('.ds-composer-toolbar-actions')
    expect(container?.toString()).toContain('flex: 1 1 100%')
    expect(css.toString()).toContain('.ds-composer-shell.ds-chat-composer:focus-within')
    expect(css.toString()).toContain('.work-paper-search-remove:focus-visible')
    expect(css.toString()).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
