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

describe("design turn prompt HTML, screen, and canvas guidance", () => {
    it('builds a parallel page fanout prompt with one delegate_task per artifact', () => {
      const prompt = buildParallelDesignPagesPrompt({
        workspaceRoot: '/workspace',
        projectBrief: 'IKUN community site',
        jobs: [
          {
            artifactId: 'landing',
            title: 'Landing',
            relativePath: '.kun-design/doc/landing/v1.html',
            designMdPath: '.kun-design/doc/landing/DESIGN.md',
            brief: 'Hero, featured movies, footer',
            screenManifest: []
          },
          {
            artifactId: 'community',
            title: 'Community',
            relativePath: '.kun-design/doc/community/v1.html',
            designMdPath: '.kun-design/doc/community/DESIGN.md',
            brief: 'Community feed and member stories',
            screenManifest: [{ name: 'Design system', htmlPath: '.kun-design/doc/system/v1.html', role: 'design-system' }]
          }
        ]
      })
  
      expect(prompt).toContain('delegate_task')
      expect(prompt).toContain('SAME assistant message')
      expect(prompt).toContain('"profile": "general"')
      expect(prompt).toContain('"detach": false')
      expect(prompt).toContain('label: page:landing')
      expect(prompt).toContain('label: page:community')
      expect(prompt).toContain('Act as the design director for the fanout')
      expect(prompt).toContain('real content, concrete states, and a clear primary action')
      expect(prompt).toContain('Design target: Web')
      expect(prompt).toContain('1280x800 desktop web')
      expect(prompt).toContain('Modify ONLY `.kun-design/doc/landing/v1.html` and `.kun-design/doc/landing/DESIGN.md`')
      expect(prompt).toContain('Modify ONLY `.kun-design/doc/community/v1.html` and `.kun-design/doc/community/DESIGN.md`')
      expect(prompt).toContain('Design delivery checklist')
      expect(prompt).toContain('Do NOT modify sibling files')
    })
    it('carries the selected app target into every parallel page child prompt', () => {
      const prompt = buildParallelDesignPagesPrompt({
        workspaceRoot: '/workspace',
        projectBrief: 'A habit tracker app',
        designContext: { designTarget: 'app' },
        jobs: [
          {
            artifactId: 'home',
            title: 'Today',
            relativePath: '.kun-design/doc/today/v1.html',
            designMdPath: '.kun-design/doc/today/DESIGN.md',
            brief: 'Today screen with habit streaks and check-ins',
            screenManifest: []
          }
        ]
      })
  
      expect(prompt).toContain('label: page:home')
      expect(prompt).toContain('Design target: App')
      expect(prompt).toContain('390x844 phone portrait')
      expect(prompt).toContain('mobile app screens')
      expect(prompt).not.toContain('Design target: Web')
      expect(prompt.indexOf('Design target: App')).toBeLessThan(prompt.indexOf('Job 1: Today'))
    })
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
      expect(prompt).toContain('Design target: Web')
      expect(prompt).toContain('1280x800 desktop web')
      expect(prompt).toContain(
        'Modify ONLY `.kun-design/screen/v1.html` and `.kun-design/screen/DESIGN.md`'
      )
      expect(prompt).toContain('it has already been pre-created')
      expect(prompt).toContain('responsive to arbitrary canvas frame sizes')
      expect(prompt).not.toContain('HTML iteration discipline')
      expect(prompt).toContain('Resize-adaptive HTML contract')
      expect(prompt).toContain('Treat the canvas frame/webview as a live, resizable viewport')
      expect(prompt).toContain('Do not lock the page to a fixed desktop canvas')
      expect(prompt).toContain('Secondary action path')
      expect(prompt).toContain('Brand navigation')
      expect(prompt).toContain('Product shell')
      expect(prompt).toContain('Visual anchor')
      expect(prompt).toContain('Product preview detail')
      expect(prompt).toContain('Trust proof')
      expect(prompt).toContain('Testimonial attribution')
      expect(prompt).toContain('Feature anatomy')
      expect(prompt).toContain('Portfolio/case-study anatomy')
      expect(prompt).toContain('Pricing anatomy')
      expect(prompt).toContain('Conversion close')
      expect(prompt).toContain('FAQ anatomy')
      expect(prompt).toContain('Lead form response')
      expect(prompt).toContain('Site footer')
      expect(prompt).toContain('First-screen hierarchy')
      expect(prompt).toContain('Hero viewport composition')
      expect(prompt).toContain('Prototype coherence')
      expect(prompt).toContain('Content realism')
      expect(prompt).toContain('no dead `href="#"` links or visual-only buttons')
      expect(prompt).toContain('Handoff notes')
    })
    it('biases screen prompts toward mobile app frames when the design target is app', () => {
      const options: ScreenTurnOptions = {
        target: 'screen',
        mode: 'text',
        text: 'Create a habit detail screen',
        artifactRelativePath: '.kun-design/habit/v1.html',
        workspaceRoot: '/workspace',
        screenName: 'Habit Detail',
        screenManifest: [],
        designContext: { designTarget: 'app' }
      }
      const prompt = buildDesignTurnPrompt(options)
  
      expect(prompt).toContain('Design target: App')
      expect(prompt).toContain('390x844 phone portrait')
      expect(prompt).toContain('mobile app screens')
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
        screenSizeMode: 'manual',
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
      expect(prompt).toContain('Canvas frame context: "Login"')
      expect(prompt).toContain('420x340 canvas pixels, sizeMode: manual')
      expect(prompt).toContain('Treat the selected frame size above as the real webview viewport')
      expect(prompt).toContain('Design notes file: .kun-design/screen/DESIGN.md')
      expect(prompt).toContain('Modify ONLY `.kun-design/screen/v2.html` and `.kun-design/screen/DESIGN.md`')
      expect(prompt).toContain('responsive to arbitrary selected frame sizes')
      expect(prompt).toContain('arbitrary resized frame sizes')
      expect(prompt).toContain('"Home" (1280x720)')
      expect(prompt).toContain('.kun-design/home/v1.html')
    })
    it('injects real frame dimensions into HTML iteration prompts', () => {
      const prompt = buildDesignTurnPrompt({
        target: 'html',
        mode: 'text',
        text: 'Continue the design system page',
        artifactRelativePath: '.kun-design/system/v2.html',
        designNotesPath: '.kun-design/system/DESIGN.md',
        basePath: '.kun-design/system/v1.html',
        workspaceRoot: '/workspace',
        frameContext: {
          name: 'Design system',
          width: 1330,
          height: 1040,
          sizeMode: 'auto'
        }
      })
  
      expect(prompt).toContain('Canvas frame context: "Design system"')
      expect(prompt).toContain('1330x1040 canvas pixels, sizeMode: auto')
      expect(prompt).toContain('real webview viewport')
      expect(prompt).toContain('do not shrink the design')
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
      expect(prompt).toContain('"Home" → .kun-design/home/v1.html (prototype href: ../home/v1.html) — Landing page')
      expect(prompt).toContain('"Chat" (420x720) → .kun-design/chat/v1.html (prototype href: ../chat/v1.html)')
      expect(prompt).toContain('Prototype link markup contract')
      expect(prompt).toContain('Use `<a href="...">` for navigation items')
      expect(prompt).toContain('data-prototype-href')
      expect(prompt).toContain('data-prototype-target="Exact Screen Title"')
      expect(prompt).toContain('history.pushState')
      expect(prompt).toContain('history.replaceState')
      expect(prompt).toContain('history.back()')
      expect(prompt).toContain('history.go(-1)')
      expect(prompt).toContain('role="button"` or `role="tab"')
      expect(prompt).toContain('tabindex="0"')
      expect(prompt).toContain('Do NOT modify sibling files')
    })
    it('computes local prototype hrefs between generated HTML artifacts', () => {
      expect(buildPrototypeHref('.kun-design/doc/settings/v1.html', '.kun-design/doc/home/v1.html')).toBe('../home/v1.html')
      expect(buildPrototypeHref('.kun-design/doc/a/b/v1.html', '.kun-design/doc/c/v1.html')).toBe('../../c/v1.html')
      expect(buildPrototypeHref(undefined, '.kun-design/doc/home/v1.html')).toBe('.kun-design/doc/home/v1.html')
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
      expect(prompt).toContain('HTML iteration discipline')
      expect(prompt).toContain('prefer surgical `edit` calls over full rewrites')
      expect(prompt).toContain('Preserve unrelated DOM order')
      expect(prompt).toContain('existing prototype links')
      expect(prompt).toContain(
        'Selected-element edit: locate `body > main:nth-of-type(1) > h1:nth-of-type(1)`'
      )
      expect(prompt).toContain('Do not duplicate, relocate, or restyle unrelated sections')
    })
    it('adds iteration edit discipline for existing screen edits without requiring an element selection', () => {
      const options: ScreenTurnOptions = {
        target: 'screen',
        mode: 'text',
        text: 'Tighten the pricing card spacing',
        artifactRelativePath: '.kun-design/pricing/v2.html',
        basePath: '.kun-design/pricing/v1.html',
        workspaceRoot: '/workspace',
        screenName: 'Pricing',
        screenManifest: []
      }
      const prompt = buildDesignTurnPrompt(options)
  
      expect(prompt).toContain('HTML iteration discipline')
      expect(prompt).toContain('read the current design first')
      expect(prompt).toContain('CSS variables')
      expect(prompt).toContain('media queries')
      expect(prompt).not.toContain('Selected-element edit:')
    })
    it('injects previous HTML quality findings into iteration prompts', () => {
      const prompt = buildDesignTurnPrompt({
        target: 'html',
        mode: 'text',
        text: 'Polish the page',
        artifactRelativePath: '.kun-design/screen/v2.html',
        basePath: '.kun-design/screen/v1.html',
        workspaceRoot: '/workspace',
        qualityFindings: [
          {
            code: 'placeholder-content',
            severity: 'warning',
            message: 'The page still contains placeholders.',
            suggestion: 'Replace them with realistic domain copy.'
          }
        ]
      })
  
      expect(prompt).toContain('Previous version quality audit')
      expect(prompt).toContain('placeholder-content')
      expect(prompt).toContain('Replace them with realistic domain copy')
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
    it('renders per-sibling accent + font + summary in the screen manifest', () => {
      const prompt = buildDesignTurnPrompt({
        target: 'html',
        mode: 'text',
        text: 'a settings page',
        artifactRelativePath: '.kun-design/doc/p/v1.html',
        workspaceRoot: '/ws',
        screenManifest: [
          {
            name: 'Home',
            htmlPath: '.kun-design/doc/home/v1.html',
            summary: 'A teal landing page',
            accent: '#3b82d8',
            fontFamily: 'Inter'
          }
        ]
      })
      expect(prompt).toContain('accent #3b82d8')
      expect(prompt).toContain('font Inter')
      expect(prompt).toContain('— A teal landing page')
    })
    it('injects extracted design tokens (palette + type scale) into HTML turns for cohesion', () => {
      const prompt = buildDesignTurnPrompt({
        target: 'html',
        mode: 'text',
        text: 'a pricing page',
        artifactRelativePath: '.kun-design/doc/p/v1.html',
        workspaceRoot: '/ws',
        derivedTokens: {
          extracted: { colors: [], fonts: [], radii: [], spacing: [], typeScale: [], sampledColors: [], title: '' },
          palette: { primary: { base: '#3b82d8', ramp: [] }, neutral: { base: '#6b7280', ramp: [] } },
          typeRows: [
            { label: 'H1', sample: '', fontSize: '28px', fontWeight: '700', lineHeight: '1.2', fontFamily: 'Inter, sans-serif', px: 28 },
            { label: 'Body', sample: '', fontSize: '16px', fontWeight: '400', lineHeight: '1.6', fontFamily: 'Inter, sans-serif', px: 16 }
          ]
        }
      })
      expect(prompt).toContain('Existing design tokens to REUSE')
      expect(prompt).toContain('accent #3b82d8')
      expect(prompt).toContain('H1 28/700')
      expect(prompt).toContain('font Inter')
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
  
      // The intent-triage lanes are hoisted ABOVE the screen-creation vocabulary so the
      // model commits to the image-edit lane before screen creation can pre-empt it.
      const lanesAt = prompt.indexOf('FIRST classify the request')
      const createScreenAt = prompt.indexOf('Dedicated design tool schemas:')
      expect(lanesAt).toBeGreaterThanOrEqual(0)
      expect(createScreenAt).toBeGreaterThan(lanesAt)
  
      expect(prompt).toContain('EDIT AN EXISTING IMAGE')
      expect(prompt).toContain('Preserve the selected source shape and URL')
      expect(prompt).toContain('same-size revision beside it')
      expect(prompt).toContain('Do NOT call design_update_shapes for the generated URL')
  
      // Deterministic prior: the renderer pre-classifies the single selected filled
      // image and states it up front (with the exact id + path), hoisted ABOVE the
      // lane list, so a terse "task" brief can't drag it toward a new HTML screen.
      expect(prompt).toContain('IMPORTANT PRIOR')
      expect(prompt).toContain('EXACTLY ONE filled source image selected')
      expect(prompt).toContain('.deepseekgui-images/shot.png')
      expect(prompt.indexOf('IMPORTANT PRIOR')).toBeLessThan(lanesAt)
    })
    it('uses an annotation reference without changing the visible source anchor', () => {
      const doc = createEmptyDocument()
      const root = doc.objects[doc.rootId]
      const image = createDefaultShape('image', 50, 60)
      image.imageUrl = '.kun/images/source.png'
      doc.objects[image.id] = { ...image, parentId: doc.rootId }
      doc.objects[doc.rootId] = { ...root, children: [image.id] }
      const prompt = buildDesignTurnPrompt({
        target: 'canvas',
        mode: 'text',
        text: '按批注修改',
        artifactRelativePath: '.kun-design/board/canvas.json',
        workspaceRoot: '/workspace',
        canvasSnapshot: snapshotCanvas(doc, new Set([image.id])),
        imageEditReferencePath: '.deepseekgui-images/annotated.png'
      })

      expect(prompt).toContain('reference_image_paths: [".deepseekgui-images/annotated.png"]')
      expect(prompt).toContain('imageUrl `.kun/images/source.png`')
      expect(prompt).toContain('Preserve the selected source shape and URL')
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
    it('tells the agent to reuse a selected empty frame for new pages', () => {
      const doc = createEmptyDocument()
      const root = doc.objects[doc.rootId]
      const frame = createDefaultShape('frame', -1724, -2410)
      frame.name = 'Frame'
      frame.width = 1834
      frame.height = 930
      doc.objects[frame.id] = { ...frame, parentId: doc.rootId }
      doc.objects[doc.rootId] = { ...root, children: [frame.id] }
      const canvasSnapshot = snapshotCanvas(doc, new Set([frame.id]))

      const prompt = buildDesignTurnPrompt({
        target: 'canvas',
        mode: 'text',
        text: '设计一个介绍页面',
        artifactRelativePath: '.kun-design/board/canvas.json',
        workspaceRoot: '/workspace',
        canvasSnapshot
      })

      expect(prompt).toContain('If exactly one empty `frame` is selected')
      expect(prompt).toContain('WITHOUT x/y/width/height')
      expect(prompt).toContain('convert that selected canvas frame into the HTML screen')
    })
    it('lists multiple selected shapes explicitly in the canvas prompt', () => {
      const doc = createEmptyDocument()
      const root = doc.objects[doc.rootId]
      const a = createDefaultShape('rect', 0, 0)
      a.name = 'Card A'
      const b = createDefaultShape('text', 0, 0)
      b.name = 'Label B'
      doc.objects[a.id] = { ...a, parentId: doc.rootId }
      doc.objects[b.id] = { ...b, parentId: doc.rootId }
      doc.objects[doc.rootId] = { ...root, children: [a.id, b.id] }
      const canvasSnapshot = snapshotCanvas(doc, new Set([a.id, b.id]))
  
      const prompt = buildDesignTurnPrompt({
        target: 'canvas',
        mode: 'text',
        text: 'align these',
        artifactRelativePath: '.kun-design/board/canvas.json',
        workspaceRoot: '/ws',
        canvasSnapshot
      })
      expect(prompt).toContain('2 shapes selected')
      expect(prompt).toContain('Card A')
      expect(prompt).toContain('Label B')
    })
    it('explains sampled line points and per-shape omitted vertices in canvas snapshots', () => {
      const doc = createEmptyDocument()
      const root = doc.objects[doc.rootId]
      const draw = createDefaultShape('draw', 10, 20)
      draw.points = Array.from({ length: 120 }, (_, index) => ({ x: index, y: 0 }))
      doc.objects[draw.id] = { ...draw, parentId: doc.rootId }
      doc.objects[doc.rootId] = { ...root, children: [draw.id] }
      const canvasSnapshot = snapshotCanvas(doc, new Set([draw.id]))
  
      const prompt = buildDesignTurnPrompt({
        target: 'canvas',
        mode: 'text',
        text: 'smooth this stroke',
        artifactRelativePath: '.kun-design/board/canvas.json',
        workspaceRoot: '/ws',
        canvasSnapshot
      })
  
      expect(prompt).toContain('sampled absolute `points` for arrows/lines/freehand')
      expect(prompt).toContain('`pointsOmitted` when extra vertices were compacted')
      expect(prompt).toContain('"pointsOmitted": 72')
    })
    it('injects stashed canvas critique findings into the next canvas prompt once', () => {
      setLastLintFindings([
        {
          code: 'low-contrast',
          shapeId: 'text_1',
          message: '"Label" text #94a3b8 on #ffffff is 2.5:1 — below WCAG AA 4.5:1.'
        }
      ])
  
      const prompt = buildDesignTurnPrompt({
        target: 'canvas',
        mode: 'text',
        text: 'fix critique findings',
        artifactRelativePath: '.kun-design/board/canvas.json',
        workspaceRoot: '/ws'
      })
  
      expect(prompt).toContain('Design-system lint flagged 1 issue(s)')
      expect(prompt).toContain('[low-contrast] (text_1)')
      expect(prompt).toContain('below WCAG AA 4.5:1')
  
      const nextPrompt = buildDesignTurnPrompt({
        target: 'canvas',
        mode: 'text',
        text: 'another turn',
        artifactRelativePath: '.kun-design/board/canvas.json',
        workspaceRoot: '/ws'
      })
      expect(nextPrompt).not.toContain('Design-system lint flagged')
    })
})
