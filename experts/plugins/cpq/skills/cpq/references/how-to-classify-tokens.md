# Token 级语义分类（Phase 1 阶段 A.2 子规则）

> **定位**：[how-to-parse-product-list.md](./how-to-parse-product-list.md) 阶段 A.2 的执行细则。仅在 SPEC 列 / CONSTRAINT 列触发；其余列已在 A.1 列级语义分类阶段处理完毕。
>
> **执行依据**：本文档 + [`data/phase1-token-dict/`](./data/phase1-token-dict/README.md) 9 个词典文件。AI 不允许凭知识自由联想 token 类型，只能查词典。
>
> **范围声明**：本文档处理的是 **SPEC / CONSTRAINT 列内的 token**（A.2 触发条件）。BILLING 列已在 A.1 列级语义分类阶段被独立隔离到 `售卖模式` 列，BILLING 别名归一（如 `按需` → `按量计费`、`Spot` → `竞价`）走单独的 [`data/phase1-token-dict/billing-alias.md`](./data/phase1-token-dict/billing-alias.md) 词典，由 [`how-to-parse-product-list.md`](./how-to-parse-product-list.md) §售卖模式识别规则 §3 在 C.1 字段填充阶段调用。本文档**不**处理 BILLING token。

---

## 7 种 token 类型

| token 类型 | 判据 | 进搜索词？ | 进哪列 |
|-----------|------|-----------|-------|
| **EXPLICIT_SPEC** | 命中 `explicit-spec.{site}.md` | ✅ 直接进 | 规格/子类型 + 搜索关键词 |
| **IMPLICIT_SPEC** | 命中 `implicit-spec-cpu.md` / `implicit-spec-disk.md` | ⚠️ 需用户确认（决策 1.2 中档） | 推断标记列；用户确认后进搜索关键词 |
| **PERFORMANCE_FILTER** | MODIFIER + 性能指标组合（参见 `modifier.md` §性能指标识别） | ❌ | 约束条件 |
| **DEFAULT_ATTR** | 命中 `default-attr.md` | ❌ | 约束条件 |
| **COMPLIANCE** | 命中 `compliance.md` | ❌ | 约束条件 + **强制触发追问** |
| **MODIFIER** | 命中 `modifier.md` 单独出现（无性能指标） | ❌ | 丢弃 |
| **UNCLASSIFIED** | 都不命中 | ❌ | 约束条件 + 标记 `?` 触发追问 |

---

## 执行步骤

### Step 1 · 词典加载（按 site 隔离）

```
site=cn:
  load explicit-spec.cn.md
  load implicit-spec-cpu.md (filter 适用 site contains 'cn')
  load implicit-spec-disk.md (filter 适用 site contains 'cn')
  load default-attr.md (filter 适用 site contains 'cn')
  load compliance.md (filter 适用 site = 'cn')
  load modifier.md
  load companion-trigger.md (filter 适用 site contains 'cn')

site=intl:
  load explicit-spec.intl.md
  ... (其他词典 filter 适用 site contains 'intl')
```

❌ **禁止跨站点加载**。

### Step 2 · cell 级 token 切分

对每个 SPEC 列 / CONSTRAINT 列的 cell，按以下分隔符切分 token：

- 空格
- 中文逗号 `，` / 英文逗号 `,`
- 中文顿号 `、`
- 分号 `;` / `；`
- 换行符
- 斜杠 `/`（仅当两侧都是并列子项时）

**注意**：不要切碎到字符级。如 `2核16G` 应作为整体 token 查词典（命中 `2核` + `16G` 两条）；`Ice Lake` 应保留空格匹配 `Ice Lake` 词条（不要切成 `Ice` 和 `Lake`）。

### Step 3 · 词典查找（按优先级匹配）

对每个 token 按以下优先级查词典，**首次命中即停止**：

```
1. EXPLICIT_SPEC（精确匹配 explicit-spec.{site}.md 的 token 列）
2. IMPLICIT_SPEC（精确匹配 implicit-spec-cpu.md / implicit-spec-disk.md）
3. COMPLIANCE（精确匹配 compliance.md）
4. DEFAULT_ATTR（精确匹配 default-attr.md）
5. MODIFIER（精确匹配 modifier.md，且需检查后续是否跟性能指标 → 升格 PERFORMANCE_FILTER）
6. 否则 → UNCLASSIFIED
```

**适用产品类目过滤**：词典条目有 `适用产品类目` 字段（`*` 或具体产品名）。当 cell 所属行的 `产品名` 不在该字段范围内时，跳过此条目。

### Step 4 · MODIFIER + 性能指标 → PERFORMANCE_FILTER 升格

当一个 cell 同时包含 MODIFIER token 和性能指标（IOPS / QPS / TPS / 吞吐 / 延迟 / 主频 / 带宽 / 连接数 / 节点数等，见 `modifier.md` §性能指标识别）时，**整体识别为 PERFORMANCE_FILTER**：

```
"不低于 1800 IOPS" → 整体 PERFORMANCE_FILTER（不要拆成 MODIFIER + UNCLASSIFIED）
"基频 2.5GHz 及以上" → 整体 PERFORMANCE_FILTER
"≥ 5000 QPS" → 整体 PERFORMANCE_FILTER
```

升格规则：

- MODIFIER 词在前 + 数值 + 性能指标单位 → 整段是 PERFORMANCE_FILTER
- 数值 + 性能指标单位 + `及以上` / `及以下` → 整段是 PERFORMANCE_FILTER

### Step 5 · 字段填充

按 token 分类结果，填充 phase1.md 的对应列：

| 列 | 取值规则 |
|---|---------|
| `规格/子类型` | EXPLICIT_SPEC + 已确认 IMPLICIT_SPEC token，按原始顺序拼接 |
| `搜索关键词` | `产品名` + " " + `规格/子类型`（决策 2 白名单：仅 IDENTIFIER + EXPLICIT_SPEC + 已确认 IMPLICIT_SPEC） |
| `约束条件` | PERFORMANCE_FILTER + COMPLIANCE + DEFAULT_ATTR + UNCLASSIFIED token，用 ` / ` 分隔 |
| `推断标记` | IMPLICIT_SPEC token 列出 `<原token>→<推断目标>` + 确认状态（`✓` / `（未确认）` / `（已拒绝）`） |

### Step 6 · 反向印证记录（决策 9）

执行完毕后填入 `phase1-done` 标记：

```
step_token_classified=yes
inferred_count=<行数：推断标记列非空且非"-"的行数>
search_keyword_lint=<pass|fail>  // 自检步骤后填
```

---

## 自检（落盘前必须做）

| 自检项 | 通过标准 | 不通过的处置 |
|-------|---------|-------------|
| 每行 `搜索关键词` 包含 `产品名` 中文全名 | 字符级子串匹配 | 重做 Step 5 |
| 每行 `搜索关键词` 不含 LOCATION token（地域名） | 黑名单正则不命中 | 移除地域 token |
| 每行 `搜索关键词` 不含 QUANTITY 模式（`\d+\s*[台节点实例]`） | 黑名单正则不命中 | 移除数量 token |
| 每行 `搜索关键词` 不含 BILLING token（包年包月 / 按量等） | 黑名单正则不命中 | 移除售卖模式 token，确保 `售卖模式` 列填了 |
| 每行 `搜索关键词` 不含 PERFORMANCE_FILTER 模式 | 黑名单正则不命中 | 移除范围词 + 数值，确保 `约束条件` 列填了 |
| 每行 `推断标记` 列：未确认 IMPLICIT 不进搜索词 | 比对推断标记中"（未确认）"的 token 是否泄漏到搜索词 | 重做 Step 5 |

自检通过 → `search_keyword_lint=pass`；否则 `search_keyword_lint=fail` 并修复。

---

## 与子文档的边界

- 词典数据：[`data/phase1-token-dict/`](./data/phase1-token-dict/README.md)
- 歧义清单（IMPLICIT_SPEC 待确认 / COMPLIANCE 触发的追问）：[`how-to-resolve-phase1-ambiguity.md`](./how-to-resolve-phase1-ambiguity.md)
- 字段填充示例：[`how-to-parse-product-list.md`](./how-to-parse-product-list.md) §阶段 C
- 伴生触发词：本文档不涉及（伴生由 [`how-to-identify-companion-products.md`](./how-to-identify-companion-products.md) 在 B.2 处理）

---

## 反模式

- ❌ 凭 LLM 知识自由联想 token 归类（如把"高性能"当 EXPLICIT_SPEC）→ 必须查词典
- ❌ 把"新加坡"当 EXPLICIT_SPEC 进搜索词（地域已在 A.1 列级分类阶段独立到 LOCATION 列）
- ❌ 把"包年包月"当 EXPLICIT_SPEC 进搜索词（已在 A.1 阶段独立到 BILLING 列）
- ❌ 跳过 IMPLICIT_SPEC 用户确认直接套用推断目标
- ❌ 把单独出现的 MODIFIER（如 "不低于"）保留进搜索词
- ❌ 把跨站点词典加载混用（cn 上下文读 intl 词典，反之亦然）
