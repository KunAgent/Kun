import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PptWorkflowScope, ToolHostContext } from '../../ports/tool-host.js'
import {
  buildPptAgentLocalTools,
  PPT_IMPORT_ASSET_TOOL_NAME,
  PPT_READ_GUIDE_TOOL_NAME,
  PPT_SUBMIT_DESIGN_PLAN_TOOL_NAME
} from './ppt-agent-local-tools.js'
import { PPT_GENERATED_ASSET_LIMIT } from './ppt-agent-asset-ledger.js'

const roots: string[] = []
const toolchain = resolve(process.cwd(), '..', 'resources', 'ppt-toolchain')
const sourceRequest = 'Create a two-page quarterly review for the leadership team.'
const workflowId = 'ppt_editable_preview'
const projectDir = 'deck'
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

const plan = {
  category: 'management-report',
  audience: 'Leadership team',
  purpose: 'Review the quarter and agree on next steps',
  pageStrategy: { pageCount: 2, narrative: 'Headline result first, then the evidence behind it' },
  fontRoles: { display: 'Inter', body: 'Inter' },
  colorRoles: {
    background: '#FFFFFF', foreground: '#14213D', accent: '#F2A541', muted: '#66717D',
    positive: '#287A4B', caution: '#A56A16', critical: '#B33030'
  },
  backgroundTreatment: { kind: 'solid' },
  effects: [],
  typeScale: { title: 40, section: 28, body: 18, caption: 11 },
  spacingRhythm: { unit: 8, pageMargin: 48, columns: 12, gutter: 20 },
  layoutSystem: 'Left title axis with one evidence block per page',
  imageryStrategy: 'One scene picture where it explains the change; otherwise native charts',
  policyExceptions: []
}

function context(root: string, scope: Partial<PptWorkflowScope> = {}): ToolHostContext {
  return {
    threadId: 'child_editable',
    turnId: 'turn_editable',
    workspace: root,
    sandboxMode: 'workspace-write',
    approvalPolicy: 'never',
    approvalIntent: sourceRequest,
    pptWorkflowScope: {
      action: 'start', workflowId, projectDir, parentThreadId: 'parent', previewMode: 'editable', ...scope
    },
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

function tools() {
  return buildPptAgentLocalTools({
    toolchainDirectory: () => toolchain,
    governanceDirectory: (toolContext) => {
      const directory = `${toolContext.workspace}.governance`
      roots.push(directory)
      return directory
    },
    resolveSourceRequest: () => sourceRequest
  })
}

function tool(name: string) {
  return tools().find((candidate) => candidate.name === name)!
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-ppt-editable-'))
  roots.push(root)
  await mkdir(join(root, 'assets'), { recursive: true })
  await mkdir(join(root, '.kun', 'images'), { recursive: true })
  await mkdir(join(root, projectDir, 'pages'), { recursive: true })
  await writeFile(join(root, 'assets', 'line.png'), PNG_1X1)
  await writeFile(join(root, '.kun', 'images', 'scene.png'), PNG_1X1)
  return root
}

async function govern(root: string): Promise<void> {
  for (const path of ['slides_categories.md', 'slides_categories/management-report.md']) {
    const result = await tool(PPT_READ_GUIDE_TOOL_NAME).execute(
      { workflowId, projectDir, path, max_lines: 400 }, context(root))
    if (result.isError) throw new Error(JSON.stringify(result.output))
  }
  const result = await tool(PPT_SUBMIT_DESIGN_PLAN_TOOL_NAME).execute({ workflowId, projectDir, plan }, context(root))
  if (result.isError) throw new Error(JSON.stringify(result.output))
}

async function writeDeck(root: string): Promise<void> {
  await writeFile(join(root, projectDir, 'deck.pptd'), [
    'version: v2', 'title: Q3 review', 'size: [960, 540]', 'pages:', '  - pages/1.page', '  - pages/2.page'
  ].join('\n'))
  const page = (title: string, image: string) => [
    'elements:',
    '  - elementId: title',
    '    elementType: text',
    '    bounds: [48, 40, 520, 60]',
    `    content: {fontSize: 36, bold: true, text: "${title}"}`,
    '  - elementId: picture',
    '    elementType: image',
    '    bounds: [600, 60, 300, 400]',
    `    src: ${image}`
  ].join('\n')
  await writeFile(join(root, projectDir, 'pages', '1.page'), page('Line upgrade', 'media/line.png'))
  await writeFile(join(root, projectDir, 'pages', '2.page'), page('Next quarter', 'media/scene.png'))
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('editable PPT previews and slot assets', () => {
  it('renders the editable deck itself and reports where each slide image came from', async () => {
    const root = await workspace()
    await govern(root)
    const importAsset = tool(PPT_IMPORT_ASSET_TOOL_NAME)
    await expect(importAsset.execute({ source: 'assets/line.png' }, context(root))).resolves.toMatchObject({
      output: { origin: 'user', pptdSrc: 'media/line.png', importedPath: 'deck/media/line.png' }
    })
    await expect(importAsset.execute({ source: '.kun/images/scene.png' }, context(root))).resolves.toMatchObject({
      output: { origin: 'generated', pptdSrc: 'media/scene.png' }
    })
    await writeDeck(root)

    const previews = tool('ppt_generate_previews')
    const first = await previews.execute({ workflowId, parentThreadId: 'parent', input: projectDir }, context(root))
    expect(first.isError).toBeFalsy()
    expect(first.output).toMatchObject({
      renderer: 'kun-pptd-svg@1',
      reviewBundle: {
        previewMode: 'editable',
        phase: 'awaiting_review',
        slides: [
          {
            title: 'Line upgrade',
            previewPath: 'deck/.kun-ppt-review/previews/p01-r1.svg',
            assets: [{
              path: 'deck/media/line.png',
              origin: 'user',
              rect: { x: 0.625, y: 0.1111, width: 0.3125, height: 0.7408 }
            }]
          },
          {
            title: 'Next quarter',
            previewPath: 'deck/.kun-ppt-review/previews/p02-r1.svg',
            assets: [{ path: 'deck/media/scene.png', origin: 'generated' }]
          }
        ]
      }
    })
    const svg = await readFile(join(root, 'deck', '.kun-ppt-review', 'previews', 'p01-r1.svg'), 'utf8')
    expect(svg).toContain('<svg')
    expect(svg).toContain('data:image/png;base64,')

    await previews.execute({ workflowId, parentThreadId: 'parent', input: projectDir }, context(root))
    await previews.execute({ workflowId, parentThreadId: 'parent', input: projectDir }, context(root))
    const files = (await readdir(join(root, 'deck', '.kun-ppt-review', 'previews'))).sort()
    expect(files).toEqual(['p01-r2.svg', 'p01-r3.svg', 'p02-r2.svg', 'p02-r3.svg'])
  })

  it('accepts only user material or generate_image results as sources', async () => {
    const root = await workspace()
    await mkdir(join(root, '.kun', 'cache'), { recursive: true })
    await writeFile(join(root, '.kun', 'cache', 'other.png'), PNG_1X1)
    await mkdir(join(root, projectDir, 'media'), { recursive: true })
    await writeFile(join(root, projectDir, 'media', 'existing.png'), PNG_1X1)
    const importAsset = tool(PPT_IMPORT_ASSET_TOOL_NAME)
    for (const source of ['.kun/cache/other.png', 'deck/media/existing.png', '../outside.png']) {
      await expect(importAsset.execute({ source, name: 'copy.png' }, context(root))).resolves.toMatchObject({ isError: true })
    }
  })

  it(`caps generated images at ${PPT_GENERATED_ASSET_LIMIT} per deck but not user material`, async () => {
    const root = await workspace()
    const importAsset = tool(PPT_IMPORT_ASSET_TOOL_NAME)
    for (let index = 0; index <= PPT_GENERATED_ASSET_LIMIT; index += 1) {
      await writeFile(join(root, '.kun', 'images', `gen-${index}.png`), PNG_1X1)
    }
    for (let index = 0; index < PPT_GENERATED_ASSET_LIMIT; index += 1) {
      const result = await importAsset.execute({ source: `.kun/images/gen-${index}.png` }, context(root))
      expect(result.isError).toBeFalsy()
    }
    await expect(importAsset.execute(
      { source: `.kun/images/gen-${PPT_GENERATED_ASSET_LIMIT}.png` }, context(root)
    )).resolves.toMatchObject({ isError: true, output: { error: expect.stringContaining('generated images') } })
    await expect(importAsset.execute({ source: 'assets/line.png' }, context(root))).resolves.toMatchObject({
      output: { origin: 'user' }
    })
  })
})
