import { describe, expect, it } from 'vitest'
import {
  DESIGN_PAGES_MAX,
  buildDesignPlanPrompt,
  buildHtmlSiblingManifest,
  extractAgentDesignSummary,
  parsePagesPlan
} from './design-pages'
import type { DesignArtifact } from './design-types'

describe('extractAgentDesignSummary', () => {
  it('returns the closing prose paragraph, dropping code fences', () => {
    const reply = [
      'Here is the dashboard.',
      '',
      '```html',
      '<div>...</div>',
      '```',
      '',
      'A dark analytics dashboard with a teal accent, KPI cards and a sortable table.'
    ].join('\n')
    expect(extractAgentDesignSummary(reply)).toBe(
      'A dark analytics dashboard with a teal accent, KPI cards and a sortable table.'
    )
  })

  it('returns empty for blank or code-only replies', () => {
    expect(extractAgentDesignSummary('')).toBe('')
    expect(extractAgentDesignSummary('   ')).toBe('')
    expect(extractAgentDesignSummary('```html\n<div/>\n```')).toBe('')
  })

  it('caps an over-long summary', () => {
    const long = 'x'.repeat(400)
    const out = extractAgentDesignSummary(long)
    expect(out.length).toBeLessThanOrEqual(280)
    expect(out.endsWith('…')).toBe(true)
  })
})

function htmlArtifact(over: Partial<DesignArtifact> & { id: string }): DesignArtifact {
  return {
    kind: 'html',
    title: over.title ?? over.id,
    relativePath: over.relativePath ?? `.kun-design/${over.id}/v1.html`,
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
    versions: over.versions ?? [
      { id: `${over.id}-v1`, relativePath: `.kun-design/${over.id}/v1.html`, createdAt: '2026-06-22T00:00:00.000Z', summary: '' }
    ],
    ...over
  }
}

describe('buildHtmlSiblingManifest', () => {
  it('excludes the active artifact and surfaces summary + node dims', () => {
    const artifacts = [
      htmlArtifact({
        id: 'a',
        title: 'Home',
        node: { x: 0, y: 0, width: 420, height: 340 },
        versions: [{ id: 'a-v1', relativePath: '.kun-design/a/v1.html', createdAt: 'x', summary: 'Landing page' }]
      }),
      htmlArtifact({ id: 'b', title: 'Settings' })
    ]
    const manifest = buildHtmlSiblingManifest(artifacts, 'b')
    expect(manifest).toHaveLength(1)
    expect(manifest[0]).toMatchObject({
      name: 'Home',
      htmlPath: '.kun-design/a/v1.html',
      width: 420,
      height: 340,
      summary: 'Landing page'
    })
  })

  it('skips non-html artifacts and respects the limit', () => {
    const artifacts = [
      htmlArtifact({ id: 'a' }),
      { ...htmlArtifact({ id: 'c' }), kind: 'canvas' } as DesignArtifact,
      htmlArtifact({ id: 'd' }),
      htmlArtifact({ id: 'e' })
    ]
    expect(buildHtmlSiblingManifest(artifacts, null, 2)).toHaveLength(2)
    expect(buildHtmlSiblingManifest(artifacts, null).every((s) => s.name !== 'c')).toBe(true)
  })
})

describe('parsePagesPlan', () => {
  it('parses a ```pages fenced block', () => {
    const text = [
      'Here is the plan.',
      '```pages',
      '[',
      '  { "title": "Home", "brief": "Landing" },',
      '  { "title": "Chat", "brief": "Conversation" }',
      ']',
      '```'
    ].join('\n')
    expect(parsePagesPlan(text)).toEqual([
      { title: 'Home', brief: 'Landing' },
      { title: 'Chat', brief: 'Conversation' }
    ])
  })

  it('falls back to a ```json block and a bare array', () => {
    expect(parsePagesPlan('```json\n[{"title":"A","brief":"a"}]\n```')).toEqual([{ title: 'A', brief: 'a' }])
    expect(parsePagesPlan('noise [{"title":"B","brief":"b"}] tail')).toEqual([{ title: 'B', brief: 'b' }])
  })

  it('dedupes by title, caps at max, and uses title when brief is missing', () => {
    const items = Array.from({ length: 9 }, (_, i) => `{ "title": "P${i}", "brief": "b${i}" }`)
    items.push('{ "title": "P0", "brief": "dupe" }') // duplicate title dropped
    items.push('{ "title": "NoBrief" }') // brief falls back to title
    const text = '```pages\n[' + items.join(',') + ']\n```'
    const pages = parsePagesPlan(text)
    expect(pages.length).toBe(DESIGN_PAGES_MAX)
    expect(pages[0]).toEqual({ title: 'P0', brief: 'b0' })
  })

  it('returns [] when nothing parses', () => {
    expect(parsePagesPlan('no json here')).toEqual([])
    expect(parsePagesPlan('```pages\nnot json\n```')).toEqual([])
    expect(parsePagesPlan('')).toEqual([])
  })
})

describe('buildDesignPlanPrompt', () => {
  it('embeds the brief, bounds the page count, and lists existing pages', () => {
    const prompt = buildDesignPlanPrompt({
      brief: 'A habit tracker app',
      workspaceRoot: '/ws',
      maxPages: 99,
      existingPages: [{ name: 'Login', htmlPath: '.kun-design/x/v1.html', summary: 'auth' }]
    })
    expect(prompt).toContain('A habit tracker app')
    expect(prompt).toContain(`2-${DESIGN_PAGES_MAX} pages`)
    expect(prompt).toContain('"Login"')
    expect(prompt).toContain('do NOT duplicate')
  })
})
