function basename(value: string): string {
  const normalized = value.replaceAll('\\', '/')
  return normalized.split('/').filter(Boolean).at(-1) ?? 'presentation.md'
}

function deckNameFromPath(value: string): string {
  const name = basename(value).replace(/\.(?:md|markdown)$/i, '')
  const safe = name.replace(/[^\p{L}\p{N}_.-]+/gu, '-').replace(/^-+|-+$/g, '')
  return safe || 'presentation'
}

/** The native PPT workflow intentionally accepts only plain Markdown, not MDX. */
export function isPresentationMarkdownPath(path: string | null | undefined): boolean {
  return Boolean(path && /\.(?:md|markdown)$/i.test(path.trim()))
}

/**
 * Starts a Write one-click deck with the slides skill (the leading `/slides`
 * activates it) while keeping the source-file contract visible in the exact
 * user turn.
 */
export function buildWritePresentationPrompt(input: {
  workspaceRoot: string
  sourcePath: string
}): string {
  const deckName = deckNameFromPath(input.sourcePath)
  return [
    '/slides 把当前 Markdown 制作为原生可编辑的 PPTX。',
    '',
    `唯一内容来源 Markdown：${input.sourcePath}`,
    `工作区：${input.workspaceRoot}`,
    `PPTD 源文件：presentations/${deckName}/deck.pptd`,
    `最终文件：presentations/${deckName}.pptx`,
    '',
    '这是 Work 一键生成：跳过视觉方向选择，根据内容和设计规范自动确定结构与视觉方案，先用 ppt_preview 生成完整预览供评审，获得批准后再用 ppt_export 导出 PPTX。',
    '不要修改、重命名或移动来源 Markdown。'
  ].join('\n')
}
