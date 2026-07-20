import { describe, expect, it } from 'vitest'
import {
  reportPublicationSafetyIssues,
  type CitationBinding
} from '../src/research/index.js'
import {
  reportBodyUrlIssue,
  sanitizeReportBodyUrls,
  sanitizeUncitedResolvedSentences
} from '../src/research/evidence/CitationProximity.js'

describe('reportPublicationSafetyIssues', () => {
  it('uses the existing URL cleaner for raw or model-authored links', () => {
    const reference = '[1]: https://developer.mozilla.org/docs/Web/HTTP/Caching'
    const raw = '可参阅 https://developer.mozilla.org/docs/Web/HTTP/Caching。'
    const authoredLink = '可参阅 [MDN 缓存文档](https://developer.mozilla.org/docs/Web/HTTP/Caching)。'

    expect(reportBodyUrlIssue(reference)).toBeUndefined()
    expect(reportBodyUrlIssue(raw)).toContain('https://')
    expect(reportBodyUrlIssue(authoredLink)).toContain('[MDN 缓存文档]')
    expect(sanitizeReportBodyUrls(authoredLink)).toBe('可参阅 MDN 缓存文档。')
  })

  it('blocks garbled text, leaked protocol markers, and broken markdown', () => {
    const issues = reportPublicationSafetyIssues([
      '# 报告',
      '## 主要发现',
      '### 机制',
      '正文出现乱码 ï»¿ 和 [claim:claim_1]。',
      '```text',
      '未闭合代码块'
    ].join('\n')).join('\n')

    expect(issues).toContain('乱码')
    expect(issues).toContain('内部 claim/evidence')
    expect(issues).toContain('Markdown 结构不完整')
  })

  it('removes and blocks citation-only fragments left by prose cleanup', () => {
    const malformed = '# 报告\n\n## 主要发现\n\n### 机制\n\n。 [1]\n\n有效事实。 [1]'

    expect(sanitizeUncitedResolvedSentences(malformed)).not.toContain('。 [1]\n')
    expect(reportPublicationSafetyIssues(malformed).join('\n')).toContain('只剩标点和引用')
  })

  it('blocks the same claim evidence across findings sections', () => {
    const citation = makeCitation('cit_1', 'claim_1', '官方文件确认该机制需要重新验证。')
    const markdown = [
      '# 报告',
      '## 主要发现',
      '### 定义',
      `${citation.reportClaimText} <sup data-citation-id="cit_1"><a href="https://example.com/a">[1]</a></sup>`,
      '### 应用',
      `${citation.reportClaimText} <sup data-citation-id="cit_1"><a href="https://example.com/a">[1]</a></sup>`
    ].join('\n\n')

    expect(reportPublicationSafetyIssues(markdown, [citation]).join('\n')).toContain('重复使用了同一条 claim 证据')
  })

  it('allows different claims from one source and summary or conclusion reuse', () => {
    const first = makeCitation('cit_1', 'claim_1', '官方文件定义了缓存的新鲜度。')
    const second = makeCitation('cit_2', 'claim_2', '官方文件说明验证发生在复用之前。')
    const markdown = [
      '# 报告',
      '## 摘要',
      `${first.reportClaimText} [1]`,
      '## 主要发现',
      '### 定义',
      `${first.reportClaimText} <sup data-citation-id="cit_1"><a href="https://example.com/a">[1]</a></sup>`,
      '### 验证',
      `${second.reportClaimText} <sup data-citation-id="cit_2"><a href="https://example.com/a">[1]</a></sup>`,
      '## 结论',
      `${first.reportClaimText} [1]`
    ].join('\n\n')

    expect(reportPublicationSafetyIssues(markdown, [first, second])).toEqual([])
  })
})

function makeCitation(id: string, claimId: string, reportClaimText: string): CitationBinding {
  return {
    id,
    displayId: '1',
    reportPath: 'report.md',
    reportAnchor: `claim:${claimId}:1`,
    reportClaimText,
    claimId,
    evidenceSpanIds: ['span_1'],
    status: 'verified',
    verifiedAt: '2026-07-20T00:00:00.000Z'
  }
}
