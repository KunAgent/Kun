import { describe, expect, it } from 'vitest'
import { PLAN_MODE_INSTRUCTION } from './plan-mode.js'
import { DESIGN_MODE_INSTRUCTION, SVG_ARTIFACT_MODE_INSTRUCTION } from './design-mode.js'
import { DESIGN_CANVAS_MODE_INSTRUCTION } from './design-canvas-mode.js'
import { DESIGN_HTML_PAGE_MODE_INSTRUCTION } from './design-html-page-mode.js'
import { WORK_MODE_INSTRUCTION } from './work-mode.js'
import { buildTurnModeInstruction } from './turn-mode-instruction.js'

describe('buildTurnModeInstruction', () => {
  it('activates Work policy without replacing an additional turn mode', () => {
    expect(buildTurnModeInstruction({
      agentSurface: 'write', orchestration: 'direct'
    }, true)).toBe(`${WORK_MODE_INSTRUCTION}\n\n${PLAN_MODE_INSTRUCTION}`)
  })

  it('gives room reviews scoped result guidance without the standalone plan workflow', () => {
    const instruction = buildTurnModeInstruction({ orchestration: 'direct' }, true, { roomId: 'room', memberId: 'reviewer', kind: 'review', blockedToolNames: [], blockedProviderIds: [], blockedSkillIds: [] })
    expect(instruction).toContain('submit_room_review')
    expect(instruction).toContain('do not modify source files')
    expect(instruction).not.toContain('call the `create_plan` tool')
  })

  it('emits no surface policy for an ordinary Code turn', () => {
    expect(buildTurnModeInstruction({ orchestration: 'direct' }, false)).toBe('')
  })

  const profile = { documentTarget: { documentId: 'doc', boardArtifactId: 'board' } }
  const page = (artifactId: string) => ({
    agentSurface: 'design' as const,
    orchestration: 'direct' as const,
    designProfile: profile,
    guiDesignArtifact: { kind: 'html', artifactId, relativePath: `.kun-design/doc/${artifactId}/v1.html` }
  })

  it('gives a reserved page turn the page policy instead of the canvas classifier', () => {
    const instruction = buildTurnModeInstruction(page('a1'), false)
    expect(instruction).toBe(DESIGN_HTML_PAGE_MODE_INSTRUCTION)
    expect(instruction).toContain('owns one already-reserved HTML file')
    expect(instruction).toContain('Resize-adaptive HTML contract')
    expect(instruction).toContain('Prototype link markup contract')
    expect(instruction).toContain('Design delivery checklist')
    expect(instruction).toContain('Design craft')
    expect(instruction).not.toContain('design_create_screen')
  })

  it('keeps the page policy identical across pages so a batch reuses it', () => {
    expect(buildTurnModeInstruction(page('a1'), false)).toBe(buildTurnModeInstruction(page('a2'), false))
  })

  it('gives Design-surface canvas turns the classifier plus the canvas reference', () => {
    const instruction = buildTurnModeInstruction({
      agentSurface: 'design', orchestration: 'direct', designProfile: profile,
      guiDesignCanvas: true, guiDesignMode: true
    }, false)
    expect(instruction).toBe(DESIGN_CANVAS_MODE_INSTRUCTION)
    expect(instruction.startsWith(DESIGN_MODE_INSTRUCTION)).toBe(true)
    expect(instruction).toContain('FIRST classify the request')
    expect(instruction).toContain('ShapeOp vocabulary')
    expect(instruction).toContain("for new target screen frames at the design target's default frame size")
    expect(instruction).toContain('Example response shape:')
    expect(instruction).not.toContain('Code sidebar whiteboard')
  })

  it('keeps the classifier for other profiled Design turns and the SVG policy for SVG turns', () => {
    expect(buildTurnModeInstruction({
      agentSurface: 'design', orchestration: 'direct', designProfile: profile
    }, false)).toBe(DESIGN_MODE_INSTRUCTION)
    expect(buildTurnModeInstruction({
      agentSurface: 'design', orchestration: 'direct', designProfile: profile, guiDesignMode: true,
      guiDesignArtifact: { kind: 'svg' }
    }, false)).toBe(SVG_ARTIFACT_MODE_INSTRUCTION)
  })
})
