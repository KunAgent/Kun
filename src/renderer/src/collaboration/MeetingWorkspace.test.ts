import { createElement } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { act, create } from 'react-test-renderer'
import type { Meeting } from '@shared/collaboration/contracts'
import { useCollaborationStore } from './collaboration-store'
import { MeetingWorkspace } from './MeetingWorkspace'

describe('MeetingWorkspace membership controls', () => {
  beforeEach(() => {
    useCollaborationStore.setState({
      networkStatus: {
        state: 'ready', e2eeState: 'ready', activeMeetingId: 'meeting-1', memberId: 'member-owner',
        protocol: 1, transport: 'tls13-spki', encryption: 'rfc9420-openmls'
      }
    })
  })

  it('offers MLS-backed removal only for another active member', async () => {
    let renderer: ReturnType<typeof create>
    await act(async () => { renderer = create(createElement(MeetingWorkspace, { meeting: meeting() })) })
    const buttons = renderer!.root.findAllByType('button')
    expect(buttons.some((button) => button.props['aria-label'] === '移除 Bob')).toBe(true)
    expect(buttons.some((button) => button.props['aria-label'] === '移除 Alice')).toBe(false)
    await act(async () => renderer!.unmount())
  })
})

function meeting(): Meeting {
  return {
    id: 'meeting-1', title: 'Review', description: '', status: 'active', tasks: [], timeline: [],
    members: [
      { id: 'member-owner', displayName: 'Alice', role: 'owner', status: 'online' },
      { id: 'member-2', displayName: 'Bob', role: 'member', status: 'online' }
    ],
    createdAt: '2026-07-17T00:00:00.000Z', updatedAt: '2026-07-17T00:00:00.000Z', version: 1
  }
}
