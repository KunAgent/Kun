export const ROOM_AVATAR_COLUMNS = 6
export const ROOM_AVATAR_ROWS = 5
export const ROOM_AVATAR_CELL_SIZE = 229
// Keep neighboring shoulders out of the displayed tile without modifying the source image.
export const ROOM_AVATAR_INSET = 8
const portraitSize = ROOM_AVATAR_CELL_SIZE - ROOM_AVATAR_INSET * 2
const atlasWidth = ROOM_AVATAR_COLUMNS * ROOM_AVATAR_CELL_SIZE
const atlasHeight = ROOM_AVATAR_ROWS * ROOM_AVATAR_CELL_SIZE
export const ROOM_AVATAR_BACKGROUND_SIZE = `${atlasWidth / portraitSize * 100}% ${atlasHeight / portraitSize * 100}%`

const portraits = [
  ['coordinator', 'Coordinator'],
  ['coder', 'Coder'],
  ['reviewer', 'Reviewer'],
  ['detective', 'Detective'],
  ['designer', 'Designer'],
  ['architect', 'Architect'],
  ['scientist', 'Scientist'],
  ['security', 'Security'],
  ['writer', 'Writer'],
  ['researcher', 'Researcher'],
  ['data', 'Data'],
  ['operations', 'Operations'],
  ['astronaut', 'Astronaut'],
  ['pilot', 'Pilot'],
  ['navigator', 'Navigator'],
  ['librarian', 'Librarian'],
  ['musician', 'Musician'],
  ['gardener', 'Gardener'],
  ['chef', 'Chef'],
  ['medic', 'Medic'],
  ['photographer', 'Photographer'],
  ['athlete', 'Athlete'],
  ['explorer', 'Explorer'],
  ['storyteller', 'Storyteller'],
  ['magician', 'Magician'],
  ['night-thinker', 'Night Thinker'],
  ['barista', 'Barista'],
  ['maker', 'Maker'],
  ['courier', 'Courier'],
  ['strategist', 'Strategist']
] as const

export const ROOM_AVATARS = portraits.map(([id, label], index) => ({
  id,
  label,
  index,
  backgroundPosition:
    `${((index % ROOM_AVATAR_COLUMNS) * ROOM_AVATAR_CELL_SIZE + ROOM_AVATAR_INSET) / (atlasWidth - portraitSize) * 100}% ` +
    `${(Math.floor(index / ROOM_AVATAR_COLUMNS) * ROOM_AVATAR_CELL_SIZE + ROOM_AVATAR_INSET) / (atlasHeight - portraitSize) * 100}%`
}))

const defaultMemberPortraits = new Map([
  ['coordinator', 0],
  ['developer', 1],
  ['reviewer', 2],
  ['diagnostician', 3]
])

// Keep this mapping stable: names, roles and transient activity must not change a face.
export function avatarForIdentity(memberId: string) {
  const defaultIndex = defaultMemberPortraits.get(memberId)
  if (defaultIndex !== undefined) return ROOM_AVATARS[defaultIndex]
  let hash = 2166136261
  for (const char of memberId)
    hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619) >>> 0
  return ROOM_AVATARS[hash % ROOM_AVATARS.length]
}
