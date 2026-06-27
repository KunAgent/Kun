import { describe, expect, it } from 'vitest'
import { buildCodeCanvasTurnPrompt, buildDesignTurnPrompt } from './design-turn-prompt'
import type { ScreenTurnOptions } from './design-turn-prompt'
import { snapshotCanvas } from './canvas/canvas-snapshot'
import { createDefaultShape, createEmptyDocument } from './canvas/canvas-types'

describe('design turn prompt', () => {
  it('allows only the reserved HTML and companion design notes files for HTML turns', () => {
    const prompt = buildDesignTurnPrompt({
      target: 'html',
      mode: 'text',
      text: 'Create a polished hero page',
      artifactRelativePath: '.kun-design/screen/v1.html',
      designNotesPath: '.kun-design/screen/DESIGN.md',
      workspaceRoot: '/workspace'
    })

    expect(prompt).toContain('Design notes file: .kun-design/screen/DESIGN.md')
    expect(prompt).toContain(
      'Modify ONLY `.kun-design/screen/v1.html` and `.kun-design/screen/DESIGN.md`'
    )
    expect(prompt).toContain('it has already been pre-created')
    expect(prompt).toContain('responsive to arbitrary canvas frame sizes')
  })

  it('passes selected screen frame details and notes file for screen turns', () => {
    const options: ScreenTurnOptions = {
      target: 'screen',
      mode: 'text',
      text: 'Make this a login page',
      artifactRelativePath: '.kun-design/screen/v2.html',
      designNotesPath: '.kun-design/screen/DESIGN.md',
      basePath: '.kun-design/screen/v1.html',
      workspaceRoot: '/workspace',
      screenName: 'Login',
      screenWidth: 420,
      screenHeight: 340,
      screenManifest: [
        {
          name: 'Home',
          width: 1280,
          height: 720,
          htmlPath: '.kun-design/home/v1.html'
        }
      ]
    }
    const prompt = buildDesignTurnPrompt(options)

    expect(prompt).toContain('Selected screen frame: 420x340 canvas pixels.')
    expect(prompt).toContain('Design notes file: .kun-design/screen/DESIGN.md')
    expect(prompt).toContain('Modify ONLY `.kun-design/screen/v2.html` and `.kun-design/screen/DESIGN.md`')
    expect(prompt).toContain('responsive to arbitrary selected frame sizes')
    expect(prompt).toContain('"Home" (1280x720)')
    expect(prompt).toContain('.kun-design/home/v1.html')
  })

  it('includes sibling pages so HTML turns stay cohesive across the canvas', () => {
    const prompt = buildDesignTurnPrompt({
      target: 'html',
      mode: 'text',
      text: 'Design a settings page',
      artifactRelativePath: '.kun-design/settings/v1.html',
      workspaceRoot: '/workspace',
      screenManifest: [
        { name: 'Home', htmlPath: '.kun-design/home/v1.html', summary: 'Landing page' },
        { name: 'Chat', width: 420, height: 720, htmlPath: '.kun-design/chat/v1.html' }
      ]
    })

    expect(prompt).toContain('Other pages already in this project')
    expect(prompt).toContain('"Home" → .kun-design/home/v1.html — Landing page')
    expect(prompt).toContain('"Chat" (420x720) → .kun-design/chat/v1.html')
    expect(prompt).toContain('Do NOT modify sibling files')
  })

  it('includes selected HTML element context for focused edits', () => {
    const prompt = buildDesignTurnPrompt({
      target: 'html',
      mode: 'text',
      text: 'Change this to a warmer headline',
      artifactRelativePath: '.kun-design/screen/v2.html',
      designNotesPath: '.kun-design/screen/DESIGN.md',
      basePath: '.kun-design/screen/v1.html',
      workspaceRoot: '/workspace',
      htmlElementContext: {
        artifactId: 'screen',
        artifactTitle: 'Welcome page',
        artifactRelativePath: '.kun-design/screen/v1.html',
        selector: 'body > main:nth-of-type(1) > h1:nth-of-type(1)',
        tagName: 'H1',
        text: 'Hello World',
        html: '<h1 class="hero-title">Hello World</h1>'
      }
    })

    expect(prompt).toContain('Selected HTML element context:')
    expect(prompt).toContain('CSS selector: body > main:nth-of-type(1) > h1:nth-of-type(1)')
    expect(prompt).toContain('Tag: <h1>')
    expect(prompt).toContain('Current text: Hello World')
    expect(prompt).toContain('Treat this selected element as the binding target')
  })

  it('tells the agent the path + directory of selected design artifacts (no inlined content)', () => {
    const prompt = buildDesignTurnPrompt({
      target: 'html',
      mode: 'text',
      text: 'Match this page to the canvas',
      artifactRelativePath: '.kun-design/board/settings/v1.html',
      workspaceRoot: '/workspace',
      contextLocations: [
        {
          title: 'Settings',
          kind: 'html',
          path: '.kun-design/board/settings/v1.html',
          directory: '.kun-design/board/settings'
        },
        {
          title: 'Hero',
          kind: 'image',
          path: '.deepseekgui-images/hero.png',
          directory: '.deepseekgui-images'
        }
      ]
    })

    expect(prompt).toContain('Selected on the canvas (the user is pointing at these)')
    expect(prompt).toContain('do not inline them wholesale')
    expect(prompt).toContain('Settings [html] → `.kun-design/board/settings/v1.html` (directory: `.kun-design/board/settings`)')
    expect(prompt).toContain('Hero [image] → `.deepseekgui-images/hero.png` (directory: `.deepseekgui-images`)')
  })

  it('canvas turn prompt instructs reference_image_paths when a selected image has imageUrl', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const img = createDefaultShape('image', 50, 60)
    img.imageUrl = '.deepseekgui-images/old.png'
    img.width = 200
    img.height = 200
    doc.objects[img.id] = { ...img, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [img.id] }
    const canvasSnapshot = snapshotCanvas(doc, new Set([img.id]))

    const prompt = buildDesignTurnPrompt({
      target: 'canvas',
      mode: 'text',
      text: '把这张图改成夜晚风格',
      artifactRelativePath: '.kun-design/board/canvas.json',
      workspaceRoot: '/workspace',
      canvasSnapshot
    })

    expect(prompt).toContain('reference_image_paths')
    expect(prompt).toContain('Editing or restyling an EXISTING image')
    expect(prompt).toContain('`imageUrl` for filled image shapes')
    expect(prompt).toContain('.deepseekgui-images/old.png')
    expect(prompt).toContain(
      'Do NOT pass `reference_image_paths` when filling an empty `aiImageHolder`'
    )
  })

  it('steers a selected filled image + change verb to image editing, not a new HTML screen', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const img = createDefaultShape('image', 50, 60)
    img.imageUrl = '.deepseekgui-images/shot.png'
    img.width = 1280
    img.height = 800
    doc.objects[img.id] = { ...img, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [img.id] }
    const canvasSnapshot = snapshotCanvas(doc, new Set([img.id]))

    // The user's real phrasing: ambiguous "把我的设计改成task" with the screenshot
    // selected. It must edit the image, not create a new screen and build HTML.
    const prompt = buildDesignTurnPrompt({
      target: 'canvas',
      mode: 'text',
      text: '把我的设计改成task',
      artifactRelativePath: '.kun-design/board/canvas.json',
      workspaceRoot: '/workspace',
      canvasSnapshot
    })

    // The intent-triage lanes are hoisted ABOVE the add_screen vocabulary so the
    // model commits to the image-edit lane before screen creation can pre-empt it.
    const lanesAt = prompt.indexOf('FIRST classify the request')
    const addScreenAt = prompt.indexOf('"action": "add_screen"')
    expect(lanesAt).toBeGreaterThanOrEqual(0)
    expect(addScreenAt).toBeGreaterThan(lanesAt)

    expect(prompt).toContain('EDIT AN EXISTING IMAGE')
    expect(prompt).toContain('MUST NOT use `add_screen` / `add-screen`')
    expect(prompt).toContain('把这张图改成…')
    expect(prompt).toContain('do NOT `add_screen` / `add-screen` — edit that image instead')

    // Deterministic prior: the renderer pre-classifies the single selected filled
    // image and states it up front (with the exact id + path), hoisted ABOVE the
    // lane list, so a terse "task" brief can't drag it toward a new HTML screen.
    expect(prompt).toContain('IMPORTANT PRIOR')
    expect(prompt).toContain('EXACTLY ONE filled image selected')
    expect(prompt).toContain('.deepseekgui-images/shot.png')
    expect(prompt.indexOf('IMPORTANT PRIOR')).toBeLessThan(lanesAt)
  })

  it('does NOT emit the edit-image prior when the selection is ambiguous (multi-select or empty holder)', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const a = createDefaultShape('image', 0, 0)
    a.imageUrl = '.deepseekgui-images/a.png'
    const b = createDefaultShape('image', 0, 0)
    b.imageUrl = '.deepseekgui-images/b.png'
    doc.objects[a.id] = { ...a, parentId: doc.rootId }
    doc.objects[b.id] = { ...b, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [a.id, b.id] }
    const canvasSnapshot = snapshotCanvas(doc, new Set([a.id, b.id]))

    const prompt = buildDesignTurnPrompt({
      target: 'canvas',
      mode: 'text',
      text: 'do something',
      artifactRelativePath: '.kun-design/board/canvas.json',
      workspaceRoot: '/workspace',
      canvasSnapshot
    })
    expect(prompt).not.toContain('IMPORTANT PRIOR')
  })

  it('canvas turn prompt frames screen creation as a design_canvas tool call', () => {
    const prompt = buildCodeCanvasTurnPrompt({ workspaceRoot: '/ws' })
    expect(prompt).toContain('calling the `design_canvas` tool')
    expect(prompt).toContain('Do not ask the user to manually create a canvas first')
    expect(prompt).toContain('{ "action": "add_screen"')
    expect(prompt).toContain('```design_canvas')
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
