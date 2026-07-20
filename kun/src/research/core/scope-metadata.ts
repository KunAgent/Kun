/**
 * [INPUT]: 依赖 Scope/用户文本中的用途、受众、格式、时间与来源元数据表述
 * [OUTPUT]: 对外提供 isScopeMetadataText，识别交付元数据和“尚未明确”的范围占位语句
 * [POS]: research/core 的领域无关 Scope 文本分类器，防止未确认元数据被映射为必写研究维度
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const DELIVERY_METADATA_LABEL = /^(?:用途|用于|使用场景|受众|读者|面向|谁看|输出|格式|语言|文风|篇幅)/u
const UNRESOLVED_SCOPE_SIGNAL = /(?:未|尚未|没有|并未|还未|待)(?:明确|指定|确认|说明|提供|选择)/u
const SCOPE_METADATA_CONCEPT = /(?:对比维度|研究维度|分析维度|时间范围|时间窗口|数据来源|来源要求|输出用途|输出形式|目标受众|读者受众|篇幅|格式|文风)/u

export function isScopeMetadataText(value: string): boolean {
  const normalized = value.normalize('NFKC').trim()
  const label = normalized.split(/[:：]/u, 1)[0]?.trim() ?? ''
  if (DELIVERY_METADATA_LABEL.test(label)) return true
  return UNRESOLVED_SCOPE_SIGNAL.test(normalized) && SCOPE_METADATA_CONCEPT.test(normalized)
}
