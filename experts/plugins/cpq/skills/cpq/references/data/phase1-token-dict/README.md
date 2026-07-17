# Phase 1 Token 词表（站点隔离）

> **定位**：Phase 1 阶段 A.2 token 级语义分类的**唯一权威数据源**。AI 不允许凭知识自由联想 token 类型，只能查本词表。
>
> **完整 schema 与治理规则**：[`docs/cpq/phase1-refactor/token-dict-schema.md`](../../../../../../../docs/cpq/phase1-refactor/token-dict-schema.md)

---

## 文件清单

| 文件                    | 用途                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `explicit-spec.cn.md`   | 显式规格词典（国内站）                                                                                                                           |
| `explicit-spec.intl.md` | 显式规格词典（国际站）                                                                                                                           |
| `implicit-spec-cpu.md`  | 隐式 CPU 规格词典（推断映射 · 必须用户确认）                                                                                                     |
| `implicit-spec-disk.md` | 隐式磁盘规格词典（推断映射 · 必须用户确认）                                                                                                      |
| `default-attr.md`       | 默认属性词典（产品默认值，不进搜索词）                                                                                                           |
| `compliance.md`         | 合规要求词典（COMPLIANCE 类，必须追问）                                                                                                          |
| `modifier.md`           | 逻辑修饰词词典（MODIFIER 类，单独出现时丢弃）                                                                                                    |
| `companion-trigger.md`  | 伴生产品触发词（被 [`how-to-identify-companion-products.md`](../../how-to-identify-companion-products.md) §B.2 引用）                            |
| `billing-alias.md`      | 售卖模式别名归一词典（友商措辞 → 腾讯云术语；被 [`how-to-parse-product-list.md`](../../how-to-parse-product-list.md) §售卖模式识别规则 §3 引用） |

---

## 站点隔离原则

| site   | 加载文件                                                          |
| ------ | ----------------------------------------------------------------- |
| `cn`   | `explicit-spec.cn.md` + 其他 `适用 site contains 'cn'` 的词条     |
| `intl` | `explicit-spec.intl.md` + 其他 `适用 site contains 'intl'` 的词条 |

❌ **禁止跨站点加载**：cn 上下文不读 `*.intl.md`，反之亦然。与 cloud-mapping 字典的站点隔离原则一致。

---

## 通用条目 Schema

每个词典是 Markdown 表格，固定列：

| token | 归类 | 推断目标 | 适用 site | 适用产品类目 | 来源 | 启用 |

字段语义见 [`token-dict-schema.md`](../../../../../../../docs/cpq/phase1-refactor/token-dict-schema.md) §二。

---

## 维护规则

- ✅ Append-only：新增条目，不改老条目（避免破坏历史 phase1.md 的可重现性）
- ✅ 停用词条：把 `启用` 字段切到 `no`，保留历史
- ✅ 维护权限：CPQ skill owner；SA / PM 通过 issue 提议
- ❌ 禁止 AI 自行新增词条
- ❌ 禁止直接修改老条目的 `归类` / `推断目标`（影响历史可重现性）

完整治理流程见 [`token-dict-schema.md`](../../../../../../../docs/cpq/phase1-refactor/token-dict-schema.md) §四。
