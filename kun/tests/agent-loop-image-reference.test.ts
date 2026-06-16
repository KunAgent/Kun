import { describe, expect, it } from 'vitest'
import { buildImageGenerationReferenceInstructions } from '../src/loop/agent-loop.js'

describe('image generation reference instructions', () => {
  it('lists workspace-relative image paths when generate_image is available', () => {
    const instructions = buildImageGenerationReferenceInstructions({
      workspace: '/workspace/app',
      tools: [{ name: 'generate_image' }],
      imageAttachments: [
        {
          name: 'source.png',
          mimeType: 'image/png',
          localFilePath: '/workspace/app/assets/source.png'
        }
      ],
      textFallbacks: []
    })

    expect(instructions).toHaveLength(1)
    expect(instructions[0]).toContain('reference_image_paths')
    expect(instructions[0]).toContain('assets/source.png')
  })

  it('does not add guidance when the image tool is not available', () => {
    expect(buildImageGenerationReferenceInstructions({
      workspace: '/workspace/app',
      tools: [{ name: 'read' }],
      imageAttachments: [
        { name: 'source.png', mimeType: 'image/png', localFilePath: '/workspace/app/source.png' }
      ],
      textFallbacks: []
    })).toEqual([])
  })

  it('does not expose local paths outside the workspace', () => {
    const instructions = buildImageGenerationReferenceInstructions({
      workspace: '/workspace/app',
      tools: [{ name: 'generate_image' }],
      imageAttachments: [
        { name: 'clip.png', mimeType: 'image/png', localFilePath: '/tmp/clip.png' }
      ],
      textFallbacks: []
    })

    expect(instructions).toEqual([])
  })
})
