import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PetSummary } from '@shared/pets'
import { defaultPetEnsemble } from '@shared/pets-ensemble'
import { defaultPetInteractions } from '@shared/pets-interactions'
import { PetEnsembleStage } from './pet-ensemble-stage'

describe('group input and model reactions', () => {
  const pets = ['ikun', 'whale-girl', 'gpt-girl', 'claude-girl'].map((id) => ({
    id: `kun:${id}`, sourceId: id, displayName: id, description: '', source: 'kun-builtin', available: true,
    sourceMissing: false, spriteVersionNumber: 1, spritesheetUrl: `kun-pet://asset/${id}`, interactions: defaultPetInteractions()
  })) as PetSummary[]
  const settings = { ...defaultPetEnsemble(), enabled: true, members: ['ikun', 'whale-girl', 'gpt-girl'] as const }

  it('keeps the chosen group while inviting a model guest and restores the original cast afterwards', () => {
    const value = { ...settings, members: [...settings.members] }
    const props = { settings: value, pets, language: 'en', width: 404, height: 260 }
    const render = (reaction?: Parameters<typeof PetEnsembleStage>[0]['reaction']) => renderToStaticMarkup(createElement(PetEnsembleStage, { ...props, reaction }))
    const greeting = render({ kind: 'greeting', level: 0, eventId: 1, partnerId: 'claude-girl' })
    expect((greeting.match(/class="pet-sprite pet-ensemble-sprite"/g) ?? []).length).toBe(4)
    for (const id of settings.members) expect(greeting).toContain(`title="${id}`)
    expect(greeting).toContain('claude-girl')
    expect(value.members).toEqual(settings.members)
    const typing = render({ kind: 'typing', level: 0, eventId: 1, partnerId: 'claude-girl' })
    expect((typing.match(/background-position:0% 87.5%/g) ?? []).length).toBe(4)
    const settled = render()
    expect((settled.match(/class="pet-sprite pet-ensemble-sprite"/g) ?? []).length).toBe(3)
    expect(settled).not.toContain('claude-girl')
  })
})
