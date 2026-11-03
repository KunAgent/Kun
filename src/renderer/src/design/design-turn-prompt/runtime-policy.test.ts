import { describe, expect, it } from 'vitest'
import { DESIGN_CANVAS_MODE_INSTRUCTION } from '../../../../../kun/src/loop/design-canvas-mode'
import { DESIGN_HTML_PAGE_MODE_INSTRUCTION } from '../../../../../kun/src/loop/design-html-page-mode'
import { snapshotCanvas } from '../canvas/canvas-snapshot'
import { createDefaultShape, createEmptyDocument } from '../canvas/canvas-types'
import {
  DESIGN_CRAFT_LINES,
  DESIGN_DELIVERY_LINES,
  DESIGN_RESIZE_RESPONSIVE_LINES
} from '../design-context'
import { buildCodeCanvasTurnPrompt } from './code-and-image'
import { buildDesignTurnPrompt } from './entry'
import type { DesignTurnOptions, ScreenTurnOptions } from './shared'
import { RUNTIME_PAGE_POLICY_LINE } from './shared'

const designContext = { designTarget: 'web' as const, brandColor: '#2563eb' }

function screenOptions(runtimeModePolicy: boolean): ScreenTurnOptions {
  return {
    target: 'screen',
    mode: 'text',
    text: 'Login page with SSO',
    workspaceRoot: '/w',
    designContext,
    artifactRelativePath: '.kun-design/doc/a/v1.html',
    designNotesPath: '.kun-design/doc/a/DESIGN.md',
    screenName: 'Login',
    screenWidth: 1280,
    screenHeight: 800,
    screenManifest: [
      { name: 'Home', htmlPath: '.kun-design/doc/h/v1.html', summary: 'Home with hero' },
      { name: 'Detail', htmlPath: '.kun-design/doc/b/v1.html', planned: true }
    ],
    ...(runtimeModePolicy ? { runtimeModePolicy: true } : {})
  }
}

function canvasOptions(runtimeModePolicy: boolean): DesignTurnOptions {
  const doc = createEmptyDocument()
  const root = doc.objects[doc.rootId]
  const img = { ...createDefaultShape('image', 50, 60), id: 'img_1', parentId: doc.rootId }
  img.imageUrl = '.kun/images/old.png'
  doc.objects[img.id] = img
  doc.objects[doc.rootId] = { ...root, children: [img.id] }
  return {
    target: 'canvas',
    mode: 'text',
    text: 'Make it a night scene',
    workspaceRoot: '/w',
    designContext,
    artifactRelativePath: '.kun-design/doc/board.canvas.json',
    canvasSnapshot: snapshotCanvas(doc, new Set([img.id])),
    ...(runtimeModePolicy ? { runtimeModePolicy: true } : {})
  }
}

/** Lines the runtime prompt dropped from the inline prompt. */
function droppedLines(inline: string, runtime: string): string[] {
  const kept = new Set(runtime.split('\n'))
  return inline.split('\n').filter((line) => line.trim() && !kept.has(line))
}

describe('design turn prompts under a Kun runtime mode policy', () => {
  it('keeps only turn-specific context in a reserved page prompt', () => {
    const prompt = buildDesignTurnPrompt(screenOptions(true))
    expect(prompt).toContain('Reserved artifact file: .kun-design/doc/a/v1.html')
    expect(prompt).toContain('Modify ONLY `.kun-design/doc/a/v1.html` and `.kun-design/doc/a/DESIGN.md`')
    expect(prompt).toContain('Selected screen frame: 1280x800 canvas pixels.')
    expect(prompt).toContain('Planned in this batch')
    expect(prompt).toContain('prototype href: ../b/v1.html')
    expect(prompt).toContain('Brand color anchor: #2563eb')
    expect(prompt).toContain('Login page with SSO')
    expect(prompt).toContain(RUNTIME_PAGE_POLICY_LINE)
    for (const block of [DESIGN_DELIVERY_LINES, DESIGN_CRAFT_LINES, DESIGN_RESIZE_RESPONSIVE_LINES]) {
      expect(prompt).not.toContain(block[0])
    }
    expect(prompt).not.toContain('Prototype link markup contract')
    expect(prompt.length).toBeLessThan(buildDesignTurnPrompt(screenOptions(false)).length / 3)
  })

  it('moves every dropped page rule into the Kun page policy', () => {
    const dropped = droppedLines(
      buildDesignTurnPrompt(screenOptions(false)),
      buildDesignTurnPrompt(screenOptions(true))
    )
    const policy = DESIGN_HTML_PAGE_MODE_INSTRUCTION.split('\n')
    // The hard-rule bullets are reworded for every page kind; the shared blocks move verbatim.
    const reworded = dropped.filter((line) => !policy.includes(line))
    expect(reworded.every((line) => line.startsWith('- '))).toBe(true)
    expect(reworded.length).toBeLessThanOrEqual(8)
    for (const line of [...DESIGN_DELIVERY_LINES, ...DESIGN_CRAFT_LINES, ...DESIGN_RESIZE_RESPONSIVE_LINES]) {
      expect(policy).toContain(line)
    }
  })

  it('applies the same split to HTML iteration prompts', () => {
    const options: DesignTurnOptions = {
      target: 'html', mode: 'text', text: 'Add an FAQ', workspaceRoot: '/w', designContext,
      artifactRelativePath: '.kun-design/doc/p/v2.html', basePath: '.kun-design/doc/p/v1.html'
    }
    const prompt = buildDesignTurnPrompt({ ...options, runtimeModePolicy: true })
    expect(prompt).toContain('Current design to iterate on: .kun-design/doc/p/v1.html')
    expect(prompt).toContain('HTML iteration discipline')
    expect(prompt).toContain(RUNTIME_PAGE_POLICY_LINE)
    expect(prompt).not.toContain(DESIGN_DELIVERY_LINES[0])
  })

  it('keeps snapshot, selection prior and frame target in a Design canvas prompt', () => {
    const prompt = buildDesignTurnPrompt(canvasOptions(true))
    expect(prompt).toContain('IMPORTANT PRIOR')
    expect(prompt).toContain('.kun/images/old.png')
    expect(prompt).toContain('Design target: Web.')
    expect(prompt).toContain('recommendedSlots` for new 1280x800 target screen frames')
    expect(prompt).toContain('Current canvas snapshot')
    expect(prompt).not.toContain('ShapeOp vocabulary')
    expect(prompt).not.toContain('FIRST classify the request')
    expect(prompt).not.toContain('Example response shape:')
  })

  it('moves every dropped canvas line into the Kun canvas policy', () => {
    const dropped = droppedLines(
      buildDesignTurnPrompt(canvasOptions(false)),
      buildDesignTurnPrompt(canvasOptions(true))
    )
    const policy = new Set(DESIGN_CANVAS_MODE_INSTRUCTION.split('\n'))
    expect(dropped.length).toBeGreaterThan(50)
    expect(dropped.filter((line) => !policy.has(line))).toEqual([])
  })

  it('leaves the Code whiteboard prompt self-contained', () => {
    const options = {
      workspaceRoot: '/w', text: 'Sketch the API flow', designContext,
      canvasSnapshot: snapshotCanvas(createEmptyDocument(), new Set())
    }
    const prompt = buildCodeCanvasTurnPrompt(options)
    expect(prompt).toContain('ShapeOp vocabulary')
    expect(prompt).toContain('Code-mode whiteboard override:')
    expect(prompt).toContain('UI frame placeholders')
  })
})
