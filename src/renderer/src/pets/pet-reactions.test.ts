import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_PET_IDS } from '@shared/pets-builtin'
import { emptyPetPresence, parsePetInteractionPack } from '@shared/pets-interactions'
import type { PetSummary } from '@shared/pets'
import { currentPetReaction, petForModel, reactionFrame } from './pet-reactions'

const pets: PetSummary[] = BUILTIN_PET_IDS.map((id) => {
  const manifest = JSON.parse(readFileSync(path.resolve('resources/pets', id, 'pet.json'), 'utf8'))
  return { ...manifest, id: `kun:${id}`, sourceId: id, source: 'kun-builtin', available: true, sourceMissing: false, spritesheetUrl: `kun-pet://asset/${id}/spritesheet` }
})

describe('model and input reactions', () => {
  it.each([
    ['openai/gpt-5.1', 'gpt-girl'], ['o3-mini', 'gpt-girl'], ['anthropic/claude-sonnet-4', 'claude-girl'],
    ['claude-opus', 'claude-girl'], ['gemini-3-pro', 'gemini-girl'], ['doubao-seed-2', 'seed-girl'],
    ['doubao-1.5', 'doubao-girl'], ['deepseek-v4', 'whale-girl'], ['kimi-k2.5', 'kimi-girl'], ['grok-4', 'grok-girl'],
    ['qwen3-coder', 'qwen-girl'], ['glm-5', 'glm-girl'], ['MiniMax-M2', 'minimax-girl'], ['llama-4', 'llama-girl'],
    ['codestral-latest', 'mistral-girl'], ['hunyuan-t1', 'hunyuan-girl'], ['mimo-v2-flash', 'mimo-girl']
  ])('maps %s to its packaged character through a compatibility gateway', (model, id) => {
    expect(petForModel({ model, provider: 'openai' }, pets)?.sourceId).toBe(id)
  })

  it('uses provider defaults only for auto selection and ignores unknown or imported namesakes', () => {
    expect(petForModel({ model: 'custom-private-model', provider: 'openai' }, pets)).toBeNull()
    expect(petForModel({ model: 'gptish', provider: 'openai' }, pets)).toBeNull()
    expect(petForModel({ model: 'auto', provider: 'anthropic' }, pets)?.sourceId).toBe('claude-girl')
    expect(petForModel({ model: 'gpt-5', provider: '' }, pets.map((pet) => ({ ...pet, source: 'kun-local' })))).toBeNull()
    expect(petForModel({ model: 'gpt-5', provider: '' }, pets.map((pet) => ({ ...pet, available: false })))).toBeNull()
  })

  it('ships safe recipes for every built-in and animates typing, listening and speaking differently', () => {
    for (const pet of pets) {
      expect(parsePetInteractionPack(pet.interactions), pet.id).not.toBeNull()
      const base = { pack: pet.interactions, elapsed: 750, level: 0, version: pet.spriteVersionNumber, reduced: false }
      expect(reactionFrame({ ...base, kind: 'typing' }).frame.row).toBe(7)
      expect(reactionFrame({ ...base, kind: 'listening' }).frame.row).toBe(6)
      expect(reactionFrame({ ...base, kind: 'listening', level: .6 }).frame.row).toBe(3)
      expect(reactionFrame({ ...base, kind: 'speaking', level: 0 }).lift).toBe(0)
      expect(reactionFrame({ ...base, kind: 'speaking', level: .8, reduced: true })).toMatchObject({ lift: 0, tilt: 0, scaleY: 1 })
    }
  })

  it('does not keep an expired input active after a renderer or microphone disappears', () => {
    const snapshot = { ...emptyPetPresence(), input: { kind: 'typing' as const, level: 0, expiresAt: 2000 } }
    expect(currentPetReaction(snapshot, 1999)?.kind).toBe('typing')
    expect(currentPetReaction(snapshot, 2000)).toBeNull()
  })
})
