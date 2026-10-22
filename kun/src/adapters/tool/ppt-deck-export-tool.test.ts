import { link, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PPT_GENERATED_ASSET_LIMIT } from './ppt-asset-ledger.js'
import { PPT_EXPORT_TOOL_NAME, PPT_IMPORT_ASSET_TOOL_NAME } from './ppt-deck-tools.js'
import {
  cleanupPptWorkspaces,
  pptTool,
  pptToolContext,
  pptWorkspace,
  writePptDeck
} from './ppt-deck-tools-test-support.js'

afterEach(cleanupPptWorkspaces)

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

describe('ppt_export', () => {
  it('blocks publication on geometry errors and returns repair hints', async () => {
    const root = await pptWorkspace('kun-ppt-export-error-')
    await writePptDeck(join(root, 'deck'), [{ file: 'pages/01.page', title: 'Geometry QA text', fontSize: 6 }])

    const result = await pptTool(PPT_EXPORT_TOOL_NAME).execute({ deck: 'deck', output: 'presentations/deck.pptx' }, pptToolContext(root))

    expect(result).toMatchObject({
      isError: true,
      output: {
        validated: false,
        phase: 'failed_recoverable',
        qa: { reportPath: 'deck/.kun-ppt-review/qa.json', counts: { errors: 1 } },
        issues: [{ severity: 'error', rule: 'text.minimum_font_size' }],
        reviewBundle: { phase: 'failed_recoverable', slides: [{ qaIssues: [{ severity: 'error' }] }] }
      }
    })
    await expect(readFile(join(root, 'presentations', 'deck.pptx'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(JSON.parse(await readFile(join(root, 'deck', '.kun-ppt-review', 'qa.json'), 'utf8')))
      .toMatchObject({ version: 1, counts: { errors: 1 } })

    const forced = await pptTool(PPT_EXPORT_TOOL_NAME).execute({
      deck: 'deck', output: 'presentations/deck.pptx', allowQaErrors: true
    }, pptToolContext(root))
    expect(forced.output).toMatchObject({ validated: true, qaPassed: false, phase: 'completed' })
  }, 60_000)

  it('publishes a validated, editable PPTX and refuses to overwrite without replace', async () => {
    const root = await pptWorkspace('kun-ppt-export-ok-')
    await writePptDeck(join(root, 'deck'), [{ file: 'pages/01.page', title: 'Native title' }])
    const tool = pptTool(PPT_EXPORT_TOOL_NAME)

    const result = await tool.execute({ deck: 'deck/deck.pptd', output: 'presentations/deck.pptx' }, pptToolContext(root))
    expect(result.isError).not.toBe(true)
    expect(result.output).toMatchObject({
      deck: 'deck',
      output: 'presentations/deck.pptx',
      slides: 1,
      editableSlides: 1,
      validated: true,
      qaPassed: true,
      phase: 'completed',
      reviewBundle: { phase: 'completed', slides: [{ slideId: 'pages/01.page', qaIssues: [] }] }
    })
    expect((await readFile(join(root, 'presentations', 'deck.pptx'))).subarray(0, 2).toString()).toBe('PK')

    expect(await tool.execute({ deck: 'deck', output: 'presentations/deck.pptx' }, pptToolContext(root)))
      .toMatchObject({ isError: true })
    expect((await tool.execute({ deck: 'deck', output: 'presentations/deck.pptx', replace: true }, pptToolContext(root))).output)
      .toMatchObject({ validated: true })
    expect(await tool.execute({ deck: 'deck', output: 'presentations/deck.key' }, pptToolContext(root)))
      .toMatchObject({ isError: true })
  }, 60_000)

  it('rejects deck and output symlink escapes', async () => {
    const root = await pptWorkspace('kun-ppt-export-scope-')
    const outside = await pptWorkspace('kun-ppt-export-outside-')
    await writePptDeck(join(root, 'deck'), [{ file: 'pages/01.page', title: 'Scope' }])
    await mkdir(join(root, 'presentations'))
    await symlink(outside, join(root, 'presentations', 'linked'), 'dir')
    const tool = pptTool(PPT_EXPORT_TOOL_NAME)

    const outputEscape = await tool.execute({ deck: 'deck', output: 'presentations/linked/deck.pptx' }, pptToolContext(root))
    expect(outputEscape.isError).toBe(true)
    expect(JSON.stringify(outputEscape.output)).toMatch(/symbolic link|junction|scope|workspace root/)

    await writePptDeck(join(outside, 'deck'), [{ file: 'pages/01.page', title: 'Outside' }])
    await symlink(join(outside, 'deck'), join(root, 'linked-deck'), 'dir')
    const deckEscape = await tool.execute({ deck: 'linked-deck', output: 'presentations/deck.pptx' }, pptToolContext(root))
    expect(deckEscape.isError).toBe(true)
    expect(JSON.stringify(deckEscape.output)).toMatch(/symbolic link|junction|scope|workspace root/)
  })
})

describe('ppt_import_asset', () => {
  it('copies user material and generated images byte for byte and records their origin', async () => {
    const root = await pptWorkspace('kun-ppt-asset-')
    await writePptDeck(join(root, 'deck'), [{ file: 'pages/01.page', title: 'Assets' }])
    await mkdir(join(root, 'assets'))
    await mkdir(join(root, '.kun', 'images'), { recursive: true })
    await writeFile(join(root, 'assets', 'line.png'), PNG)
    await writeFile(join(root, '.kun', 'images', 'cover.png'), PNG)
    const tool = pptTool(PPT_IMPORT_ASSET_TOOL_NAME, { imageAssets: () => ({ enabled: true, available: true }) })

    expect((await tool.execute({ source: 'assets/line.png', deck: 'deck' }, pptToolContext(root))).output).toMatchObject({
      importedPath: 'deck/media/line.png', pptdSrc: 'media/line.png', origin: 'user', bytes: PNG.length
    })
    expect((await tool.execute({ source: '.kun/images/cover.png', deck: 'deck/deck.pptd', name: 'hero.png' }, pptToolContext(root))).output)
      .toMatchObject({ pptdSrc: 'media/hero.png', origin: 'generated' })
    expect(await readFile(join(root, 'deck', 'media', 'hero.png'))).toEqual(PNG)
    const ledger = JSON.parse(await readFile(join(root, 'deck', '.kun-ppt-review', 'assets.json'), 'utf8'))
    expect(ledger.assets).toMatchObject({
      'media/line.png': { origin: 'user', source: 'assets/line.png' },
      'media/hero.png': { origin: 'generated', source: '.kun/images/cover.png' }
    })

    expect(await tool.execute({ source: 'assets/line.png', deck: 'deck' }, pptToolContext(root))).toMatchObject({ isError: true })
    expect(await tool.execute({ source: 'deck/media/line.png', deck: 'deck', name: 'again.png' }, pptToolContext(root))).toMatchObject({ isError: true })
    expect(await tool.execute({ source: 'assets/line.png', deck: 'deck', name: 'line.jpg' }, pptToolContext(root))).toMatchObject({ isError: true })
  })

  it(`caps generated images at ${PPT_GENERATED_ASSET_LIMIT} per deck and honors the Lab switch`, async () => {
    const root = await pptWorkspace('kun-ppt-asset-cap-')
    await writePptDeck(join(root, 'deck'), [{ file: 'pages/01.page', title: 'Cap' }])
    await mkdir(join(root, '.kun', 'images'), { recursive: true })
    await mkdir(join(root, 'assets'))
    await writeFile(join(root, 'assets', 'mine.png'), PNG)
    for (let index = 0; index <= PPT_GENERATED_ASSET_LIMIT; index += 1) {
      await writeFile(join(root, '.kun', 'images', `g${index}.png`), PNG)
    }
    const tool = pptTool(PPT_IMPORT_ASSET_TOOL_NAME, { imageAssets: () => ({ enabled: true, available: true }) })
    for (let index = 0; index < PPT_GENERATED_ASSET_LIMIT; index += 1) {
      expect((await tool.execute({ source: `.kun/images/g${index}.png`, deck: 'deck' }, pptToolContext(root))).isError).not.toBe(true)
    }
    expect(await tool.execute({ source: `.kun/images/g${PPT_GENERATED_ASSET_LIMIT}.png`, deck: 'deck' }, pptToolContext(root)))
      .toMatchObject({ isError: true })
    expect((await tool.execute({ source: 'assets/mine.png', deck: 'deck' }, pptToolContext(root))).output).toMatchObject({ origin: 'user' })

    const disabled = pptTool(PPT_IMPORT_ASSET_TOOL_NAME, { imageAssets: () => ({ enabled: false, available: true }) })
    await rm(join(root, 'deck', 'media'), { recursive: true })
    expect(await disabled.execute({ source: '.kun/images/g0.png', deck: 'deck' }, pptToolContext(root))).toMatchObject({ isError: true })
  })

  it('rejects symlinked and hard-linked sources and destinations', async () => {
    const root = await pptWorkspace('kun-ppt-asset-scope-')
    const outside = await pptWorkspace('kun-ppt-asset-outside-')
    await writePptDeck(join(root, 'deck'), [{ file: 'pages/01.page', title: 'Scope' }])
    await mkdir(join(root, '.kun', 'images'), { recursive: true })
    await writeFile(join(outside, 'secret.png'), PNG)
    await symlink(join(outside, 'secret.png'), join(root, '.kun', 'images', 'linked.png'))
    const tool = pptTool(PPT_IMPORT_ASSET_TOOL_NAME, { imageAssets: () => ({ enabled: true, available: true }) })

    const sourceEscape = await tool.execute({ source: '.kun/images/linked.png', deck: 'deck' }, pptToolContext(root))
    expect(sourceEscape.isError).toBe(true)
    expect(JSON.stringify(sourceEscape.output)).toMatch(/symbolic link|junction|scope|workspace root/)

    await link(join(outside, 'secret.png'), join(root, '.kun', 'images', 'hard.png'))
    const hardLinked = await tool.execute({ source: '.kun/images/hard.png', deck: 'deck' }, pptToolContext(root))
    expect(hardLinked.isError).toBe(true)
    expect(JSON.stringify(hardLinked.output)).toContain('hard-linked')

    await writeFile(join(root, '.kun', 'images', 'source.png'), PNG)
    await symlink(outside, join(root, 'deck', 'media'), 'dir')
    const destinationEscape = await tool.execute({ source: '.kun/images/source.png', deck: 'deck' }, pptToolContext(root))
    expect(destinationEscape.isError).toBe(true)
    await expect(readFile(join(outside, 'source.png'))).rejects.toThrow()
  })
})
