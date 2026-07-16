import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ZHOUYI_BENYI, zhouyiBenyiFor } from './zhouyi-benyi'

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const LINE_LABEL_FOR_POSITION = [
  /^(?:初九|初六)$/u,
  /^(?:九二|六二)$/u,
  /^(?:九三|六三)$/u,
  /^(?:九四|六四)$/u,
  /^(?:九五|六五)$/u,
  /^(?:上九|上六)$/u
]

describe('ZHOUYI_BENYI', () => {
  it('contains a complete, ordered commentary record for every hexagram', () => {
    expect(ZHOUYI_BENYI).toHaveLength(64)
    expect(ZHOUYI_BENYI.map((entry) => entry.ordinal)).toEqual(
      Array.from({ length: 64 }, (_, index) => index + 1)
    )

    for (const entry of ZHOUYI_BENYI) {
      expect(entry.glyph).not.toBe('')
      expect(entry.name).not.toBe('')
      expect(entry.statement).not.toBe('')
      expect(entry.statementCommentary).not.toBe('')
      expect(entry.lines).toHaveLength(6)

      entry.lines.forEach((line, index) => {
        expect(line.position).toBe(index + 1)
        expect(line.label).toMatch(LINE_LABEL_FOR_POSITION[index])
        expect(line.text).not.toBe('')
        expect(line.commentary).not.toBe('')
      })
    }
  })

  it('looks up the canonical text of the first hexagram', () => {
    const qian = zhouyiBenyiFor(1)

    expect(qian.name).toBe('乾')
    expect(qian.glyph).toBe('䷀')
    expect(qian.statement).toBe('元亨利貞')
    expect(qian.statementCommentary).not.toBe('')
    expect(qian.lines[0].label).toBe('初九')
    expect(qian.lines[0].text).toBe('潛龍勿用')
  })

  it('preserves a hexagram name when it is part of the canonical statement', () => {
    expect(zhouyiBenyiFor(10).statement).toBe('履虎尾不咥人亨')
    expect(zhouyiBenyiFor(13).statement).toBe('同人于野亨利涉大川利君子貞')
  })

  it('does not treat a line label mentioned in commentary as a primary line', () => {
    const tunFirstLine = zhouyiBenyiFor(3).lines[0]

    expect(tunFirstLine.text).toBe('磐桓利居貞利建侯')
    expect(tunFirstLine.commentary).toBe(
      '磐步干反○磐桓難進之貌屯難之初以陽在下又居動體而上應隂柔險陷之爻故有磐桓之象然居得其正故其占利於居貞又本成卦之主以陽下隂為民所歸侯之象也故其象又如此而占者如是則利建以為侯也'
    )
  })

  it.each([
    [27, '頤', '䷚'],
    [29, '坎', '䷜'],
    [32, '恆', '䷟'],
    [34, '大壯', '䷡'],
    [39, '蹇', '䷦'],
    [47, '困', '䷮'],
    [64, '未濟', '䷿']
  ] as const)('pins canonical name and glyph for ordinal %i', (ordinal, name, glyph) => {
    expect(zhouyiBenyiFor(ordinal)).toMatchObject({ name, glyph })
  })

  it('matches the pinned artifact semantic digest', () => {
    const digest = createHash('sha256')
      .update(JSON.stringify(ZHOUYI_BENYI))
      .digest('hex')

    expect(digest).toBe('3ffbdc1d3032ce284f7a32853fa609a648d7aa6d59b21b96f3a65ef5c6644e11')
  })

  it('runs importer parser self-checks without network access', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/import-zhouyi-benyi.mjs', '--self-check'],
      { cwd: REPOSITORY_ROOT, encoding: 'utf8', timeout: 30_000 }
    )
    const diagnostic = [result.error?.message, result.stderr, result.stdout]
      .filter(Boolean)
      .join('\n')

    expect(result.status, diagnostic).toBe(0)
    expect(result.stdout).toContain('Zhouyi Benyi importer self-check passed')
  })

  it('reports an explicit error for an unknown ordinal', () => {
    expect(() => zhouyiBenyiFor(0)).toThrowError('Zhouyi Benyi has no hexagram 0')
    expect(() => zhouyiBenyiFor(65)).toThrowError('Zhouyi Benyi has no hexagram 65')
  })
})
