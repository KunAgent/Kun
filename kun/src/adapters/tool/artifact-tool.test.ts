import { describe, expect, it, vi } from 'vitest'
import { createReadArtifactTool } from './artifact-tool.js'
import { InMemoryArtifactStore } from '../../artifacts/artifact-store.js'
import type { ToolHostContext } from '../../ports/tool-host.js'

function context(artifactStore?: ToolHostContext['artifactStore']): ToolHostContext {
  return {
    threadId: 't', turnId: 'tn', workspace: '/ws', approvalPolicy: 'auto',
    abortSignal: new AbortController().signal, awaitApproval: vi.fn(async () => 'allow' as const),
    ...(artifactStore ? { artifactStore } : {})
  }
}

describe('read_artifact tool', () => {
  it('reads full content + metadata by id', async () => {
    const store = new InMemoryArtifactStore(() => 't0')
    const { meta } = await store.put({ content: 'hello world', source: 'mcp', origin: 'docs' })
    const tool = createReadArtifactTool()
    const result = await tool.execute({ artifactId: meta.id }, context(store))
    expect(result.output).toMatchObject({ content: 'hello world', source: 'mcp', origin: 'docs' })
  })

  it('reads a line range', async () => {
    const store = new InMemoryArtifactStore()
    const { meta } = await store.put({ content: 'l1\nl2\nl3\nl4' })
    const tool = createReadArtifactTool()
    const result = await tool.execute({ artifactId: meta.id, startLine: 2, endLine: 3 }, context(store))
    expect(result.output).toMatchObject({ content: 'l2\nl3', range: { startLine: 2, endLine: 3 } })
  })

  it('bounds a no-range read and returns a cursor for a large artifact', async () => {
    const { ARTIFACT_MAX_READ_BYTES } = await import('../../artifacts/artifact-store.js')
    const store = new InMemoryArtifactStore(() => 't0')
    const { meta } = await store.put({ content: 'y'.repeat(ARTIFACT_MAX_READ_BYTES + 1_000) })
    const tool = createReadArtifactTool()
    const result = await tool.execute({ artifactId: meta.id }, context(store))
    const out = result.output as Record<string, unknown>
    expect(Buffer.byteLength(String(out.content), 'utf8')).toBe(ARTIFACT_MAX_READ_BYTES)
    expect(out.truncated).toBe(true)
    expect(out.nextOffset).toBe(ARTIFACT_MAX_READ_BYTES)
  })

  it('errors for an unknown artifact', async () => {
    const tool = createReadArtifactTool()
    const result = await tool.execute({ artifactId: 'art_missing' }, context(new InMemoryArtifactStore()))
    expect(result.isError).toBe(true)
  })

  it('errors when the artifact store is unavailable', async () => {
    const tool = createReadArtifactTool()
    const result = await tool.execute({ artifactId: 'art_x' }, context())
    expect(result.isError).toBe(true)
  })
})
