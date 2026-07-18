import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/webview/styles.css', import.meta.url), 'utf8')
const compactCss = atRuleBlock(css, '@media (max-width: 1180px)')
const narrowCss = atRuleBlock(css, '@media (max-width: 540px)')

describe('video editor right-sidebar responsive contract', () => {
  it.each([280, 360, 560, 760])('keeps the %ipx sidebar document bounded and moves overflow into local controls', (width) => {
    expect(ruleDeclarations(css, '.editor-app')).toMatchObject({
      'min-width': '0',
      'overflow-x': 'hidden'
    })
    expect(ruleDeclarations(css, 'body')).toMatchObject({ 'overflow-x': 'hidden' })
    expect(ruleDeclarations(css, '.workbench-pane')).toMatchObject({ 'min-width': '0' })
    expect(ruleDeclarations(css, '.tracks')).toMatchObject({ 'overflow-x': 'auto' })
    expect(ruleDeclarations(css, '.spatial-timeline')).toMatchObject({
      'min-width': '0',
      contain: 'layout paint'
    })
    expect(ruleDeclarations(css, '.timeline-spatial-grid')).toMatchObject({
      'min-width': '0',
      overflow: 'hidden'
    })
    expect(ruleDeclarations(css, '.timeline-spatial-lane')).toMatchObject({
      'min-width': '0',
      overflow: 'hidden',
      'touch-action': 'none'
    })
    expect(ruleDeclarations(css, '.derived-create-grid')).toMatchObject({
      'grid-template-columns': 'repeat(2, minmax(0, 1fr))'
    })
    expect(ruleDeclarations(css, '.derived-create-grid button')).toMatchObject({
      'min-width': '0',
      'overflow-wrap': 'anywhere'
    })
    expect(ruleDeclarations(css, '.derived-list')).toMatchObject({ overflow: 'auto' })
    expect(ruleDeclarations(css, '.panel-header h2')).toMatchObject({
      'min-width': '0',
      'overflow-wrap': 'normal',
      'word-break': 'keep-all'
    })
    expect(ruleDeclarations(css, '.transcript-list')).toMatchObject({
      'min-width': '0',
      'max-height': 'min(52vh, 410px)',
      'overflow-x': 'hidden',
      'overflow-y': 'auto',
      'overscroll-behavior': 'contain'
    })
    expect(ruleDeclarations(css, '.transcript-copy > span')).toMatchObject({
      'min-width': '0',
      'overflow-wrap': 'anywhere'
    })

    // All four supported Host widths resolve through the same compact-sidebar
    // contract. Wide source layouts must never leak their minimum columns into
    // the guest document at these widths.
    expect(width).toBeLessThanOrEqual(1180)
    expect(ruleDeclarations(compactCss, '.workbench')).toMatchObject({
      display: 'grid',
      'grid-template-columns': 'minmax(0, 1fr)'
    })
    expect(ruleDeclarations(compactCss, '.workbench-tabs')).toMatchObject({
      display: 'flex',
      'overflow-x': 'auto'
    })
    expect(ruleDeclarations(compactCss, '.project-actions')).toMatchObject({
      'min-width': '0',
      'overflow-x': 'auto'
    })
    expect(ruleDeclarations(compactCss, '.workbench-pane:not([data-sidebar-active="true"])')).toMatchObject({
      display: 'none'
    })
    expect(ruleDeclarations(compactCss, '.workbench-pane[data-sidebar-active="true"]')).toMatchObject({
      display: 'grid'
    })
    expect(ruleDeclarations(compactCss, '.player-stage')).toMatchObject({
      'min-height': '0',
      'max-height': 'min(52vh, 420px)'
    })

    if (width <= 540) {
      expect(ruleDeclarations(narrowCss, '.new-project-form')).toMatchObject({
        'grid-template-columns': 'repeat(2, minmax(0, 1fr))',
        width: '100%'
      })
      expect(ruleDeclarations(narrowCss, '.project-actions')).toMatchObject({
        display: 'grid',
        'grid-template-columns': 'repeat(3, minmax(0, 1fr))',
        overflow: 'visible'
      })
      expect(ruleDeclarations(narrowCss, '.empty-illustration')).toMatchObject({ display: 'none' })
      expect(ruleDeclarations(narrowCss, '.panel-header')).toMatchObject({
        'align-items': 'flex-start',
        'flex-wrap': 'wrap'
      })
      expect(ruleDeclarations(narrowCss, '.panel-header h2, .panel-actions')).toMatchObject({
        flex: '1 1 100%',
        width: '100%'
      })
      expect(ruleDeclarations(narrowCss, '.panel-actions')).toMatchObject({
        'justify-content': 'flex-start'
      })
      expect(ruleDeclarations(narrowCss, '.project-package-options')).toMatchObject({
        'grid-template-columns': 'minmax(0, 1fr)'
      })
      expect(ruleDeclarations(narrowCss, '.transcript-row')).toMatchObject({
        'grid-template-columns': 'minmax(0, 1fr)'
      })
      expect(ruleDeclarations(narrowCss, '.transcript-segment')).toMatchObject({
        'grid-template-columns': 'minmax(0, 1fr)'
      })
      expect(ruleDeclarations(narrowCss, '.transcript-cut')).toMatchObject({
        width: '100%',
        'max-width': 'none'
      })
    }
  })

  it('does not rely on a full-page horizontal scroller for the timeline', () => {
    expect(ruleDeclarations(css, 'body')['overflow-x']).toBe('hidden')
    expect(ruleDeclarations(css, '.editor-app')['overflow-x']).toBe('hidden')
    expect(ruleDeclarations(css, '.tracks')['overflow-x']).toBe('auto')
    expect(ruleDeclarations(css, '.track-row')['grid-template-columns']).toContain('minmax(')
    expect(ruleDeclarations(css, '.track-row')['grid-template-columns']).not.toContain('480px')
    expect(css).not.toContain('minmax(540px')
    expect(css).not.toContain('minmax(480px')
  })
})

function atRuleBlock(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker)
  if (markerIndex < 0) throw new Error(`Missing CSS at-rule: ${marker}`)
  const open = source.indexOf('{', markerIndex + marker.length)
  if (open < 0) throw new Error(`Missing CSS block for: ${marker}`)
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, index)
    }
  }
  throw new Error(`Unclosed CSS block for: ${marker}`)
}

function ruleDeclarations(source: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^\\}]*)\\}`, 'mu').exec(source)
  if (!match) throw new Error(`Missing CSS rule: ${selector}`)
  return Object.fromEntries(
    match[1]!
      .split(';')
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const colon = declaration.indexOf(':')
        if (colon < 0) throw new Error(`Invalid CSS declaration in ${selector}: ${declaration}`)
        return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()]
      })
  )
}
