/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { publishRoomEvent } from './room-event-listeners'

const roomsRequest = vi.hoisted(() => vi.fn())
vi.mock('./rooms-client', () => ({ roomsRequest }))
const { useRoomUserProfile, useRoomUserProfileSync } = await import('./room-user-profile')

function Probe() {
  useRoomUserProfileSync()
  return null
}

let container: HTMLDivElement
let roots: Root[] = []
const mount = async () => {
  const root = createRoot(container.appendChild(document.createElement('div')))
  roots.push(root)
  await act(async () => root.render(createElement(Probe)))
  return root
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.body.appendChild(document.createElement('div'))
  roomsRequest.mockReset()
  roomsRequest.mockResolvedValue({ profile: { avatar: { kind: 'builtin', id: 'explorer' } }, revision: 3 })
})
afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount())
  roots = []
  container.remove()
  vi.unstubAllGlobals()
})

it('shares one profile sync between the sidebar face and the chat view', async () => {
  const sidebar = await mount()
  await mount()
  expect(roomsRequest).toHaveBeenCalledOnce()
  expect(useRoomUserProfile.getState().profile.avatar).toEqual({ kind: 'builtin', id: 'explorer' })

  await act(async () => sidebar.unmount())
  roots = roots.filter((root) => root !== sidebar)
  roomsRequest.mockResolvedValue({ profile: { avatar: { kind: 'builtin', id: 'designer' } }, revision: 4 })
  await act(async () => publishRoomEvent({ seq: 1, roomId: 'agent-directory', kind: 'presentation.user-profile.updated' }))
  expect(roomsRequest).toHaveBeenCalledTimes(2)
  expect(useRoomUserProfile.getState().profile.avatar).toEqual({ kind: 'builtin', id: 'designer' })

  for (const root of roots) await act(async () => root.unmount())
  roots = []
  await act(async () => publishRoomEvent({ seq: 2, roomId: 'agent-directory', kind: 'presentation.user-profile.updated' }))
  expect(roomsRequest).toHaveBeenCalledTimes(2)
})
