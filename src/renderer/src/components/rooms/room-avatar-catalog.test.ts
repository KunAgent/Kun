import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import avatarAtlas from '../../../../asset/img/room-avatars/kun-avatar-atlas.png'
import { RoomAvatar, RoomAvatarPortrait } from './RoomAvatar'
import {
  avatarForIdentity,
  ROOM_AVATARS,
  ROOM_AVATAR_COLUMNS,
  ROOM_AVATAR_ROWS
} from './room-avatar-catalog'

describe('room avatar catalog', () => {
  it('addresses all 30 separate portraits within the atlas', () => {
    expect(ROOM_AVATARS).toHaveLength(30)
    expect(ROOM_AVATAR_COLUMNS * ROOM_AVATAR_ROWS).toBe(30)
    expect(new Set(ROOM_AVATARS.map(({ id }) => id)).size).toBe(30)
    expect(new Set(ROOM_AVATARS.map(({ backgroundPosition }) => backgroundPosition)).size).toBe(30)
    for (const [index, left, top] of [[0, 8, 8], [5, 1153, 8], [6, 8, 237], [29, 1153, 924]]) {
      const [x, y] = ROOM_AVATARS[index].backgroundPosition.split(' ').map(parseFloat)
      expect(x / 100 * (1374 - 213)).toBeCloseTo(left)
      expect(y / 100 * (1145 - 213)).toBeCloseTo(top)
    }
  })

  it('retains recognizable portraits for the four default member identities', () => {
    expect(avatarForIdentity('coordinator').id).toBe('coordinator')
    expect(avatarForIdentity('developer').id).toBe('coder')
    expect(avatarForIdentity('reviewer').id).toBe('reviewer')
    expect(avatarForIdentity('diagnostician').id).toBe('detective')
  })

  it('selects custom portraits deterministically from stable IDs', () => {
    const identities = Array.from({ length: 1000 }, (_, index) => `member-${index}`)
    for (const id of [...identities, '__proto__', 'toString', '', 'member-\u{1f433}']) {
      expect(avatarForIdentity(id)).toBe(avatarForIdentity(id))
      expect(ROOM_AVATARS).toContain(avatarForIdentity(id))
    }
    expect(new Set(identities.map((id) => avatarForIdentity(id).id)).size).toBe(30)
  })

  it('renders every portrait with the same bundled image and keeps the user icon', () => {
    expect(avatarAtlas).not.toMatch(/^https?:\/\//)
    const gallery = renderToStaticMarkup(createElement('div', {},
      ...ROOM_AVATARS.map(({ index }) => createElement(RoomAvatarPortrait, { index, key: index }))
    ))
    expect(gallery.match(/class="rooms-avatar-art"/g)).toHaveLength(30)
    expect(gallery.match(/background-image:/g)).toHaveLength(30)
    expect(gallery).not.toMatch(/https?:\/\//)
    const user = renderToStaticMarkup(createElement(RoomAvatar, { id: 'user', label: 'You' }))
    expect(user).toContain('kun_greet.png')
    expect(user).not.toContain('rooms-avatar-letter')
  })
})
