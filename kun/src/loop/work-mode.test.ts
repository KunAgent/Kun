import { describe, expect, it } from 'vitest'
import { WORK_MODE_INSTRUCTION } from './work-mode.js'

describe('WORK_MODE_INSTRUCTION', () => {
  it('keeps stable Work behavior outside the visible user message', () => {
    expect(WORK_MODE_INSTRUCTION).toContain('The user message is the request')
    expect(WORK_MODE_INSTRUCTION).toContain('`work-reference-resource`')
    expect(WORK_MODE_INSTRUCTION).toContain('`work-reference-whiteboard`')
    expect(WORK_MODE_INSTRUCTION).toContain('`design_apply_excalidraw`')
    expect(WORK_MODE_INSTRUCTION).toContain('`scenePath`')
    expect(WORK_MODE_INSTRUCTION).not.toContain('the user draws in Excalidraw')
    expect(WORK_MODE_INSTRUCTION).toContain('`work_rename_whiteboard`')
    expect(WORK_MODE_INSTRUCTION).toContain('access: "read-write"')
    expect(WORK_MODE_INSTRUCTION).toContain('Architecture maps')
    expect(WORK_MODE_INSTRUCTION).toContain('snapshot is frozen at turn start')
    expect(WORK_MODE_INSTRUCTION).toContain('describe the operation as submitted rather than applied')
    expect(WORK_MODE_INSTRUCTION).toContain('Do not loop through speculative schema variants')
    expect(WORK_MODE_INSTRUCTION).not.toMatch(/Workspace:\s*\//)
  })
})
