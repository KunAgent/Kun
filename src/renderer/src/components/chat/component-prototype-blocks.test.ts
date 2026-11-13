import { describe, expect, it } from 'vitest'
import type { ToolBlock } from '../../agent/types'
import { latestComponentPrototypeBlocks } from './component-prototype-blocks'

const PROTOTYPE_PATH = '.kun-design/component-prototypes/conversation-ink/prototype.html'

function block(
  id: string,
  prototype: Record<string, unknown> | undefined,
  overrides: Partial<ToolBlock> = {}
): ToolBlock {
  return {
    kind: 'tool',
    id,
    turnId: 'turn-1',
    summary: 'design_component',
    status: 'success',
    toolKind: 'file_change',
    meta: prototype ? { toolName: 'design_component', componentPrototype: prototype } : { toolName: 'design_component' },
    ...overrides
  } as unknown as ToolBlock
}

function prototype(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    status: 'completed',
    artifactId: 'component_aaaaaaaaaaaaaaaa',
    title: 'Conversation view',
    relativePath: PROTOTYPE_PATH,
    viewport: { width: 1200, height: 900 },
    producer: 'main-agent',
    ...overrides
  }
}

describe('latestComponentPrototypeBlocks', () => {
  it('keeps one card when a turn republishes the same prototype file', () => {
    const first = block('tool-1', prototype({ artifactId: 'component_aaaaaaaaaaaaaaaa' }))
    const second = block('tool-2', prototype({
      artifactId: 'component_bbbbbbbbbbbbbbbb',
      contentHash: 'b'.repeat(64)
    }))

    expect(latestComponentPrototypeBlocks([first, second])).toEqual([second])
  })

  it('keeps separate cards for separate prototype files', () => {
    const first = block('tool-1', prototype())
    const second = block('tool-2', prototype({
      artifactId: 'component_bbbbbbbbbbbbbbbb',
      relativePath: '.kun-design/component-prototypes/other/prototype.html'
    }))

    expect(latestComponentPrototypeBlocks([first, second])).toEqual([first, second])
  })

  it('keeps the last published card when a newer call fails', () => {
    const published = block('tool-1', prototype())
    const failed = block('tool-2', prototype({
      artifactId: 'component_bbbbbbbbbbbbbbbb',
      status: 'failed',
      error: 'publish failed'
    }), { status: 'error' })

    expect(latestComponentPrototypeBlocks([published, failed])).toEqual([published])
  })

  it('keeps the newest call while the republish is still running', () => {
    const published = block('tool-1', prototype())
    const running = block('tool-2', prototype({
      artifactId: 'component_bbbbbbbbbbbbbbbb',
      status: 'preparing'
    }), { status: 'running' })

    expect(latestComponentPrototypeBlocks([published, running])).toEqual([running])
  })

  it('falls back to the block id when the metadata is unreadable', () => {
    const readable = block('tool-1', prototype())
    const broken = block('tool-2', undefined)

    expect(latestComponentPrototypeBlocks([readable, broken])).toEqual([readable, broken])
  })

  it('compares the prototype path case-insensitively', () => {
    const first = block('tool-1', prototype())
    const second = block('tool-2', prototype({
      artifactId: 'component_bbbbbbbbbbbbbbbb',
      relativePath: PROTOTYPE_PATH.toUpperCase()
    }))

    expect(latestComponentPrototypeBlocks([first, second])).toEqual([second])
  })
})
