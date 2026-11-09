import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { defaultPetVisits } from '@shared/pets-visits'
import { PetVisitControls } from './pet-visit-controls'

describe('setup-free pet visits', () => {
  it('needs no member selection or checkbox and defaults to a spontaneous invitation', async () => {
    const invite = vi.fn(async () => undefined), preferences = vi.fn(async () => undefined)
    let view!: ReturnType<typeof create>
    await act(async () => { view = create(createElement(PetVisitControls, {
      value: defaultPetVisits(), canInvite: true, language: 'en', onInvite: invite, onPreferences: preferences
    })) })
    expect(view.root.findAllByType('input')).toHaveLength(0)
    const button = view.root.findAllByType('button').find((node) => node.children.includes('Invite friends now'))!
    await act(async () => { button.props.onClick() })
    expect(invite).toHaveBeenCalledExactlyOnceWith(undefined)
    const pause = view.root.findAllByType('button').find((node) => node.children.includes('Pause random visits'))!
    await act(async () => { pause.props.onClick() })
    expect(preferences).toHaveBeenCalledWith({ enabled: false, frequency: 'balanced' })
    await act(async () => { view.unmount() })
  })
})
