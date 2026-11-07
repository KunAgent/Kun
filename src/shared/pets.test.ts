import { describe, expect, it } from 'vitest'
import {
  PET_MASCOT_DEFAULT_WIDTH_PX,
  PET_ROWS,
  defaultPetSettings,
  petAssetUrl,
  petIdForSource,
  petSheetHeightForVersion
} from './pets'
import {
  parsePetActionRequest,
  parsePetActivitySnapshot,
  parsePetImportPreferences,
  parsePetSelectPayload
} from './pets-payload'

describe('pet contracts', () => {
  it('namespaces every source, including Codex, and uses Awaken frame timing', () => {
    expect(petIdForSource('kun-builtin', 'kun-dot')).toBe('kun:kun-dot')
    expect(petIdForSource('kun-local', 'kun-dot')).toBe('kun-local:kun-dot')
    expect(petIdForSource('codex-custom', 'kun-dot')).toBe('codex-custom:kun-dot')
    expect(PET_ROWS.waiting).toMatchObject({ row: 6, frames: 6 })
    expect(petSheetHeightForVersion(1)).toBe(1872)
    expect(petSheetHeightForVersion(2)).toBe(2288)
    expect(petAssetUrl('kun:kun-dot', 'abc')).toBe('kun-pet://asset/kun%3Akun-dot/spritesheet?v=abc')
  })

  it('starts closed at 112 DIP with automatic activity and Codex import enabled', () => {
    expect(defaultPetSettings()).toMatchObject({
      selectedPetId: null,
      overlayOpen: false,
      mascotWidthPx: PET_MASCOT_DEFAULT_WIDTH_PX,
      importCodexPets: true,
      reactionsEnabled: true,
      globalActivity: { keyboard: true, microphone: true }
    })
  })

  it('rejects malformed desktop IPC payloads and accepts v1 and v2 activity', () => {
    expect(parsePetSelectPayload('../x').ok).toBe(false)
    expect(parsePetSelectPayload(1).ok).toBe(false)
    expect(parsePetImportPreferences({ importCodexPets: 'yes' }).ok).toBe(false)
    expect(parsePetActionRequest({ type: 'stop', threadId: 'thr', turnId: 'turn' })).toMatchObject({ ok: true })
    expect(parsePetActionRequest({ type: 'reply', threadId: 'thr' })).toMatchObject({
      ok: true,
      value: { type: 'reply', threadId: 'thr' }
    })
    expect(parsePetActionRequest({ type: 'follow-up', threadId: 'thr', prompt: '继续' })).toMatchObject({
      ok: true,
      value: { type: 'follow-up', threadId: 'thr', prompt: '继续' }
    })
    expect(parsePetActionRequest({ type: 'follow-up', threadId: 'thr', prompt: ' ' }).ok).toBe(false)
    expect(parsePetActionRequest({ type: 'approve', threadId: 'thr' }).ok).toBe(false)
    const snapshot = parsePetActivitySnapshot({
      generation: 2,
      profileKey: 'desktop',
      emittedAtMs: 10,
      items: [{
        key: 'k', status: 'waiting', threadId: 'thr', unitId: 'unit', turnId: 'turn',
        stateSince: '2026-01-01T00:00:00.000Z', title: 'Need you', stalled: false,
        navigable: true, bubbleAllowed: true, updatedAtMs: 10, generation: 2
      }]
    })
    expect(snapshot.ok).toBe(true)
    expect(parsePetActivitySnapshot({ generation: -1, profileKey: 'x', items: [] }).ok).toBe(false)
  })
})
