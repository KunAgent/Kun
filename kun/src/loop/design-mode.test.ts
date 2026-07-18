import { describe, expect, it } from 'vitest'
import {
  DESIGN_MODE_INSTRUCTION,
  SVG_ARTIFACT_ALLOWED_TOOL_NAMES,
  SVG_ARTIFACT_MODE_INSTRUCTION
} from './design-mode.js'

describe('DESIGN_MODE_INSTRUCTION', () => {
  it('defines intent-aware single-screen, multi-screen, edit, and ambiguity behavior', () => {
    expect(DESIGN_MODE_INSTRUCTION).toContain('SINGLE SCREEN')
    expect(DESIGN_MODE_INSTRUCTION).toContain('COMPLETE MULTI-SCREEN EXPERIENCE')
    expect(DESIGN_MODE_INSTRUCTION).toContain('MODIFY EXISTING DESIGN')
    expect(DESIGN_MODE_INSTRUCTION).toContain('screens` array')
    expect(DESIGN_MODE_INSTRUCTION).toContain('ask one concise question through `user_input`')
    expect(DESIGN_MODE_INSTRUCTION).toContain('fewest calls')
    expect(DESIGN_MODE_INSTRUCTION).toContain('FRAME/LAYER MOTION')
    expect(DESIGN_MODE_INSTRUCTION).toContain('`design_motion_*`')
    expect(DESIGN_MODE_INSTRUCTION).toContain('SVG SMIL remains a separate inner animation source')
    expect(DESIGN_MODE_INSTRUCTION).toContain('PROTOTYPE NAVIGATION')
    expect(DESIGN_MODE_INSTRUCTION).not.toContain('design.plan')
    expect(DESIGN_MODE_INSTRUCTION).not.toContain('MANY focused calls')
  })
})

describe('SVG_ARTIFACT_MODE_INSTRUCTION', () => {
  it('keeps a dedicated artifact turn on structured SVG tools only', () => {
    expect(SVG_ARTIFACT_MODE_INSTRUCTION).toContain('already-reserved file')
    expect(SVG_ARTIFACT_MODE_INSTRUCTION).toContain('Do not call design_svg_create')
    expect(SVG_ARTIFACT_MODE_INSTRUCTION).toContain('at least one successful design_svg_edit or design_svg_animate')
    expect(SVG_ARTIFACT_MODE_INSTRUCTION).toContain('revision as expectedRevision')
    expect(SVG_ARTIFACT_MODE_INSTRUCTION).toContain('Never use generic write/edit/patch/shell')
    expect(SVG_ARTIFACT_MODE_INSTRUCTION).toContain('successful design_svg_validate')
    expect(SVG_ARTIFACT_ALLOWED_TOOL_NAMES).toEqual(expect.arrayContaining([
      'design_svg_inspect',
      'design_svg_edit',
      'design_svg_animate',
      'design_svg_validate'
    ]))
    expect(SVG_ARTIFACT_ALLOWED_TOOL_NAMES).not.toContain('write')
    expect(SVG_ARTIFACT_ALLOWED_TOOL_NAMES).not.toContain('bash')
  })
})
