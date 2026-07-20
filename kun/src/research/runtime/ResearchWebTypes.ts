/**
 * [INPUT]: 依赖网页搜索和抓取阶段产生的候选来源字段
 * [OUTPUT]: 对外提供 SeedSource 通用候选来源契约
 * [POS]: research/runtime 的网页候选类型边界，避免搜索策略依赖具体题材的静态来源目录
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export type SeedSource = {
  url: string
  title: string
  publisher: string
  reliabilityReason: string
  tags: string[]
  searchContent?: string
}
