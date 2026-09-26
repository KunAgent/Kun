import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MemoryFeedbackTiebreakerDevelopmentArtifact } from './memory-feedback-tiebreaker-contracts.js'
import { assertMemoryFeedbackTiebreakerPrivateArtifact } from './memory-feedback-tiebreaker-privacy.js'

const developmentPath = fileURLToPath(new URL(
  './fixtures/memory-feedback-tiebreaker-development.v1.json',
  import.meta.url
))

describe('memory feedback tiebreaker artifact privacy', () => {
  it('accepts the bounded synthetic development artifact', async () => {
    const artifact = MemoryFeedbackTiebreakerDevelopmentArtifact.parse(
      JSON.parse(await readFile(developmentPath, 'utf8'))
    )
    expect(() => assertMemoryFeedbackTiebreakerPrivateArtifact(artifact)).not.toThrow()
  })

  it.each([
    ['query text', { query: 'synthetic query' }],
    ['Memory content', { memoryContent: 'synthetic content' }],
    ['source excerpt', { sourceExcerpt: 'synthetic excerpt' }],
    ['credential', { diagnostic: 'api_key=fixture-secret' }],
    ['Windows path', { diagnostic: 'at C:\\Users\\Fixture\\memory.json' }],
    ['UNC path', { diagnostic: '\\\\server\\share\\memory.json' }],
    ['POSIX path', { diagnostic: 'at /home/fixture/memory.json' }],
    ['file URL', { diagnostic: 'file:///tmp/memory.json' }],
    ['email identity', { diagnostic: 'fixture@example.com' }],
    ['oversized diagnostic', { diagnostic: 'x'.repeat(513) }]
  ])('rejects %s without echoing its value', (_label, artifact) => {
    let message = ''
    try {
      assertMemoryFeedbackTiebreakerPrivateArtifact(artifact)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toMatch(/memory feedback tiebreaker artifact/u)
    expect(message).not.toContain(Object.values(artifact)[0]!)
  })
})
