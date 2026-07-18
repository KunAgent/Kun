import { describe, expect, it } from 'vitest'
import {
  buildCodeCanvasTurnPrompt,
  buildDesignImageNodePrompt,
  buildDesignTurnPrompt,
  buildParallelDesignPagesPrompt,
  buildPrototypeHref
} from './design-turn-prompt'
import type { ScreenTurnOptions } from './design-turn-prompt'
import { snapshotCanvas } from './canvas/canvas-snapshot'
import { createDefaultShape, createEmptyDocument, createHtmlFrameShape } from './canvas/canvas-types'
import { setLastLintFindings } from './canvas/design-lint'
import { useDesignSystemStore } from './canvas/design-system-store'
import { CANVAS_MOTION_VERSION } from './motion/canvas-motion-types'

describe("design turn prompt code canvas and context guidance", () => {
    it('includes bounded Motion state and distinguishes Motion, SVG animation, and Prototype navigation', () => {
      const doc = createEmptyDocument()
      const root = doc.objects[doc.rootId]
      const frame = { ...createDefaultShape('frame', 0, 0), id: 'frame_home', parentId: doc.rootId, children: ['hero'] }
      const hero = { ...createDefaultShape('rect', 20, 20), id: 'hero', parentId: frame.id, frameId: frame.id }
      doc.objects[doc.rootId] = { ...root, children: [frame.id] }
      doc.objects[frame.id] = frame
      doc.objects[hero.id] = hero
      doc.motion = {
        version: CANVAS_MOTION_VERSION,
        timelines: {
          frame_home: {
            id: 'timeline_home',
            frameId: frame.id,
            durationMs: 600,
            playback: 'loop',
            tracks: [{
              id: 'track_hero_x',
              targetShapeId: hero.id,
              property: 'x',
              operation: 'offset',
              baseValue: hero.x,
              keyframes: [
                { id: 'kf_start', timeMs: 0, value: -16, easing: { type: 'ease-out' } },
                { id: 'kf_end', timeMs: 600, value: 0, easing: { type: 'linear' } }
              ]
            }]
          }
        }
      }

      const prompt = buildDesignTurnPrompt({
        target: 'canvas',
        mode: 'text',
        text: 'Make the hero enter, then link the CTA to settings',
        artifactRelativePath: '.kun-design/board/canvas.json',
        workspaceRoot: '/workspace',
        canvasSnapshot: snapshotCanvas(doc, new Set([hero.id]), { rootFrameId: frame.id })
      })

      expect(prompt).toContain('ANIMATE A DESIGN FRAME OR LAYERS')
      expect(prompt).toContain('SVG motion edits the standalone SVG inner animation')
      expect(prompt).toContain('Prototype is screen-to-screen navigation')
      expect(prompt).toContain('`design_motion_upsert_keyframes`')
      expect(prompt).toContain('"id": "track_hero_x"')
      expect(prompt).toContain('"id": "kf_start"')
      expect(prompt).toContain('"automaticPlayback": "disabled-when-preferred"')
    })
    it('keeps code canvas lint feedback separate from design canvas lint feedback', () => {
      setLastLintFindings([
        {
          code: 'low-contrast',
          shapeId: 'design_text',
          message: 'Design text contrast needs repair.'
        }
      ])
      setLastLintFindings(
        [
          {
            code: 'small-hit-target',
            shapeId: 'code_button',
            message: 'Code whiteboard button needs a larger hit target.'
          }
        ],
        'code-canvas:thread-1'
      )
  
      const codePrompt = buildCodeCanvasTurnPrompt({
        workspaceRoot: '/ws',
        canvasFeedbackKey: 'code-canvas:thread-1'
      })
      expect(codePrompt).toContain('Code whiteboard button needs a larger hit target.')
      expect(codePrompt).not.toContain('Design text contrast needs repair.')
  
      const designPrompt = buildDesignTurnPrompt({
        target: 'canvas',
        mode: 'text',
        text: 'fix critique findings',
        artifactRelativePath: '.kun-design/board/canvas.json',
        workspaceRoot: '/ws'
      })
      expect(designPrompt).toContain('Design text contrast needs repair.')
      expect(designPrompt).not.toContain('Code whiteboard button needs a larger hit target.')
    })
    it('renders previous canvas-op errors so the agent can self-correct', () => {
      const prompt = buildDesignTurnPrompt({
        target: 'canvas',
        mode: 'text',
        text: 'try again',
        artifactRelativePath: '.kun-design/board/canvas.json',
        workspaceRoot: '/workspace',
        previousOpErrors: [
          { code: 'SHAPE_NOT_FOUND', message: 'No shape with id "ghost"', suggestion: 'Available shapes: "Card" (s_1)' }
        ]
      })
      expect(prompt).toContain('YOUR PREVIOUS canvas attempt had errors')
      expect(prompt).toContain('No shape with id "ghost"')
      expect(prompt).toContain('Available shapes: "Card" (s_1)')
    })
    it('canvas turn prompt frames screen creation as a dedicated design tool call', () => {
      const prompt = buildCodeCanvasTurnPrompt({ workspaceRoot: '/ws' })
      expect(prompt).toContain('dedicated canvas tools')
      expect(prompt).toContain('Code sidebar whiteboard')
      expect(prompt).toContain('do not ask the user to manually create a canvas first')
      expect(prompt).toContain('`design_create_screen`')
      expect(prompt).toContain('Web -> desktop 1280x800, App -> mobile 390x844')
      expect(prompt).toContain('Omit width/height/devicePreset unless the user asks for a custom device or breakpoint')
      expect(prompt).toContain('omitted dimensions follow the current target')
      expect(prompt).toContain('Updates thread-scoped structured tokens/components without drawing a board')
      expect(prompt).toContain('Call the real canvas tool that directly produces the requested outcome')
      expect(prompt).toContain('SKETCH A SCREEN OR UI FRAME')
      expect(prompt).toContain('No HTML artifact is generated in Code mode')
      expect(prompt).toContain('UI frame default is 1280x800 desktop web for explicit UI mockups only')
      expect(prompt).toContain('Code architecture, dependency, data-flow, and debugging diagrams are freeform whiteboard shapes')
      expect(prompt).toContain('In Code mode this creates plain editable frame shapes only; no HTML is generated.')
      expect(prompt).toContain('there is no follow-up HTML generation in Code mode')
      expect(prompt).toContain('`design_export_canvas`')
      expect(prompt).toContain('create/update the editable shapes first')
      expect(prompt).toContain('do not call `generate_image` to redraw or rasterize the architecture diagram')
      expect(prompt).toContain('Code-mode whiteboard override')
      expect(prompt).toContain('creates plain editable frame shapes here')
      expect(prompt).toContain('does NOT trigger follow-up HTML screen generation')
      expect(prompt).toContain('(empty canvas)')
      expect(prompt).not.toContain('Default screen frame')
      expect(prompt).not.toContain('the system generates its HTML afterwards')
      expect(prompt).not.toContain('The system auto-generates HTML afterwards')
      expect(prompt).not.toContain('each gets its HTML generated afterwards')
      expect(prompt).not.toContain('the system will AUTOMATICALLY generate the HTML content')
      expect(prompt).not.toContain('```design_canvas')
    })
    it('code canvas prompt carries the current whiteboard brief', () => {
      const prompt = buildCodeCanvasTurnPrompt({
        workspaceRoot: '/ws',
        text: 'Sketch a checkout flow on the code whiteboard'
      })
  
      expect(prompt).toContain('Brief:')
      expect(prompt).toContain('Sketch a checkout flow on the code whiteboard')
      expect(prompt).toContain('Code-mode whiteboard override')
    })
    it('code canvas prompt prioritizes architecture and flow diagrams over screen creation', () => {
      const codePrompt = buildCodeCanvasTurnPrompt({ workspaceRoot: '/ws' })
      expect(codePrompt).toContain('MAP CODE / ARCHITECTURE / FLOW')
      expect(codePrompt).toContain('system architecture, code structure, module relationships')
      expect(codePrompt).toContain('Do NOT use `design_create_screen` unless they explicitly ask for a UI screen mockup')
      expect(codePrompt).toContain('services/modules as frames or rects')
      expect(codePrompt).toContain('data/events as arrows')
      expect(codePrompt).toContain('call `design_export_canvas` directly when the current snapshot already contains the requested diagram')
      expect(codePrompt).toContain('export it directly without recreating or modifying shapes')
      expect(codePrompt).toContain('Do not export automatically when the user asked only for an editable diagram')
  
      const designPrompt = buildDesignTurnPrompt({
        target: 'canvas',
        mode: 'text',
        text: 'Map the code architecture',
        artifactRelativePath: '.kun-design/board/canvas.json',
        workspaceRoot: '/ws'
      })
      expect(designPrompt).not.toContain('MAP CODE / ARCHITECTURE / FLOW')
      expect(designPrompt).not.toContain('services/modules as frames or rects')
    })
    it('design canvas prompt keeps HTML-generation guidance for screen creation', () => {
      const prompt = buildDesignTurnPrompt({
        target: 'canvas',
        mode: 'text',
        text: 'Create a landing page screen',
        artifactRelativePath: '.kun-design/board/canvas.json',
        workspaceRoot: '/ws'
      })
  
      expect(prompt).toContain('BUILD A SINGLE SCREEN')
      expect(prompt).toContain('BUILD A COMPLETE MULTI-SCREEN EXPERIENCE')
      expect(prompt).toContain('The system auto-generates HTML afterwards')
      expect(prompt).toContain('the system will AUTOMATICALLY generate the HTML content')
      expect(prompt).not.toContain('Code sidebar whiteboard')
      expect(prompt).not.toContain('No HTML artifact is generated in Code mode')
    })
    it('code canvas prompt renders previous op errors for self-correction', () => {
      const prompt = buildCodeCanvasTurnPrompt({
        workspaceRoot: '/ws',
        previousOpErrors: [
          {
            code: 'PARENT_NOT_FOUND',
            message: 'Parent frame "missing_parent" was not found.',
            suggestion: 'Use an existing frame id from the snapshot.'
          }
        ]
      })
  
      expect(prompt).toContain('YOUR PREVIOUS canvas attempt had errors')
      expect(prompt).toContain('Parent frame "missing_parent" was not found.')
      expect(prompt).toContain('Use an existing frame id from the snapshot.')
      expect(prompt).toContain('Code-mode whiteboard override')
    })
    it('code canvas prompt uses only explicitly supplied design-system context', () => {
      const store = useDesignSystemStore.getState()
      store.resetSystem()
      store.setToken({ name: 'global/stale', kind: 'color', value: '#ef4444' })
  
      try {
        const promptWithoutContext = buildCodeCanvasTurnPrompt({ workspaceRoot: '/ws' })
        expect(promptWithoutContext).not.toContain('global/stale')
        expect(promptWithoutContext).not.toContain('#ef4444')
  
        const promptWithContext = buildCodeCanvasTurnPrompt({
          workspaceRoot: '/ws',
          canvasDesignSystem: {
            tokens: {
              'thread/primary': { name: 'thread/primary', kind: 'color', value: '#14b8a6' }
            },
            components: {}
          }
        })
        expect(promptWithContext).toContain('thread/primary')
        expect(promptWithContext).toContain('#14b8a6')
        expect(promptWithContext).not.toContain('global/stale')
      } finally {
        store.resetSystem()
      }
    })
    it('code canvas prompt honors the current app target', () => {
      const prompt = buildCodeCanvasTurnPrompt({
        workspaceRoot: '/ws',
        designContext: { designTarget: 'app' }
      })
  
      expect(prompt).toContain('Design target: App')
      expect(prompt).toContain('UI frame default is 390x844 phone portrait for explicit UI mockups only')
      expect(prompt).toContain('new 390x844 UI frame placeholders')
      expect(prompt).toContain('- Target: App')
    })
    it('includes placement guidance for new screen coordinates', () => {
      const doc = createEmptyDocument()
      const root = doc.objects[doc.rootId]
      const frame = createHtmlFrameShape('Home', 1160, 600, 'home', 'desktop')
      doc.objects[frame.id] = { ...frame, parentId: doc.rootId }
      doc.objects[doc.rootId] = { ...root, children: [frame.id] }
      const canvasSnapshot = snapshotCanvas(doc, new Set(), {
        viewBox: { x: 1000, y: 500, width: 1600, height: 1000 }
      })
  
      const prompt = buildDesignTurnPrompt({
        target: 'canvas',
        mode: 'text',
        text: 'Add settings page',
        artifactRelativePath: '.kun-design/board/canvas.json',
        workspaceRoot: '/workspace',
        canvasSnapshot
      })
  
      expect(prompt).toContain('The snapshot includes `placement`')
      expect(prompt).toContain('Before EVERY canvas tool call, inspect the current canvas snapshot below')
      expect(prompt).toContain('Preserve existing canvas objects unless the user explicitly asks to replace/delete them')
      expect(prompt).toContain('Do not place a new large object over an existing image or frame')
      expect(prompt).toContain('Treat ALL visible snapshot shapes as occupied canvas content')
      expect(prompt).toContain('The project design-system board is a fixed file projection')
      expect(prompt).toContain('new 1280x800 target screen frames')
      expect(prompt).toContain('prefer omitting `x`/`y`')
      expect(prompt).toContain('placement.recommendedSlots')
      expect(prompt).toContain('"recommendedSlots"')
      expect(prompt).toContain('"occupiedFrames"')
      expect(prompt).toContain('"x": 2520')
    })
    it('canvas turn prompt keeps empty holder rule intact (no imageUrl leaked, reference rule still gated)', () => {
      const doc = createEmptyDocument()
      const root = doc.objects[doc.rootId]
      const empty = createDefaultShape('image', 0, 0)
      doc.objects[empty.id] = { ...empty, parentId: doc.rootId }
      doc.objects[doc.rootId] = { ...root, children: [empty.id] }
      const canvasSnapshot = snapshotCanvas(doc, new Set([empty.id]))
  
      const prompt = buildDesignTurnPrompt({
        target: 'canvas',
        mode: 'text',
        text: 'Generate an image here',
        artifactRelativePath: '.kun-design/board/canvas.json',
        workspaceRoot: '/workspace',
        canvasSnapshot
      })
  
      const snapshotBlockStart = prompt.indexOf('```json')
      const snapshotBlockEnd = prompt.indexOf('```', snapshotBlockStart + 6)
      const snapshotBlock = prompt.slice(snapshotBlockStart, snapshotBlockEnd)
      expect(snapshotBlock).not.toContain('.deepseekgui-images/')
  
      expect(prompt).toContain('selected EMPTY `image` holder')
      expect(prompt).toContain('Editing or restyling an EXISTING image')
      expect(prompt).toContain(
        'Do NOT pass `reference_image_paths` when filling an empty `aiImageHolder`'
      )
    })
    it('canvas turn prompt qualifies the selected-image-holder rule to empty holders only', () => {
      const prompt = buildCodeCanvasTurnPrompt({ workspaceRoot: '/ws' })
      expect(prompt).toContain('selected EMPTY `image` holder (no `imageUrl` field in the snapshot)')
      expect(prompt).toContain('selected EMPTY `frame` or `rect` holder')
      expect(prompt).toContain('Do NOT add a child image')
      expect(prompt).toContain('STOP — this is an EDIT, not a fill')
      expect(prompt).not.toContain(
        'selected `image` (or an `image` holder): `generate_image` with `aspect_ratio`'
      )
    })
    it('canvas turn prompt routes frame/group containing one image child to the edit path', () => {
      const prompt = buildCodeCanvasTurnPrompt({ workspaceRoot: '/ws' })
      expect(prompt).toContain('Implicit target via container')
      expect(prompt).toContain('EXACTLY ONE `image` child with an `imageUrl`')
      expect(prompt).toContain('do NOT add a new image')
    })
    it('canvas turn prompt drops the unenforceable selection-order claim for multi-reference composition', () => {
      const prompt = buildCodeCanvasTurnPrompt({ workspaceRoot: '/ws' })
      expect(prompt).not.toContain('in selection order, capped at 4')
      expect(prompt).toContain('treated symmetrically')
      expect(prompt).toContain('order in the array is not load-bearing')
    })
    it('canvas turn prompt includes the verbatim-copy verification line for reference_image_paths', () => {
      const prompt = buildCodeCanvasTurnPrompt({ workspaceRoot: '/ws' })
      expect(prompt).toContain(
        'Before constructing `reference_image_paths`, locate each target shape in the snapshot by its `id` and copy its `imageUrl` verbatim'
      )
      expect(prompt).toContain(
        'do not guess or reconstruct a path from the shape name, position, or any other field'
      )
    })
    it('carries default web target sizing into image-node prompts', () => {
      const prompt = buildDesignImageNodePrompt({
        text: 'Product preview',
        outputRelativePath: '.kun-design/doc/preview.png',
        workspaceRoot: '/workspace'
      })
  
      expect(prompt).toContain('Design target: Web')
      expect(prompt).toContain('1280x800 responsive web page')
      expect(prompt).toContain('- Target: Web')
    })
    it('tells the agent the canvas.json directory on a canvas turn', () => {
      const prompt = buildDesignTurnPrompt({
        target: 'canvas',
        mode: 'text',
        text: 'Tidy up the selected layers',
        artifactRelativePath: '.kun-design/board/canvas.json',
        workspaceRoot: '/workspace',
        contextLocations: [
          {
            title: 'Design canvas',
            kind: 'canvas',
            path: '.kun-design/board/canvas.json',
            directory: '.kun-design/board'
          }
        ]
      })
  
      expect(prompt).toContain('Selected on the canvas (the user is pointing at these)')
      expect(prompt).toContain('Design canvas [canvas] → `.kun-design/board/canvas.json` (directory: `.kun-design/board`)')
    })
})
