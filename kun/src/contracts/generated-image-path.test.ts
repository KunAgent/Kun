import { describe, expect, it } from 'vitest'
import {
  CANVAS_GENERATED_IMAGE_FILE_PATTERN,
  KUN_GENERATED_IMAGE_DIR
} from './generated-image-path.js'

describe('canvas generated image paths', () => {
  it('emits the Kun directory and validates current receipts', () => {
    expect(KUN_GENERATED_IMAGE_DIR).toBe('.kun/images')
    expect(CANVAS_GENERATED_IMAGE_FILE_PATTERN.test('.kun/images/board.svg')).toBe(true)
  })

  it('accepts legacy receipts but rejects traversal', () => {
    expect(CANVAS_GENERATED_IMAGE_FILE_PATTERN.test('.deepseekgui-images/board.png')).toBe(true)
    expect(CANVAS_GENERATED_IMAGE_FILE_PATTERN.test('.kun/images/../board.png')).toBe(false)
  })
})
