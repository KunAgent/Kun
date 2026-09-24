import type { PaperUnitMeta } from '@shared/paper/paper-meta-v2'
import { DEFAULT_PAPER_INTERPRET_TEMPLATE } from '@shared/paper/paper-interpret-template'
import { paperUnitSlugFromDir } from './paper-unit'

export type PaperInterpretLanguage = 'zh' | 'en' | 'auto'

/** `1706.03762` → `17060376` — boardIds only allow [a-zA-Z0-9_-]. */
export function paperBoardSlug(slug: string): string {
  const cleaned = slug.replace(/[^a-zA-Z0-9_-]/g, '')
  return cleaned.slice(0, 8) || 'paper'
}

function languageLine(language: PaperInterpretLanguage): string {
  if (language === 'en') return 'English; keep technical terms as in the paper.'
  if (language === 'auto') return '跟随论文正文语言（英文论文用英文写，中文论文用中文写）；术语保持论文中的写法。'
  return '简体中文；术语保持英文。'
}

/**
 * Host facts + contract wrapper around the user's interpret template (D4).
 * The template carries reading preferences only; paths, naming, and language
 * come from here so a customized template cannot break the file contract.
 */
export function buildPaperInterpretPrompt(input: {
  /** Workspace-relative unit dir, e.g. `papers/1706.03762`. */
  unitDir: string
  meta: PaperUnitMeta
  /** Workspace-relative output file, e.g. `papers/1706.03762/1706.03762-解读.md`. */
  outputPath: string
  template?: string
  language?: PaperInterpretLanguage
  /** Model lacks vision: the agent must pick figures by caption only. */
  visionCapable?: boolean
  /** Preprocess ran but figures failed — note the limitation up front. */
  figuresFailed?: boolean
}): string {
  const unitDir = input.unitDir.replace(/\/+$/, '')
  const slug = input.meta.slug || paperUnitSlugFromDir(unitDir)
  const boardSlug = paperBoardSlug(slug)
  const stem = input.outputPath.split('/').at(-1)?.replace(/\.md$/i, '') ?? `${slug}-解读`
  const template = input.template?.trim() || DEFAULT_PAPER_INTERPRET_TEMPLATE
  const notes: string[] = []
  if (input.figuresFailed) {
    notes.push('图表抽取失败，只能引用整页图或不配图。')
  }
  if (input.visionCapable === false) {
    notes.push('无法查看图片，请依据 index.json 的 caption 选图，跳过 confidence=low 的图。')
  }
  const lines = [
    '$paper-reader $excalidraw-diagram',
    `论文目录：${unitDir}`,
    `正文：${unitDir}/paper.md（按页标记）；图表清单：${unitDir}/figures/index.json`,
    `元数据：${unitDir}/paper.json；Cool 笔记（如有，仅供参考）：${unitDir}/NOTES.md`,
    `输出文件（只写这个文件）：${input.outputPath}`,
    `白板命名：title = "${stem}-<图名>"，boardId = "paper-${boardSlug}-<序号>"，`,
    `          导出：design_apply_excalidraw 的 exportPath = "${unitDir}/assets/<title>.png"`,
    `语言：${languageLine(input.language ?? 'zh')}`,
    ...(notes.length > 0 ? [`限制：${notes.join('；')}`] : []),
    '---',
    template
  ]
  return lines.join('\n')
}
