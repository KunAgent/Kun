import { describe, expect, it } from 'vitest'
import {
  buildMemoryImportContent,
  buildMemoryMarkdownExport,
  defaultMemoryExportFileName,
  memoryImportObservedAt,
  parseMemoryImport,
  parseMemoryProfileImport
} from './memory-import-export'

describe('parseMemoryProfileImport', () => {
  it('extracts dated profile entries from a fenced code block', () => {
    const entries = parseMemoryProfileImport(`
前置说明
\`\`\`
指令
[2026-07-01] - 回答要直接。

身份
[unknown] - 会中文和英文。

偏好
[2026-07-02] - 喜欢紧凑的技术解释。
\`\`\`
后置说明
`)

    expect(entries).toEqual([
      {
        date: '2026-07-01',
        category: '指令',
        content: '回答要直接。',
        tags: ['imported', '指令', 'instruction']
      },
      {
        date: 'unknown',
        category: '身份',
        content: '会中文和英文。',
        tags: ['imported', '身份', 'identity']
      },
      {
        date: '2026-07-02',
        category: '偏好',
        content: '喜欢紧凑的技术解释。',
        tags: ['imported', '偏好', 'preference']
      }
    ])
  })

  it('ignores prompt text and malformed lines', () => {
    const entries = parseMemoryProfileImport(`
复制以下提示词到其他AI对话中：
指令：我明确要求遵循的规则
[not-a-date] - 忽略我
[2026-07-01] - 保留我
`)

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      date: '2026-07-01',
      category: '指令',
      content: '保留我'
    })
  })

  it('builds stable imported memory content', () => {
    expect(buildMemoryImportContent({
      date: 'unknown',
      category: '项目',
      content: 'Kun: 桌面 AI 应用。',
      tags: []
    })).toBe('[unknown] 项目: Kun: 桌面 AI 应用。')
    expect(memoryImportObservedAt('2026-07-01')).toBe('2026-07-01T00:00:00.000Z')
    expect(memoryImportObservedAt('2026-02-30')).toBeUndefined()
    expect(memoryImportObservedAt('unknown')).toBeUndefined()
  })
})

describe('buildMemoryMarkdownExport', () => {
  it('exports grouped memory records as markdown', () => {
    const markdown = buildMemoryMarkdownExport({
      exportedAt: '2026-07-03T00:00:00.000Z',
      records: [
        {
          id: 'mem_1',
          content: '[2026-07-01] 指令: 回答要直接。',
          scope: 'user',
          tags: ['imported', '指令'],
          createdAt: '2026-07-04T00:00:00.000Z',
          updatedAt: '2026-07-04T00:00:00.000Z'
        },
        {
          id: 'mem_2',
          content: '偏好: 喜欢 TypeScript。',
          scope: 'workspace',
          workspace: '/tmp/kun',
          tags: ['preference'],
          createdAt: '2026-07-02T00:00:00.000Z',
          updatedAt: '2026-07-02T00:00:00.000Z',
          disabledAt: '2026-07-03T00:00:00.000Z'
        },
        {
          id: 'mem_deleted',
          content: '不要导出',
          scope: 'user',
          tags: ['other'],
          createdAt: '2026-07-02T00:00:00.000Z',
          updatedAt: '2026-07-02T00:00:00.000Z',
          deletedAt: '2026-07-03T00:00:00.000Z'
        }
      ]
    })

    expect(markdown).toContain('# Kun 记忆导出')
    expect(markdown).toContain('记录数量: 2')
    expect(markdown).toContain('## 指令')
    expect(markdown).toContain('[2026-07-01] - 回答要直接。')
    expect(markdown).not.toContain('[2026-07-04] - 回答要直接。')
    expect(markdown).toContain('## 偏好')
    expect(markdown).toContain('[2026-07-02] - 偏好: 喜欢 TypeScript。 [disabled] (workspace: /tmp/kun)')
    expect(markdown).not.toContain('不要导出')
  })

  it('uses a dated default export filename', () => {
    expect(defaultMemoryExportFileName(new Date('2026-07-03T12:00:00.000Z'))).toBe('kun-memory-export-2026-07-03.md')
  })

  it('round-trips portable V2 business fields without identity or audit timestamps', () => {
    const markdown = buildMemoryMarkdownExport({
      exportedAt: '2026-07-03T00:00:00.000Z',
      records: [{
        schemaVersion: 2,
        id: 'mem_original',
        content: 'Portable workspace fact',
        scope: 'workspace',
        workspace: 'D:/workspace-a',
        tags: ['portable', 'fact'],
        confidence: 0.7,
        type: 'fact',
        authority: 'reference',
        importance: 0.8,
        observedAt: '2026-06-01T00:00:00.000Z',
        validFrom: '2026-06-01T00:00:00.000Z',
        validTo: '2026-12-01T00:00:00.000Z',
        expiresAt: '2027-01-01T00:00:00.000Z',
        sources: [{
          id: 'source_1',
          kind: 'user',
          threadId: 'thread_1',
          turnId: 'turn_1',
          itemId: 'item_1',
          locator: 'memory-settings',
          excerpt: 'bounded evidence',
          contentHash: 'sha256:test',
          trust: 'explicit-user'
        }],
        createdAt: '2026-06-02T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z',
        disabledAt: '2026-06-04T00:00:00.000Z'
      }]
    })

    const parsed = parseMemoryImport(markdown)
    expect(parsed.kind).toBe('portable')
    if (parsed.kind !== 'portable') throw new Error('expected portable memory archive')
    expect(parsed.records).toEqual([{
      schemaVersion: 2,
      content: 'Portable workspace fact',
      scope: 'workspace',
      workspace: 'D:/workspace-a',
      tags: ['portable', 'fact'],
      confidence: 0.7,
      type: 'fact',
      authority: 'reference',
      importance: 0.8,
      observedAt: '2026-06-01T00:00:00.000Z',
      validFrom: '2026-06-01T00:00:00.000Z',
      validTo: '2026-12-01T00:00:00.000Z',
      expiresAt: '2027-01-01T00:00:00.000Z',
      sources: [{
        id: 'source_1',
        kind: 'user',
        threadId: 'thread_1',
        turnId: 'turn_1',
        itemId: 'item_1',
        locator: 'memory-settings',
        excerpt: 'bounded evidence',
        contentHash: 'sha256:test',
        trust: 'explicit-user'
      }],
      disabled: true
    }])
    expect(parsed.records[0]).not.toHaveProperty('id')
    expect(parsed.records[0]).not.toHaveProperty('createdAt')
    expect(parsed.records[0]).not.toHaveProperty('updatedAt')
  })

  it('rejects malformed or unsupported portable archives without profile fallback', () => {
    expect(parseMemoryImport('```kun-memory-v2\n{"format":"kun-memory-v2","version":2}\n```').kind)
      .toBe('invalid-portable')
    expect(parseMemoryImport('```kun-memory-v3\n{}\n```').kind).toBe('invalid-portable')
  })
})
