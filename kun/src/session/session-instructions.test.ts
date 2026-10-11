import { expect, it } from 'vitest'
import type { DelegatedSessionPreparation } from '../runtime/delegated-session-binding.js'
import { sessionInstructions } from './session-instructions.js'

it('deduplicates stable context but delivers request-local controls on every turn', () => {
  const first = { resumed: false } as DelegatedSessionPreparation
  expect(sessionInstructions(first, ['Stable policy', 'Current persona'], false, ['Current persona']))
    .toEqual(['Stable policy', 'Current persona'])
  const next = { resumed: true, synchronizedInstructionDigest: first.instructionDigest } as DelegatedSessionPreparation
  expect(sessionInstructions(next, ['Stable policy', 'Current persona'], false, ['Current persona']))
    .toEqual(['Current persona'])
  expect(sessionInstructions(next, ['Stable policy', 'Different persona'], false, ['Different persona']))
    .toEqual(['Different persona'])
  expect(sessionInstructions(next, ['Stable policy'])).toEqual([])
  expect(sessionInstructions(next, ['New policy'])[0]).toContain('replace previous')
  expect(sessionInstructions(next, [])[0]).toContain('No additional Kun instructions')
  expect(sessionInstructions(next, ['Stable policy'], true)).toEqual(['Stable policy'])
})
