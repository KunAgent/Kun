import { afterEach, describe, expect, it } from 'vitest'
import { dispatchGuidanceForTools, dispatchPreferenceSection, MANAGER_DISPATCH_GUIDANCE, setDispatchPreferenceSource } from './dispatch-guidance.js'

describe('dispatch guidance preference', () => {
  afterEach(() => setDispatchPreferenceSource(undefined))

  it('adds the live user preference for bridged main Agents', () => {
    let preference = ''
    setDispatchPreferenceSource(() => preference)
    expect(dispatchGuidanceForTools([{ name: 'worker_create' }])).toEqual([MANAGER_DISPATCH_GUIDANCE])
    preference = 'Reviews go to codex.'
    const blocks = dispatchGuidanceForTools([{ name: 'worker_create' }])
    expect(blocks).toHaveLength(2)
    expect(blocks[1]).toContain('Reviews go to codex.')
    expect(dispatchGuidanceForTools([{ name: 'read' }])).toEqual([])
  })

  it('keeps preferences advisory and explains safe parent fallback', () => {
    const block = dispatchPreferenceSection('Reviews: codex')
    expect(block).toContain('not a fixed workflow')
    expect(block).toContain('original conversation with its own Agent and model')
    expect(block).toContain('cannot expand permissions')
    expect(block).toContain('preserve the existing replacement/review policy')
  })

  it('trims and caps the preference text', () => {
    expect(dispatchPreferenceSection('  \n ')).toBe('')
    const block = dispatchPreferenceSection(`  ${'a'.repeat(2_500)}  `)
    expect(block).toContain('a'.repeat(2_000))
    expect(block).not.toContain('a'.repeat(2_001))
  })
})
