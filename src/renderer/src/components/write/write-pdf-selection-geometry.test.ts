import { describe, expect, it } from 'vitest'
import { viewportRectToPageLocalRect } from './write-pdf-selection-geometry'

describe('Write PDF selection geometry', () => {
  it('keeps viewport coordinates unchanged without UI scaling', () => {
    expect(viewportRectToPageLocalRect(
      { left: 180, top: 500, right: 540, bottom: 516 },
      { left: 10, top: 220, right: 714, bottom: 1100, width: 704, height: 880 },
      { width: 704, height: 880 }
    )).toEqual({ x: 170, y: 280, width: 360, height: 16 })
  })

  it('removes the app UI zoom before positioning the page overlay', () => {
    expect(viewportRectToPageLocalRect(
      { left: 281.25, top: 530, right: 617.5, bottom: 544.375 },
      { left: 10, top: 220, right: 890, bottom: 1320, width: 880, height: 1100 },
      { width: 704, height: 880 }
    )).toEqual({ x: 217, y: 248, width: 269, height: 11.5 })
  })
})
