import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PetOverlayBootstrap } from '@shared/pets'
import { PetVisitStage } from './pet-visit-stage'
import type { PetVisit } from '@shared/pets-visits'

afterEach(() => vi.useRealTimers())

describe('bottle discovery presentation', () => {
  it.each(['xiao-kun', 'ikun'])('uses the existing %s artwork and keeps every bottle sealed', (id) => {
    vi.useFakeTimers(); vi.setSystemTime(5500)
    const manifest = JSON.parse(readFileSync(path.resolve('resources/pets', id, 'pet.json'), 'utf8'))
    const pet = { ...manifest, petId: `kun:${id}`, spritesheetUrl: `kun-pet://asset/kun%3A${id}/spritesheet`,
      spriteVersionNumber: 1 } as PetOverlayBootstrap
    const visit: PetVisit = { id: 1, primaryId: pet.petId!, guestIds: [], reason: 'bottle', scene: 'gift',
      startedAt: 1000, playUntil: 8300, plannedPlayUntil: 8300, endsAt: 9200, seed: 0, bottleCount: 2 }
    const html = renderToStaticMarkup(createElement(PetVisitStage, { visit, pet, pets: [], width: 404, height: 300,
      primaryOrigin: { x: 202, y: 150 }, mascotWidth: 112, language: 'zh', actorEvents: {}, onDismiss: () => undefined }))
    expect(html).toContain(`kun%3A${id}/spritesheet`)
    expect(html).toContain('bottle-sealed')
    expect(html).not.toContain('bottle-open')
    expect(html).not.toMatch(/legendary|rare|wizard-hat|openedAt/)
    expect((html.match(/pet-sprite pet-bottle-actor/g) ?? []).length).toBe(1)
    expect(html).toContain('×2')
  })
})
