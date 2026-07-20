/**
 * [INPUT]: 依赖 opencc-js 的繁体到简体转换器
 * [OUTPUT]: 对外提供只用于检索与证据匹配的中文书写体系归一函数
 * [POS]: research/core 的领域中立文本匹配基础层，不改写证据原文或用户可见报告
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import OpenCC from 'opencc-js/t2cn'

const traditionalToSimplified = OpenCC.Converter({ from: 't', to: 'cn' })

export function normalizeResearchChineseScript(value: string): string {
  const normalized = value.normalize('NFKC')
  return /\p{Script=Han}/u.test(normalized) ? traditionalToSimplified(normalized) : normalized
}
