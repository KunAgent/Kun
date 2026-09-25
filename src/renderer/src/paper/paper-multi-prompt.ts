import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'

export type PaperMultiTask = 'compare' | 'related-work'

/** `notes/<task>-YYYYMMDD-HHmm.md`, library-relative. */
export function paperMultiOutputPath(task: PaperMultiTask, now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  return `notes/${task === 'compare' ? '对比阅读' : '相关工作'}-${stamp}.md`
}

function citeLabel(entry: PaperLibraryEntry): string {
  const meta = entry.meta
  const first = meta.authors[0]?.split(/\s+/).at(-1) ?? ''
  return meta.citeKey || [first, meta.year].filter(Boolean).join(meta.year ? ' ' : '') || meta.title
}

/**
 * Multi-paper assistant task over library units (compare / related work).
 * Only facts and file locations go in; the agent reads each unit's files with
 * its own tools and writes one Markdown file under notes/.
 */
export function buildPaperMultiPrompt(input: {
  task: PaperMultiTask
  entries: readonly PaperLibraryEntry[]
  outputPath: string
}): string {
  const header = input.task === 'compare'
    ? '对比阅读下面这些论文，写一份对比笔记。'
    : '基于下面这些论文写一节「相关工作」（Related Work）。'
  const papers = input.entries.map((entry, index) => {
    const dir = entry.unitDir.replace(/\/+$/, '')
    const meta = entry.meta
    return [
      `${index + 1}. ${meta.title}${meta.year ? ` (${meta.year})` : ''}${meta.venue ? ` · ${meta.venue}` : ''}`,
      `   引用键：${citeLabel(entry)}；目录：${dir}`,
      `   读取：${dir}/paper.json、${dir}/paper.md（如有，按页标记）、${dir}/NOTES.md、${dir}/marks/annotations.json（用户高亮，重点参考）`
    ].join('\n')
  })
  const structure = input.task === 'compare'
    ? [
        '结构：',
        '## 一句话概括（每篇一句）',
        '## 对比表（问题 / 方法 / 数据与实验 / 主要结果 / 局限）',
        '## 共同点与关键差异',
        '## 我该怎么选 / 还有什么没解决'
      ]
    : [
        '结构：按主题分 2–4 段，每段先给主题句，再用 [@引用键] 串联论文，最后一段说明这些工作的不足。',
        '文末用「## 参考文献」列出每篇论文（作者、年份、标题、会议/arXiv）。'
      ]
  return [
    '$paper-library',
    header,
    '',
    '论文：',
    ...papers,
    '',
    ...structure,
    '',
    '规则：论文里没写的内容不要编；缺少 paper.md 时先读 NOTES.md 和 paper.json 里的摘要，并在文中注明信息有限。',
    `输出文件（只写这个文件）：${input.outputPath}`
  ].join('\n')
}
