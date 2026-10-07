import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve('src/renderer/src/components/paper/PaperWorkspaceSurface.module.css'), 'utf8')
const searchCss = readFileSync(resolve('src/renderer/src/components/paper/discover/PaperSearchLayout.module.css'), 'utf8')
const themeCss = readFileSync(resolve('src/renderer/src/styles/base-shell/tokens-window-workspace.css'), 'utf8')
const themeDark = themeCss.match(/\[data-theme='dark'\] \{([\s\S]*?)\n\}/)![1]
const paperDark = css.match(/:global\(\[data-theme='dark'\]\) \.surface \{([\s\S]*?)\n\}/)![1]
const definitions = new Map(
  [...`${themeDark}\n${paperDark}`.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()])
)

type Rgb = [number, number, number]

/** Resolve the actual authored default tokens, including nested palette mixes. */
function color(input: string): Rgb {
  const variable = input.match(/^var\((--[\w-]+)(?:,\s*(.+))?\)$/)
  if (variable) {
    const value = definitions.get(variable[1]) ?? variable[2]
    if (!value) throw new Error(`Missing color token ${variable[1]}`)
    return color(value)
  }
  const mix = input.match(/^color-mix\(\s*in srgb,\s*(.+)\s+(\d+)%,\s*(.+)\)$/)
  if (mix) {
    const a = color(mix[1])
    const b = color(mix[3])
    const weight = Number(mix[2]) / 100
    return a.map((value, index) => value * weight + b[index] * (1 - weight)) as Rgb
  }
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
  const a = luminance(color(`var(${foreground})`))
  const b = luminance(color(`var(${background})`))
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

describe('shared paper workspace surfaces', () => {
  it('keeps the configured dark palette local and shared across both search modes and the library', () => {
    expect(searchCss).toContain("composes: surface from '../PaperWorkspaceSurface.module.css'")
    expect(searchCss).not.toContain("data-paper-search='agent'")
    expect(css).toContain('var(--bg-app)')
    expect(css).toContain('var(--surface-1)')
    expect(css).not.toMatch(/#[\da-f]{3,6}\b/i)
    expect(css).toContain('.surface button:focus-visible')
    const library = readFileSync(resolve('src/renderer/src/components/paper/PaperLibraryView.tsx'), 'utf8')
    expect(library).toContain('${paperSurface.surface}')
  })

  it('has distinct canvas, rail, and composer elevations', () => {
    const surfaces = ['--paper-surface-canvas', '--paper-surface-rail', '--paper-surface-composer']
      .map((token) => color(`var(${token})`).join(','))
    expect(new Set(surfaces).size).toBe(3)
  })

  it('meets 4.5:1 for normal text and placeholders on all default dark paper surfaces', () => {
    for (const text of ['--ds-text', '--ds-text-muted', '--ds-text-faint']) {
      for (const background of ['--paper-surface-canvas', '--paper-surface-rail', '--paper-surface-composer']) {
        expect(contrast(text, background), `${text} on ${background}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('meets 3:1 for meaningful control borders and keyboard focus', () => {
    for (const border of ['--paper-surface-control-border', '--ds-focus-ring']) {
      for (const background of ['--paper-surface-canvas', '--paper-surface-rail', '--paper-surface-composer']) {
        expect(contrast(border, background), `${border} on ${background}`).toBeGreaterThanOrEqual(3)
      }
    }
    expect(contrast('--ds-text', '--ds-accent-soft')).toBeGreaterThanOrEqual(4.5)
  })
})
