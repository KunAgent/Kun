import type { PetSummary } from '@shared/pets'
import type { PetJointRig } from '@shared/pets-joint'

export type JointTexture = { id: string; atlas: HTMLCanvasElement }
const cache = new Map<string, Promise<HTMLCanvasElement>>()

/** Decode once and retain seven small cells, not three full-resolution GPU sheets. */
export async function loadJointTexture(pet: PetSummary, rig: PetJointRig): Promise<JointTexture> {
  const key = `${pet.spritesheetUrl}:${JSON.stringify(rig)}`
  let pending = cache.get(key)
  if (!pending) {
    pending = decode(pet.spritesheetUrl ?? '', rig)
    cache.set(key, pending)
    while (cache.size > 6) cache.delete(cache.keys().next().value!)
    void pending.catch(() => cache.delete(key))
  }
  return { id: pet.id, atlas: await pending }
}

async function decode(url: string, rig: PetJointRig): Promise<HTMLCanvasElement> {
  const image = new Image()
  if (!url.startsWith('file:')) image.crossOrigin = 'anonymous'
  image.src = url
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = 192 * 7; canvas.height = 208
  const context = canvas.getContext('2d')!
  const headHeight = Math.round(rig.head[1] * 208)
  rig.blink.forEach((column, i) => {
    const x = i * 192
    // The body and hands remain the calibrated neutral art throughout a blink.
    // Only the original head pixels change; a solo clip cannot move a joint grip.
    context.drawImage(image, rig.blink[0] * 192, rig.row * 208, 192, 208, x, 0, 192, 208)
    context.save(); context.beginPath(); context.rect(x, 0, 192, headHeight); context.clip()
    context.clearRect(x, 0, 192, headHeight)
    context.drawImage(image, column * 192, rig.row * 208, 192, 208, x, 0, 192, 208)
    context.restore()
  })
  // Last cell is the original solo idle, used only at the entrance/exit seam.
  context.drawImage(image, 0, 0, 192, 208, 192 * 6, 0, 192, 208)
  return canvas
}

export function blinkCell(elapsed: number, index: number, reduced: boolean): number {
  if (reduced) return 0
  const time = (elapsed + index * 1270) % 6600
  const boundaries = [3200, 3255, 3310, 3380, 3435, 6600]
  return Math.max(0, boundaries.findIndex((end) => time < end))
}
