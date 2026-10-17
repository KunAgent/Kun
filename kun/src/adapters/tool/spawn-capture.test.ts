import { describe, expect, it } from 'vitest'
import { spawnCapture } from './builtin-tool-utils.js'

describe('spawnCapture output bounds', () => {
  it('caps combined stdout and stderr and terminates the producer', async () => {
    const result = await spawnCapture(
      process.execPath,
      ['-e', "process.stdout.write('x'.repeat(1024 * 1024)); process.stderr.write('y'.repeat(1024 * 1024))"],
      { cwd: process.cwd(), maxOutputBytes: 4096 }
    )

    expect(result.outputTruncated).toBe(true)
    expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(4096)
  })

  it('terminates a helper when its configured timeout expires', async () => {
    const result = await spawnCapture(
      process.execPath,
      ['-e', 'setTimeout(() => process.exit(0), 3_000)'],
      { cwd: process.cwd(), timeoutMs: 100 }
    )

    expect(result.timedOut).toBe(true)
  })

  it('stops the producer once it has emitted the requested number of rows', async () => {
    const started = Date.now()
    const result = await spawnCapture(
      process.execPath,
      ['-e', "let i = 0; const t = setInterval(() => { process.stdout.write(`row ${i++}\\n`) }, 5); setTimeout(() => { clearInterval(t) }, 5_000)"],
      { cwd: process.cwd(), maxLines: 3, timeoutMs: 4_000, lowPriority: true }
    )

    expect(result.lineLimitReached).toBe(true)
    expect(result.timedOut).toBe(false)
    expect(result.stdout.split('\n').filter(Boolean)).toEqual(['row 0', 'row 1', 'row 2'])
    expect(Date.now() - started).toBeLessThan(3_000)
  })

  it('reports no line limit when the producer finishes first', async () => {
    const result = await spawnCapture(
      process.execPath,
      ['-e', "process.stdout.write('a\\nb\\n')"],
      { cwd: process.cwd(), maxLines: 10 }
    )
    expect(result).toMatchObject({ lineLimitReached: false, exitCode: 0, stdout: 'a\nb\n' })
  })
})
