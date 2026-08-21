import { describe, expect, it } from 'vitest'
import {
  KUN_GENERATED_IMAGE_DIR,
  WORKSPACE_GENERATED_IMAGE_FILE_PATTERN,
  isWorkspaceGeneratedImagePath
} from './generated-image-path'

describe('generated image paths', () => {
  it('uses the Kun directory for new images', () => {
    expect(KUN_GENERATED_IMAGE_DIR).toBe('.kun/images')
    expect(WORKSPACE_GENERATED_IMAGE_FILE_PATTERN.test('.kun/images/annotated.png')).toBe(true)
  })

  it('recognizes legacy references without accepting traversal', () => {
    expect(isWorkspaceGeneratedImagePath('.deepseekgui-images/old.png')).toBe(true)
    expect(WORKSPACE_GENERATED_IMAGE_FILE_PATTERN.test('.deepseekgui-images/old.png')).toBe(true)
    expect(WORKSPACE_GENERATED_IMAGE_FILE_PATTERN.test('.kun/images/../escaped.png')).toBe(false)
  })
})
