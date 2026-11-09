import {
  PET_ROWS,
  PET_SHEET_COLUMNS,
  petSheetRowsForVersion,
  type PetAnimationState,
  type PetSpriteVersion
} from '@shared/pets'

export type AnimationFrame = { row: number; column: number; backgroundPosition: string }

export function framePosition(row: number, column: number, sheetRows: number): string {
  const x = PET_SHEET_COLUMNS <= 1 ? 0 : (column / (PET_SHEET_COLUMNS - 1)) * 100
  const y = sheetRows <= 1 ? 0 : (row / (sheetRows - 1)) * 100
  return `${x}% ${y}%`
}

export function frameDurationMs(state: PetAnimationState, frameIndex: number): number {
  const row = PET_ROWS[state]
  const duration = row.frameDurationsMs[frameIndex] ?? row.frameDurationsMs[0] ?? 0
  return duration
}

/** Wake at a sprite boundary instead of rendering unchanged frames every refresh. */
export function nextFrameDelayMs(state: PetAnimationState, elapsedMs: number): number {
  const cycle = totalCycleDurationMs(state)
  if (state !== 'idle' && elapsedMs >= cycle * 3) return nextFrameDelayMs('idle', elapsedMs - cycle * 3)
  const wrapped = Math.max(0, elapsedMs) % cycle
  let boundary = 0
  for (let index = 0; index < PET_ROWS[state].frames; index++) {
    boundary += frameDurationMs(state, index)
    if (boundary > wrapped) return boundary - wrapped
  }
  return 1
}

export function totalCycleDurationMs(state: PetAnimationState): number {
  const row = PET_ROWS[state]
  let total = 0
  for (let index = 0; index < row.frames; index += 1) total += frameDurationMs(state, index)
  return total
}

export function frameAtElapsedMs(state: PetAnimationState, elapsedMs: number, version: PetSpriteVersion = 1): AnimationFrame {
  const sheetRows = petSheetRowsForVersion(version)
  if (state !== 'idle') {
    const cycle = totalCycleDurationMs(state)
    const limit = cycle * 3
    if (elapsedMs >= limit) return frameAtElapsedMs('idle', elapsedMs - limit, version)
  }
  return frameInCycle(state, elapsedMs, sheetRows)
}

export function staticFrame(state: PetAnimationState, version: PetSpriteVersion = 1): AnimationFrame {
  const sheetRows = petSheetRowsForVersion(version)
  return {
    row: PET_ROWS[state].row,
    column: 0,
    backgroundPosition: framePosition(PET_ROWS[state].row, 0, sheetRows)
  }
}

function frameInCycle(state: PetAnimationState, elapsedMs: number, sheetRows: number): AnimationFrame {
  const row = PET_ROWS[state]
  const cycle = totalCycleDurationMs(state)
  const wrapped = cycle > 0 ? elapsedMs % cycle : 0
  let accumulated = 0
  for (let index = 0; index < row.frames; index += 1) {
    accumulated += frameDurationMs(state, index)
    if (wrapped < accumulated) {
      return { row: row.row, column: index, backgroundPosition: framePosition(row.row, index, sheetRows) }
    }
  }
  const last = row.frames - 1
  return { row: row.row, column: last, backgroundPosition: framePosition(row.row, last, sheetRows) }
}
