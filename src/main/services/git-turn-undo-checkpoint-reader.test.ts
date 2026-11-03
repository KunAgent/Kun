import { describe, expect, it } from 'vitest'
import { execGitBuffer } from './git-turn-undo-checkpoint-reader'

describe('execGitBuffer stdin', () => {
  it('settles from the exit status when git exits without reading its input', async () => {
    // More input than a pipe buffers, so the write is still pending when git
    // exits; the closed pipe must not surface as an uncaught EPIPE.
    const stdout = await execGitBuffer(process.cwd(), ['--version'], {}, 'x'.repeat(8 * 1024 * 1024))
    expect(stdout.toString('utf8')).toMatch(/^git version /u)
  })
})
