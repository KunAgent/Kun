import { randomBytes } from 'node:crypto'
import { appendFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createDeepSeekHarnessSessionUsage,
  deepSeekHarnessUsageSamples,
  splitZstdFrames
} from './deepseek-harness-usage.js'

/** The first two frames of a real dsh-acp 0.2.0-rc.2 session log (session header, then permission/sandbox/approval records). */
const REAL_LOG_HEAD = Buffer.from('KLUv/QRY/QYAthA1IUCJ5gEYo4BW1WoBy378pMMaMeNLZJIsieC7MfZGRfl8TSoAKwAsAM6W0pqnRHHXUBlcQ+dUuyVbe/Qlpmjgx97wUa9+gw8zZmPtW3789HFZIQlt69tEo4Ssfj+AC4mowUV/YaOpFPFjd0g+DEFWQ9haybX0+Ab4X/hV8uFuWUnibSllUQ2lu27uVDPFY6cVE2MJRAMJgVb8I+j/oa33lV8wK32fsh8IAQALyGPm0j8wZnMhwS/e+bxdwOWxv/8jbMOHFXU60MdZaTPWkUPKyAurtCgCAAIXknqVJqrSb/QotS/9BFhNBADyhxocYKe2AQNorRZSzfcGZCY/DFMVKP4MqU8mACwOD8R7ZzqPSSBSWLOsmixsY06Bocs6yrCD5ckm3rs61iCAKsnNtIWOP+DT5fKErGMhxbGWkSAGXh3mngo8QfvpTlsbq2dZN3Oa8vHKkfshCwBRZQDbAWW7eEsLYp8SBjYGVHDx0jBoFmKmzEsdEEs=', 'base64')

const fixture = (name: string): Array<Record<string, unknown>> =>
  readFileSync(new URL(`./__fixtures__/${name}.jsonl`, import.meta.url), 'utf8')
    .split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)

const frame = (lines: readonly unknown[], params?: Record<number, number>): Buffer =>
  zstdCompressSync(Buffer.from(lines.map((line) => JSON.stringify(line)).join('\n') + '\n'), params ? { params } : {})

describe('splitZstdFrames', () => {
  it('splits the back-to-back frames of a real dsh session log', () => {
    const frames = splitZstdFrames(REAL_LOG_HEAD)
    expect(frames.map((part) => part.length)).toEqual([236, 150])
    expect(JSON.parse(zstdDecompressSync(frames[0]!).toString('utf8').split('\n')[0]!)).toMatchObject({ type: 'session', version: 4 })
  })

  it('walks every frame kind: plain, checksummed, no content size and multi-block', () => {
    const plain = frame([{ type: 'a' }])
    const checksummed = frame([{ type: 'b' }], { [constants.ZSTD_c_checksumFlag]: 1 })
    const unsized = frame([{ type: 'c' }], { [constants.ZSTD_c_contentSizeFlag]: 0 })
    // 300 KB that cannot be compressed: several 128 KB raw blocks in one frame.
    const large = zstdCompressSync(randomBytes(300_000))
    const all = Buffer.concat([plain, checksummed, unsized, large])
    const frames = splitZstdFrames(all)
    expect(frames.map((part) => part.length)).toEqual([plain.length, checksummed.length, unsized.length, large.length])
    expect(zstdDecompressSync(frames[1]!).toString('utf8')).toContain('"b"')
  })

  it('ignores a frame the writer has not finished and stops at anything that is not a frame', () => {
    const first = frame([{ type: 'a' }])
    const second = frame([{ type: 'b' }, { type: 'c' }])
    expect(splitZstdFrames(Buffer.concat([first, second.subarray(0, second.length - 3)])).map((part) => part.length)).toEqual([first.length])
    expect(splitZstdFrames(Buffer.concat([first, Buffer.from('not zstd at all')])).map((part) => part.length)).toEqual([first.length])
    expect(splitZstdFrames(Buffer.alloc(0))).toEqual([])
  })
})

describe('deepSeekHarnessUsageSamples', () => {
  it('reads the exact usage and stream timing of a one-call turn (real log)', () => {
    const [sample, ...rest] = deepSeekHarnessUsageSamples(fixture('dsh-session-single-step') as never)
    expect(rest).toEqual([])
    expect(sample!.model).toBe('deepseek-v4-flash')
    // input 5433 uncached + 384 cache read; 481 output tokens. Step began at 976491, the stream
    // opened at 979221 and its usage chunk arrived at 981566.
    expect(sample!.usage).toMatchObject({
      promptTokens: 5817, completionTokens: 481, totalTokens: 6298,
      cachedTokens: 384, cacheHitTokens: 384, cacheMissTokens: 5433,
      requestTtftMs: 2730, requestGenerationMs: 2345
    })
    expect(sample!.usage.cacheHitRate).toBeCloseTo(384 / 5817, 6)
  })

  it('gives each model call of a tool-using turn its own usage and timing (real log)', () => {
    const samples = deepSeekHarnessUsageSamples(fixture('dsh-session-tool-turn') as never)
    expect(samples.map((entry) => [entry.usage.promptTokens, entry.usage.completionTokens, entry.usage.requestTtftMs, entry.usage.requestGenerationMs]))
      .toEqual([[5818, 82, 1817, 689], [5918, 12, 1591, 478]])
    expect(samples.map((entry) => entry.usage.cacheHitTokens)).toEqual([5248, 5760])
  })

  it('keeps tokens when the stream or the step start is missing, and skips records without usage', () => {
    const base = { turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 } }
    const samples = deepSeekHarnessUsageSamples([
      { type: 'assistant/message', time: 5, data: base },
      { type: 'assistant/message', time: 6, data: { turn: 1, step: 2 } },
      { type: 'user/message', time: 7, data: { usage: base.usage } },
      { type: 'assistant/message', time: 8, data: { ...base, usage: { inputTokens: 0, outputTokens: 0 } } }
    ])
    expect(samples).toHaveLength(1)
    expect(samples[0]!.usage).toEqual({ promptTokens: 100, completionTokens: 10, totalTokens: 110, cacheHitRate: null, turns: 0 })
  })
})

describe('deepSeekHarnessSessionUsage', () => {
  const cleanup: string[] = []
  afterEach(async () => { for (const dir of cleanup.splice(0)) await rm(dir, { recursive: true, force: true }) })
  const SESSION = '3e4610d5-2583-4d9c-8120-6d2f03a37e6b'
  const source = createDeepSeekHarnessSessionUsage({ flushWaitMs: 60, pollMs: 5 })

  async function home(directory = '--work-project--'): Promise<{ root: string; log: string; input: { sessionId: string; workspace: string; env: Record<string, string> } }> {
    const root = await mkdtemp(join(tmpdir(), 'kun-dsh-home-'))
    cleanup.push(root)
    const dir = join(root, 'sessions', directory, SESSION)
    await mkdir(dir, { recursive: true })
    const log = join(dir, 'session.v4.jsonl.zstd')
    await writeFile(log, REAL_LOG_HEAD)
    return { root, log, input: { sessionId: SESSION, workspace: '/work/project', env: { DSH_HOME: root } } }
  }
  const turnFrames = (): Buffer[] => {
    const records = fixture('dsh-session-single-step')
    return [frame(records.slice(0, 2)), frame(records.slice(2))]
  }

  it('returns the calls appended after the mark, not the ones logged before it', async () => {
    const { log, input } = await home()
    await appendFile(log, frame([{ type: 'assistant/message', time: 1, data: { turn: 1, step: 1, usage: { inputTokens: 9, outputTokens: 9 } } }]))
    const mark = await source.begin(input)
    for (const part of turnFrames()) await appendFile(log, part)
    const samples = await source.collect(mark, input)
    expect(samples).toHaveLength(1)
    expect(samples[0]!.usage).toMatchObject({ completionTokens: 481, requestTtftMs: 2730 })
  })

  it('finds the log by scanning when the workspace directory is named differently', async () => {
    const { log, input } = await home('--some-other-name--')
    const mark = await source.begin(input)
    for (const part of turnFrames()) await appendFile(log, part)
    expect((await source.collect(mark, input))[0]!.usage.completionTokens).toBe(481)
  })

  it('waits for a log that is still being flushed, and uses what is complete', async () => {
    const { log, input } = await home()
    const mark = await source.begin(input)
    const [first, second] = turnFrames()
    await appendFile(log, first!)
    // The final frame lands a moment after the collector started waiting.
    setTimeout(() => { void appendFile(log, second!) }, 20)
    expect(await source.collect(mark, input)).toHaveLength(1)
    // A turn whose last frame never arrives yields nothing instead of failing the turn.
    const partial = await home()
    const partialMark = await source.begin(partial.input)
    await appendFile(partial.log, first!)
    expect(await source.collect(partialMark, partial.input)).toEqual([])
  })

  it('reports nothing for a missing log, an unsafe session id, a symlinked log or a log that did not grow', async () => {
    const { root, log, input } = await home()
    expect(await source.collect({ size: 0 }, { ...input, sessionId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' })).toEqual([])
    expect(await source.begin({ ...input, sessionId: '../../etc/passwd' })).toEqual({ size: 0 })
    expect(await source.collect({ size: 0 }, { ...input, sessionId: '../../etc/passwd' })).toEqual([])
    expect(await source.collect(await source.begin(input), input)).toEqual([])
    const linked = join(root, 'sessions', '--work-project--', 'linked-session-id-0001')
    await mkdir(linked, { recursive: true })
    await symlink(log, join(linked, 'session.v4.jsonl.zstd'))
    expect(await source.begin({ ...input, sessionId: 'linked-session-id-0001' })).toEqual({ size: 0 })
  })
})
