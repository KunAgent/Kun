import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { BUILTIN_PET_IDS } from '@shared/pets-builtin'
import { defaultPetEnsemble } from '@shared/pets-ensemble'
import type { PetSummary } from '@shared/pets'
import { PetEnsembleControls } from './pet-ensemble-controls'

const pets: PetSummary[] = BUILTIN_PET_IDS.map((id) => ({
  id: `kun:${id}`, sourceId: id, displayName: id, description: '', source: 'kun-builtin',
  spriteVersionNumber: 1, available: true, sourceMissing: false, spritesheetUrl: `kun-pet://asset/kun%3A${id}/spritesheet`
}))
async function render(onChange = vi.fn(async (_next: unknown) => undefined), available = pets) {
  let renderer!: ReturnType<typeof create>
  await act(async () => { renderer = create(createElement(PetEnsembleControls, {
    value: defaultPetEnsemble(), pets: available, language: 'en', onChange
  })) })
  return { renderer, onChange }
}

describe('companion theater controls', () => {
  it('invites all seventeen members and protects the last selected Kun host', async () => {
    const { renderer, onChange } = await render()
    const host = renderer.root.findAllByType('input')[0]
    expect(host.props.checked).toBe(true)
    expect(host.props.disabled).toBe(true)
    const invite = renderer.root.findAllByType('button').find((button) => button.children.includes('Invite everyone'))!
    await act(async () => { invite.props.onClick() })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ members: [...BUILTIN_PET_IDS] }))
    await act(async () => renderer.unmount())
  })

  it('applies a tailored cast and scene in one change', async () => {
    const { renderer, onChange } = await render()
    await act(async () => { renderer.root.findAllByType('select')[0].props.onChange({ target: { value: 'moonlight' } }) })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      scene: 'stargazing', members: ['xiao-kun', 'kimi-girl', 'gemini-girl', 'hunyuan-girl'], paused: false
    }))
    await act(async () => renderer.unmount())
  })

  it('reports a rejected save and permits retry', async () => {
    const { renderer, onChange } = await render(vi.fn(async () => { throw new Error('unavailable') }))
    const start = () => renderer.root.findAllByType('button').find((button) => button.children.includes('Start ensemble'))!
    await act(async () => { start().props.onClick() })
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('Could not save')
    expect(start().props.disabled).toBe(false)
    await act(async () => { start().props.onClick() })
    expect(onChange).toHaveBeenCalledTimes(2)
    await act(async () => renderer.unmount())
  })

  it('does not substitute imported namesakes for missing built-ins', async () => {
    const { renderer } = await render(undefined, pets.map((pet) => ({ ...pet, source: 'kun-local' })))
    const start = renderer.root.findAllByType('button').find((button) => button.children.includes('Start ensemble'))!
    expect(start.props.disabled).toBe(true)
    expect(renderer.root.findByProps({ role: 'status' }).children.join('')).toContain('unavailable')
    await act(async () => renderer.unmount())
  })
})
