import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PPT_PREVIEW_TOOL_NAME } from './ppt-deck-tools.js'
import {
  cleanupPptWorkspaces,
  pptTool,
  pptToolContext,
  pptWorkspace,
  writePptDeck
} from './ppt-deck-tools-test-support.js'

afterEach(cleanupPptWorkspaces)

type ReviewSlide = { slideId: string; index: number; title: string; revision: number; previewPath: string }

function reviewSlides(output: unknown): ReviewSlide[] {
  return (output as { reviewBundle: { slides: ReviewSlide[] } }).reviewBundle.slides
}

describe('ppt_preview', () => {
  it('renders the deck onto the review board and bumps only edited pages', async () => {
    const root = await pptWorkspace('kun-ppt-preview-')
    const deck = join(root, 'presentations', 'q3')
    await writePptDeck(deck, [
      { file: 'pages/01_cover.page', title: 'Q3 review' },
      { file: 'pages/02_risks.page', title: 'Risks' }
    ], { title: 'Q3 review' })
    const tool = pptTool(PPT_PREVIEW_TOOL_NAME)
    const context = pptToolContext(root)

    const first = await tool.execute({ deck: 'presentations/q3' }, context)
    expect(first.isError).not.toBe(true)
    expect(first.output).toMatchObject({
      deck: 'presentations/q3',
      deckTitle: 'Q3 review',
      pageCount: 2,
      changedPages: [1, 2],
      imageAssets: 'unavailable',
      reviewBundle: {
        workflowId: 'deck:presentations/q3',
        childId: 'thr_slides',
        manifestPath: 'presentations/q3/.kun-ppt-review/preview.json',
        phase: 'awaiting_review'
      }
    })
    expect(reviewSlides(first.output).map((slide) => [slide.slideId, slide.revision])).toEqual([
      ['pages/01_cover.page', 1],
      ['pages/02_risks.page', 1]
    ])
    const firstSvg = await readFile(join(root, reviewSlides(first.output)[0].previewPath), 'utf8')
    expect(firstSvg).toContain('<svg')

    const unchanged = await tool.execute({ deck: 'presentations/q3/deck.pptd' }, context)
    expect(unchanged.output).toMatchObject({ changedPages: [] })
    expect(reviewSlides(unchanged.output).map((slide) => slide.revision)).toEqual([1, 1])

    await writePptDeck(deck, [
      { file: 'pages/01_cover.page', title: 'Q3 review' },
      { file: 'pages/02_risks.page', title: 'Risks, revised' }
    ], { title: 'Q3 review' })
    const edited = await tool.execute({ deck: 'presentations/q3' }, context)
    expect(edited.output).toMatchObject({ changedPages: [2] })
    expect(reviewSlides(edited.output).map((slide) => slide.revision)).toEqual([1, 2])
    const previews = await readdir(join(deck, '.kun-ppt-review', 'previews'))
    expect(previews.filter((name) => name.endsWith('-r2.svg'))).toHaveLength(1)
  })

  it('reports layout hints without blocking the preview', async () => {
    const root = await pptWorkspace('kun-ppt-preview-lint-')
    await writePptDeck(join(root, 'deck'), [{ file: 'pages/01.page', title: 'Tiny text', fontSize: 8 }])

    const result = await pptTool(PPT_PREVIEW_TOOL_NAME).execute({ deck: 'deck' }, pptToolContext(root))
    expect(result.isError).not.toBe(true)
    expect((result.output as { issues: Array<{ page: number; rule: string }> }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ page: 1, rule: 'small-text' })]))
  })

  it('compares three sample decks as visual directions', async () => {
    const root = await pptWorkspace('kun-ppt-directions-')
    const samples = ['a', 'b', 'c']
    for (const [index, name] of samples.entries()) {
      await writePptDeck(join(root, 'presentations', 'q3', 'directions', name), [
        { file: 'pages/01.page', title: `Cover ${name}` },
        { file: 'pages/02.page', title: 'Representative' },
        { file: 'pages/03.page', title: 'Complex' }
      ], { title: 'Q3 review', fonts: index === 0 ? ['Inter', 'Inter'] : ['Inter', 'Source Serif 4'] })
    }
    const directions = samples.map((name, index) => ({
      name: `Direction ${name}`,
      rationale: `Why ${name}`,
      recommended: index === 1,
      deck: `presentations/q3/directions/${name}`,
      layout: 'Stable title axis',
      imagery: 'Native shapes'
    }))

    const result = await pptTool(PPT_PREVIEW_TOOL_NAME).execute({ deck: 'presentations/q3', directions }, pptToolContext(root))
    expect(result.isError).not.toBe(true)
    const output = result.output as {
      directions: Array<{ directionId: string; recommended: boolean }>
      directionBundle: {
        workflowId: string
        recommendedDirectionId: string
        slides: unknown[]
        directions: Array<{ directionId: string; fonts: string[]; colors: string[]; previews: Array<{ role: string; imagePath: string }> }>
      }
    }
    expect(output.directions.map((direction) => direction.directionId)).toEqual(samples.map((name) => `presentations/q3/directions/${name}`))
    expect(output.directionBundle).toMatchObject({
      workflowId: 'deck:presentations/q3',
      recommendedDirectionId: 'presentations/q3/directions/b',
      phase: 'awaiting_direction'
    })
    expect(output.directionBundle.slides).toHaveLength(3)
    for (const direction of output.directionBundle.directions) {
      expect(direction.fonts.length).toBeGreaterThanOrEqual(2)
      expect(direction.colors.length).toBeGreaterThanOrEqual(4)
      expect(direction.previews.map((preview) => preview.role)).toEqual(['cover', 'representative', 'complex'])
      expect(await readFile(join(root, direction.previews[0].imagePath), 'utf8')).toContain('<svg')
    }

    const tooFew = await pptTool(PPT_PREVIEW_TOOL_NAME).execute({ deck: 'presentations/q3', directions: directions.slice(0, 2) }, pptToolContext(root))
    expect(tooFew).toMatchObject({ isError: true })
  })

  it('stays advertised and refuses calls while the Lab switch is off', async () => {
    const root = await pptWorkspace('kun-ppt-preview-off-')
    await writePptDeck(join(root, 'deck'), [{ file: 'pages/01.page', title: 'Off' }])
    const tool = pptTool(PPT_PREVIEW_TOOL_NAME, { enabled: () => false })
    expect(tool.shouldAdvertise?.(pptToolContext(root))).toBe(false)
    expect(await tool.execute({ deck: 'deck' }, pptToolContext(root))).toMatchObject({
      isError: true, output: { error: 'PPT tools are turned off in Lab settings' }
    })
  })

  it('rejects decks outside the workspace', async () => {
    const root = await pptWorkspace('kun-ppt-preview-scope-')
    const result = await pptTool(PPT_PREVIEW_TOOL_NAME).execute({ deck: '../outside' }, pptToolContext(root))
    expect(result).toMatchObject({ isError: true })
  })
})
