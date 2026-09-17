import { describe, expect, it } from 'vitest'
import { buildDesignTurnPrompt } from './design-turn-prompt'

describe('design turn prompt design mode context', () => {
  it('routes single-screen and complete multi-screen requests without a forced workflow', () => {
    const prompt = buildDesignTurnPrompt({
      target: 'canvas',
      mode: 'text',
      text: '做一套完整 CRM，包括登录、工作台、客户详情和设置',
      artifactRelativePath: '.kun-design/doc/board.canvas.json',
      workspaceRoot: '/workspace'
    })

    expect(prompt).toContain('BUILD A SINGLE SCREEN')
    expect(prompt).toContain('BUILD A COMPLETE MULTI-SCREEN EXPERIENCE')
    expect(prompt).toContain('one `design_create_screen` call with a `screens` array')
    expect(prompt).toContain('DESIGN FOUNDATION GUIDANCE')
    expect(prompt).toContain('normally call `design_system` with `operation: "create"` before `design_create_screen`')
    expect(prompt).toContain('This is a preferred sequence, not a hard gate')
    expect(prompt).toContain('DESIGN-SYSTEM CLAIMS MUST BE FACTUAL')
    expect(prompt).toContain('Per-screen `.kun-design/.../DESIGN.md` notes')
    expect(prompt).toContain('ask one concise question with `user_input`')
    expect(prompt).toContain('prefer the fewest calls')
    expect(prompt).not.toContain('Design mode workflow contract:')
    expect(prompt).not.toContain('Suggested tool call: design.plan')
    expect(prompt).not.toContain('design.ops')
    expect(prompt).not.toContain('MANY focused calls')
    expect(prompt).not.toContain('Reply with a short plain-text plan')
  })

  it('keeps the design-mode workflow contract out of the code whiteboard prompt', () => {
    const prompt = buildDesignTurnPrompt({
      target: 'canvas',
      mode: 'text',
      text: 'Sketch an API flow',
      artifactRelativePath: '.kun-design/doc/board.canvas.json',
      workspaceRoot: '/workspace',
      canvasSurface: 'code'
    })

    expect(prompt).not.toContain('Design mode workflow contract:')
    expect(prompt).not.toContain('BUILD A COMPLETE MULTI-SCREEN EXPERIENCE')
    expect(prompt).not.toContain('DESIGN FOUNDATION GUIDANCE')
    expect(prompt).not.toContain('DESIGN-SYSTEM CLAIMS MUST BE FACTUAL')
    expect(prompt).toContain('Code sidebar whiteboard')
  })

  it('advertises root DESIGN.md only with an exact valid source hash', () => {
    const base = {
      target: 'canvas' as const,
      mode: 'text' as const,
      text: 'Design a settings screen',
      artifactRelativePath: '.kun-design/doc/board.canvas.json',
      workspaceRoot: '/workspace',
      canvasDesignSystem: {
        tokens: {
          'color.primary': { name: 'color.primary', kind: 'color' as const, value: '#6750a4' }
        },
        components: {}
      }
    }

    const withSource = buildDesignTurnPrompt({
      ...base,
      projectDesignMdSourceHash: 'sha256:exact-source'
    })
    expect(withSource).toContain('Project design system: DESIGN.md')
    expect(withSource).toContain('sha256:exact-source')
    expect(withSource).toContain('expectedHash')
    expect(withSource).toContain('Do not replace it with an HTML/SVG style guide')

    const withoutSource = buildDesignTurnPrompt(base)
    expect(withoutSource).not.toContain('Project design system: DESIGN.md')
    expect(withoutSource).not.toContain('Current exact source hash:')
    expect(withoutSource).not.toContain('sha256:exact-source')
  })

  it('replaces the ShapeOps manual with an Excalidraw element summary', () => {
    const prompt = buildDesignTurnPrompt({
      target: 'canvas',
      mode: 'text',
      text: 'What does this sketch show?',
      artifactRelativePath: '.kun-design/doc/board.canvas.json',
      workspaceRoot: '/workspace',
      canvasEngine: 'excalidraw',
      excalidrawScene: {
        elements: [
          { type: 'arrow', isDeleted: false },
          { type: 'text', text: 'Checkout', isDeleted: false }
        ]
      }
    })
    expect(prompt).toContain('Excalidraw sketch')
    expect(prompt).toContain('Do not call design_update_shapes')
    expect(prompt).toContain('Checkout')
    expect(prompt).not.toContain('design_update_shapes: { "ops"')
    expect(prompt).not.toContain('Current canvas snapshot')
  })
})
