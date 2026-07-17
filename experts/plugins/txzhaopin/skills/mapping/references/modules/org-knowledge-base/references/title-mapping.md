# 职位缩写与标准化映射表

## PE/VC 行业

| 缩写 | 全称 | 中文 | 层级 |
|------|------|------|------|
| AN | Analyst | 分析师 | 1 |
| ASO / Asso | Associate | 投资经理（初级） | 2 |
| SA / Sr. Asso | Senior Associate | 高级投资经理 | 3 |
| VP | Vice President | 副总裁 | 4 |
| SVP | Senior Vice President | 高级副总裁 | 4.5 |
| D / Dir | Director | 总监 | 5 |
| ED | Executive Director | 执行董事 | 5.5 |
| MD | Managing Director | 董事总经理 | 6 |
| P / Partner | Partner | 合伙人 | 7 |
| GP | General Partner | 普通合伙人 | 7 |
| MP | Managing Partner | 管理合伙人 | 8 |
| Founder | Founder | 创始人 | 9 |

## 投资银行

| 缩写 | 全称 | 中文 | 层级 |
|------|------|------|------|
| AN | Analyst | 分析师 | 1 |
| ASO | Associate | 经理 | 2 |
| VP | Vice President | 副总裁 | 3 |
| D / Dir | Director | 总监/董事 | 4 |
| ED | Executive Director | 执行董事 | 5 |
| MD | Managing Director | 董事总经理 | 6 |

## 咨询

| 缩写 | 全称 | 中文 | 层级 |
|------|------|------|------|
| BA / JC | Business Analyst / Junior Consultant | 商业分析师 | 1 |
| C / SC | Consultant / Senior Consultant | 咨询师 | 2 |
| M / EM | Manager / Engagement Manager | 项目经理 | 3 |
| SM / AP | Senior Manager / Associate Partner | 高级经理 | 4 |
| P / Partner | Partner / Principal | 合伙人 | 5 |
| SP / MP | Senior Partner / Managing Partner | 高级合伙人 | 6 |

## 通用科技

| 缩写 | 全称 | 中文 | 层级 |
|------|------|------|------|
| IC | Individual Contributor | 个人贡献者 | 1-4 |
| TL | Tech Lead | 技术负责人 | 3 |
| EM | Engineering Manager | 工程经理 | 4 |
| Sr. M | Senior Manager | 高级经理 | 5 |
| D / Dir | Director | 总监 | 6 |
| VP | Vice President | 副总裁 | 7 |
| SVP | Senior Vice President | 高级副总裁 | 8 |
| CXO | C-Level | 首席XX官 | 9 |

## 职位标准化规则

1. 优先使用**全称**作为 `title`，缩写存入 `title_abbr`
2. 当用户输入模糊描述时（如"负责人"、"老板"），根据上下文推断最可能的职位
3. 中英文混用时，`title` 使用英文全称，`title_abbr` 使用标准缩写
4. 不确定的职位标记 `title_uncertain: true`
