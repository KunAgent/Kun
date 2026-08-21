import { describe, expect, it } from 'vitest'
import { buildImageAnnotationPrompt, imageAnnotationDisplayText } from './image-annotation-prompt'

describe('buildImageAnnotationPrompt', () => {
  const path = '.deepseekgui-images/annotated-20260628-aabbccdd.png'

  it('drives the image-to-image lane with the annotated PNG as the reference', () => {
    const prompt = buildImageAnnotationPrompt({ annotatedRelativePath: path })
    expect(prompt).toContain('generate_image')
    expect(prompt).toContain('reference_image_paths')
    expect(prompt).toContain(path)
    expect(prompt).toContain('源 shape')
    expect(prompt).toContain('新版本')
    expect(prompt).not.toContain('用返回的新图 update')
  })

  it('tells the model to strip the markup and not build a screen / HTML', () => {
    const prompt = buildImageAnnotationPrompt({ annotatedRelativePath: path })
    expect(prompt).toContain('不要')
    expect(prompt).toContain('HTML')
    // No new screen / page.
    expect(prompt.toLowerCase()).toContain('screen')
  })

  it('lists text notes when present and omits the section otherwise', () => {
    const withNotes = buildImageAnnotationPrompt({
      annotatedRelativePath: path,
      textNotes: ['改成闪电', '换个颜色']
    })
    expect(withNotes).toContain('- 改成闪电')
    expect(withNotes).toContain('- 换个颜色')

    const without = buildImageAnnotationPrompt({ annotatedRelativePath: path })
    expect(without).not.toContain('文字批注')
  })

  it('dedupes and trims text notes, dropping blanks', () => {
    const prompt = buildImageAnnotationPrompt({
      annotatedRelativePath: path,
      textNotes: [' 改成闪电 ', '改成闪电', '   ', '']
    })
    const occurrences = prompt.split('- 改成闪电').length - 1
    expect(occurrences).toBe(1)
  })

  it('appends a freeform instruction when provided', () => {
    const prompt = buildImageAnnotationPrompt({
      annotatedRelativePath: path,
      instruction: '整体更有科技感'
    })
    expect(prompt).toContain('补充说明：整体更有科技感')
  })
})

describe('imageAnnotationDisplayText', () => {
  it('prefers the freeform instruction', () => {
    expect(imageAnnotationDisplayText({ instruction: '改成闪电', textNotes: ['x'] })).toBe(
      '按图片批注修改：改成闪电'
    )
  })

  it('falls back to joined notes, then a generic label', () => {
    expect(imageAnnotationDisplayText({ textNotes: ['改成闪电', '换色'] })).toBe(
      '按图片批注修改：改成闪电、换色'
    )
    expect(imageAnnotationDisplayText({})).toBe('按图片上的批注修改这张图')
  })
})
