import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultPetSettings, type PetImportReport, type PetSettings, type PetSummary } from '@shared/pets'
import type { PetGlobalActivityPreferences, PetGlobalActivityStatus } from '@shared/pets-global-activity'
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

function install(pets: PetSummary[], settings: PetSettings, fail = false,
  activity: PetGlobalActivityStatus = { keyboard: 'active', microphone: 'active', recording: false }
): { refresh: ReturnType<typeof vi.fn>; catalog: () => void; requestAccess: ReturnType<typeof vi.fn>; setGlobalActivity: ReturnType<typeof vi.fn> } {
  let catalog = (): void => undefined
  const refresh = vi.fn(async () => report(1))
  const requestAccess = vi.fn(async () => { activity = { ...activity, keyboard: 'active' } })
  const setGlobalActivity = vi.fn(async (preferences: PetGlobalActivityPreferences) => {
    settings = { ...settings, globalActivity: preferences }
    activity = { ...activity, microphone: preferences.microphone ? 'active' : 'off',
      recording: preferences.microphone && activity.recording }
    catalog()
    return settings
  })
  const api = {
    listPets: vi.fn(async () => {
      if (fail) throw new Error('unavailable')
      return pets
    }),
    getPetGlobalActivityStatus: vi.fn(async () => activity),
    requestPetKeyboardAccess: requestAccess,
    getPetSettings: vi.fn(async () => settings),
    setPetGlobalActivity: setGlobalActivity,
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
  vi.stubGlobal('window', { kunGui: { pets: api }, dispatchEvent: () => true,
    setInterval: vi.fn(() => 0), clearInterval: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })
  return { refresh, catalog: () => catalog(), requestAccess, setGlobalActivity }
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

  it('keeps typing automatic and recording detection explicitly opted in', async () => {
    const installed = install([pet], { ...defaultPetSettings(), selectedPetId: pet.id, overlayOpen: true,
      globalActivity: { keyboard: true, microphone: true } }, false,
      { keyboard: 'active', microphone: 'active', recording: true })
    const renderer = await renderSection()
    const checkboxes = renderer.root.findAllByType('input').filter((node) => node.props.type === 'checkbox')
    expect(checkboxes.map((node) => collectText(node.parent!))).toEqual([
      'Follow recording in other apps', 'petsImportCodex'
    ])
    expect(checkboxes[0].props.checked).toBe(true)
    expect(installed.setGlobalActivity).not.toHaveBeenCalled()
    expect(renderer.root.findAllByProps({ role: 'status' }).map(collectText)).toEqual([
      'Typing across appsReady', 'Recording stateRecording detected; your pet is listening'
    ])
    expect(installed.requestAccess).not.toHaveBeenCalled()
    await act(async () => renderer.unmount())
  })

  it('keeps recording off by default and changes it only after explicit consent', async () => {
    const installed = install([pet], defaultPetSettings(), false,
      { keyboard: 'active', microphone: 'off', recording: false })
    const renderer = await renderSection()
    const recording = () => renderer.root.findAllByType('input').find((node) =>
      node.props.type === 'checkbox' && collectText(node.parent!) === 'Follow recording in other apps')!
    expect(recording().props.checked).toBe(false)
    expect(installed.setGlobalActivity).not.toHaveBeenCalled()
    await act(async () => recording().props.onChange({ target: { checked: true } }))
    expect(installed.setGlobalActivity).toHaveBeenCalledExactlyOnceWith({ keyboard: true, microphone: true })
    expect(recording().props.checked).toBe(true)
    await act(async () => recording().props.onChange({ target: { checked: false } }))
    expect(installed.setGlobalActivity).toHaveBeenLastCalledWith({ keyboard: true, microphone: false })
    expect(recording().props.checked).toBe(false)
    expect(installed.requestAccess).not.toHaveBeenCalled()
    await act(async () => renderer.unmount())
  })

  it('keeps OS authorization explicit and updates the status after permission is granted', async () => {
    const installed = install([pet], defaultPetSettings(), false,
      { keyboard: 'permission-required', microphone: 'active', recording: false })
    const renderer = await renderSection()
    expect(installed.requestAccess).not.toHaveBeenCalled()
    const allow = renderer.root.findAllByType('button').find((node) => collectText(node) === 'Allow Input Monitoring')
    expect(allow).toBeDefined()
    await act(async () => { allow!.props.onClick() })
    expect(installed.requestAccess).toHaveBeenCalledOnce()
    expect(collectText(renderer.root)).not.toContain('Input Monitoring')
    expect(renderer.root.findAllByProps({ role: 'status' }).map(collectText)).toContain('Typing across appsReady')
    await act(async () => renderer.unmount())
  })

  it.each(['paused', 'unsupported'] as const)('shows %s status without an unnecessary authorization button', async (state) => {
    const installed = install([pet], defaultPetSettings(), false,
      { keyboard: state, microphone: state, recording: false })
    const renderer = await renderSection()
    expect(renderer.root.findAllByProps({ role: 'status' })).toHaveLength(2)
    expect(collectText(renderer.root)).not.toContain('Allow Input Monitoring')
    expect(installed.requestAccess).not.toHaveBeenCalled()
    await act(async () => renderer.unmount())
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
