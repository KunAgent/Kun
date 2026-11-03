import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultPetSettings, type PetImportReport, type PetSettings, type PetSummary } from '@shared/pets'
import { PetsSettingsSection } from './settings-section-pets'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => values ? `${key}:${values.failed}/${values.missing}` : key
  })
}))

const pet: PetSummary = {
  id: 'kun:kun-dot',
  sourceId: 'kun-dot',
  displayName: 'Kun Dot',
  description: 'builtin',
  source: 'kun-builtin',
  spriteVersionNumber: 1,
  available: true,
  sourceMissing: false
}

function report(failed = 0): PetImportReport {
  return {
    imported: [],
    updated: [],
    unchanged: [],
    sourceMissing: [],
    failed: Array.from({ length: failed }, (_, index) => ({ sourcePath: `bad-${index}`, error: 'bad' })),
    conflicts: [],
    sourceStates: { builtin: 'ok', local: 'ok', codex: 'missing' },
    selectedPetIdUnchanged: null
  }
}

function install(pets: PetSummary[], settings: PetSettings, fail = false): { refresh: ReturnType<typeof vi.fn>; catalog: () => void } {
  let catalog = (): void => undefined
  const refresh = vi.fn(async () => report(1))
  const api = {
    listPets: vi.fn(async () => {
      if (fail) throw new Error('unavailable')
      return pets
    }),
    getPetSettings: vi.fn(async () => settings),
    getPetInteraction: vi.fn(async () => ({ mode: 'passthrough' as const, note: null })),
    selectPet: vi.fn(async (id: string | null) => ({ ...settings, selectedPetId: id })),
    setOverlayOpen: vi.fn(async (open: boolean) => ({ ...settings, overlayOpen: open })),
    setImportPreferences: vi.fn(async () => settings),
    refreshPets: refresh,
    openKunPetsDirectory: vi.fn(async () => undefined),
    openCodexPetsDirectory: vi.fn(async () => undefined),
    updatePetActivity: vi.fn(),
    onPetCatalogChanged: vi.fn((handler: () => void) => {
      catalog = handler
      return () => undefined
    }),
    onPetNavigationRequested: vi.fn(() => () => undefined),
    takePendingNavigation: vi.fn(async () => null)
  }
  vi.stubGlobal('window', { kunGui: { pets: api }, dispatchEvent: () => true })
  return { refresh, catalog: () => catalog() }
}

function collectText(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : collectText(child)).join('')
}

async function renderSection(): Promise<ReturnType<typeof create>> {
  let renderer: ReturnType<typeof create> | undefined
  await act(async () => {
    renderer = create(createElement(PetsSettingsSection))
  })
  if (!renderer) throw new Error('renderer missing')
  return renderer
}

describe('pets settings section', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows an empty catalog, then the pet added by a catalog refresh', async () => {
    const pets: PetSummary[] = []
    const installed = install(pets, defaultPetSettings())
    const renderer = await renderSection()
    expect(JSON.stringify(renderer.toJSON())).toContain('petsEmpty')
    pets.push(pet)
    await act(async () => {
      installed.catalog()
    })
    const markup = JSON.stringify(renderer.toJSON())
    expect(markup).toContain('Kun Dot')
    expect(markup).toContain('petsSelectFirst')
  })

  it('gives a spritesheet preview an explicit box so the cell can paint', async () => {
    const visible = { ...pet, spritesheetUrl: 'kun-pet://asset/kun%3Akun-dot/spritesheet?v=abc' }
    const settings = { ...defaultPetSettings(), selectedPetId: visible.id }
    install([visible], settings)
    const renderer = await renderSection()
    const images = renderer.root.findAllByType('img')
    expect(images).toHaveLength(2)
    expect(images.map((image) => image.props.src)).toEqual([
      visible.spritesheetUrl,
      visible.spritesheetUrl
    ])
    expect(images.map((image) => image.props.style.width)).toEqual([72 * 8, 42 * 8])
  })

  it('keeps the selected pet pressed and reports a failed refresh', async () => {
    const settings = { ...defaultPetSettings(), selectedPetId: pet.id, overlayOpen: true }
    const installed = install([pet], settings)
    const renderer = await renderSection()
    const markup = JSON.stringify(renderer.toJSON())
    expect(markup).toContain('"checked":true')
    expect(markup).toContain('petsHide')
    expect(markup).not.toContain('title":"petsSelectFirst"')
    const refreshButton = renderer.root.findAllByType('button').find((node) => collectText(node).includes('petsRefresh'))
    await act(async () => {
      refreshButton?.props.onClick()
    })
    expect(installed.refresh).toHaveBeenCalled()
    expect(JSON.stringify(renderer.toJSON())).toContain('petsReport:1/0')
  })

  it('shows the load error and hides the panel without the desktop bridge', async () => {
    install([], defaultPetSettings(), true)
    const failed = await renderSection()
    expect(JSON.stringify(failed.toJSON())).toContain('petsLoadError')
    vi.stubGlobal('window', { kunGui: {} })
    const hidden = await renderSection()
    expect(JSON.stringify(hidden.toJSON())).toContain('petsDesktopOnly')
  })

  it('cancels workbench body zoom for sprite previews', () => {
    const css = readFileSync(resolve('src/renderer/src/components/settings-pets.css'), 'utf8')
    expect(css).toMatch(/\.pet-static-preview\s*\{[^}]*zoom:\s*calc\(1\s*\/\s*var\(--ds-ui-scale,\s*1\)\)/)
  })
})
