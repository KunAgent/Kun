import { describe, expect, it } from 'vitest'
import { PET_IPC } from '../shared/pets'
import { PET_OVERLAY_IPC } from './pet-overlay-channels'

describe('pet overlay preload channels', () => {
  it('matches the shared desktop contract without sharing its module', () => {
    for (const [key, channel] of Object.entries(PET_OVERLAY_IPC)) {
      expect(PET_IPC[key as keyof typeof PET_IPC]).toBe(channel)
    }
  })
})
