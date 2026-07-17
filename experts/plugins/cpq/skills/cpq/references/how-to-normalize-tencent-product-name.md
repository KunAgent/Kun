# 腾讯云产品名规范化（C 段 · Phase 2.5）

> **定位**：本文档是 **C 选品段** 的 **Phase 2.5** 子步骤（编排见 [how-to-select-product.md](./how-to-select-product.md)）。独立可执行：执行完毕后产出 `<CPQ_SESSION_DIR>/phase2_5.md`，主流程凭该文件继续 Phase 2.6 / 3，**无需再回读本文档的细节**。产物的 `phase2_5-done` 标记 + 下游各 Phase 的 done 标记最终汇入 C 的 Phase 4 门控 `check-phase4-confirm.mjs`。

## 双分支结构（site=cn / site=intl 都会产出临时文件）

> **重要**：Phase 2.5 在两种 site 下**都存在、都产出** `<CPQ_SESSION_DIR>/phase2_5.md`，且列结构完全一致。区别只在"主体执行内容"是否调用 `tencent-cloud-product-mapping` 规范化脚本。
>
> **必须先校验 site 上下文**：从 `<CPQ_SESSION_DIR>/phase1.md` 首行 `<!-- site: cn|intl version=2 -->` 读取。
>
> | site                | 是否调用规范化脚本                               | 是否产出临时文件 | 列结构                                                                                                                           |
> | ------------------- | ------------------------------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
> | `cn`                | ✅ 调用 `tencent-cloud-product-mapping` 固定脚本 | ✅ 产出          | `row_id \| status \| 规范化产品名 \| 缩写 \| Phase 3 检索关键词 \| 站点 \| 地域 \| 售卖模式 \| 优惠策略 \| 返佣（%） \| 约束条件 \| 推断标记` |
> | `intl`              | ❌ 跳过脚本调用（走"字段透传分支"）              | ✅ **仍产出**    | **同样的列结构**                                                                                                                 |
> | 首行缺失 / 不可识别 | —                                                | —                | 流程违规，停止并提示主流程补齐启动判断 0                                                                                         |
>
> **Phase 1 重构后的字段透传契约**（v2 起强制）：`row_id` / `status` / `站点` / `地域` / `约束条件` / `推断标记` 都是 Phase 1 落盘的产物，Phase 2.5 必须**原样透传**到 phase2_5.md，作为接力链的锚点（详见 [`how-to-update-phase1-incrementally.md`](./how-to-update-phase1-incrementally.md) §跨 phase 文件的 row_id 一致性）。`站点` 每行必填且与首行 `site` 标记一致，`地域` 上游无值时填 `-`。
>
> **为什么 intl 跳过脚本调用**：`tencent-cloud-product-mapping` 的产品目录数据源（MCP 端点）目前不覆盖国际站商品，强行调用会得到低置信噪声并污染 Phase 3 检索关键词。但 Phase 2.5 的**字段契约**仍然有效，由此让 Phase 3 的输入只看 `<CPQ_SESSION_DIR>/phase2_5.md` 一份产物，不再按 site 分叉。

site=cn 时，所有即将进入 Phase 3 的腾讯云产品条目都必须先执行 Phase 2.5 主体规范化流程：

- Phase 1 临时清单中 `来源判断 = 腾讯云` 的所有条目
- Phase 2 [winback.md](./winback.md) 输出的"我方对标产品"（非 `-` 的条目）

**禁止跳过主体规范化（site=cn）**：不得因为已经执行 Winback、产品名看起来标准、或用户给了英文缩写就跳过 Phase 2.5 的脚本调用。Phase 2.5 只规范化腾讯云产品类型，不改写友商产品本身；Phase 2 中"我方对标产品"为 `-` 的条目仍按"无对标跳过"，不进入 Phase 2.5/Phase 3。

site=intl 时走"字段透传分支"，详见下文 §intl 字段透传分支。

## 输入契约

读取以下两个上游临时文件中的腾讯云条目（任一存在即可）：

- `<CPQ_SESSION_DIR>/phase1.md`（Phase 1 产物，取 `来源判断=腾讯云` 的行）
- `<CPQ_SESSION_DIR>/phase2.md`（Phase 2 Winback 产物，取"我方对标产品" ≠ `-` 的行，把"我方对标产品"作为产品名、保留原始规格）

需要从输入中拿到每条的"产品原文 + 子项"拼成的"原始关键词"，并原样读取、透传上游 `售卖模式` 列。

## 输出契约（临时文件 · 必须落盘，两种 site 都必须产出）

- **路径**：`<CPQ_SESSION_DIR>/phase2_5.md`（`<CPQ_SESSION_DIR>` 解析与跨平台兼容性见[cpq-session-dir.md](./cpq-session-dir.md)）
- **首行（必填，门控）**：`<!-- site: cn -->` 或 `<!-- site: intl -->`，必须与 Phase 1 首行一致
- **内容**：一张 Markdown 表格，列固定为：

| row_id | status | 规范化产品名 | 缩写 | Phase 3 检索关键词 | 站点 | 地域 | 售卖模式 | 优惠策略 | 返佣（%） | 约束条件 | 推断标记 |
| ------ | ------ | ------------ | ---- | ------------------ | ---- | ---- | -------- | -------- | --------- | -------- | -------- |

- `row_id` / `status` / `站点` / `地域` / `售卖模式` / `优惠策略` / `返佣（%）` / `约束条件` / `推断标记` **原样透传自 Phase 1/Phase 2**，上游为 `-` 时继续填 `-`（`站点` 必填、永不为 `-`），禁止在本阶段新增、改写或默认补齐
- `row_id` / `status` 是接力链锚点（详见 [`how-to-update-phase1-incrementally.md`](./how-to-update-phase1-incrementally.md)），下游 Phase 2.6 / 3 / 4 / 5 必须保留
- 文件末尾追加一行：`<!-- phase2_5-done: total=<N> normalized=<H> fallback=<L> -->`
  - `H` = 高置信命中数（脚本 `found=true`）。**site=intl 时固定为 `0`**（未调用脚本）
  - `L` = 未高置信命中、回落到原始关键词的条数。**site=intl 时等于 `<N>`**（所有条目都按 fallback 处理）

主流程读到该文件即进入 **Phase 2.6 选品意图识别**（详见 [how-to-identify-selection-intent.md](./how-to-identify-selection-intent.md)）；Phase 2.6 完成后再进入 Phase 3 `product batch-search` 批量搜索。可丢弃 Phase 2.5 详细规则上下文。

---

## 目标

使用 `tencent-cloud-product-mapping` Skill 将用户输入的产品描述、关键词、别名或缩写规范化为最匹配的腾讯云产品名或产品缩写，再与原始规格/子类型组合成 Phase 3 的 `product batch-search` 检索关键词。

该阶段**只定位"产品"这个类型**，不输出文档、介绍或推荐理由。

## 主体执行：site=cn 调用规范化脚本，site=intl 直接走字段透传

下文 §调用方式 / §结果处理规则 **仅适用 site=cn**。site=intl 时请直接跳到本文档末尾的 §intl 字段透传分支。

## 调用方式（固定脚本能力，不生成临时脚本 · 仅 site=cn）

```bash
printf '%s\n' \
  "云服务器 CVM 标准型 S5" \
  "数据安全审计 DBAudit 标准版" \
  "对象存储 COS 标准存储" \
  | python3 {pluginRoot}/skills/tencent-cloud-product-mapping/scripts/tencent_cloud_product_map.py --jsonl --field json
```

- 必须直接调用 `tencent-cloud-product-mapping/scripts/tencent_cloud_product_map.py`，**禁止**运行时临时生成 Python / Shell 包装脚本来替代该固定脚本能力。
- 批量时优先通过 stdin 一次性传入多行，脚本会复用同一次 MCP 初始化和产品目录加载；不要每条产品单独启动一次脚本。
- 默认使用脚本内置阈值。判定没有找到或置信度低于阈值时，一律视为"没有找到"；脚本会把原始输入内容原样返回，作为 Phase 3 的兜底检索关键词。
- 不要先向用户确认，也不要让产品映射阶段反问用户；不确定项先原样保留到 Phase 3/Phase 4 再处理。

## 结果处理规则（仅 site=cn）

1. **`found=true`**：使用返回的 `name` 作为规范化产品名；如用户或后续流程需要缩写，可使用 `slug`。Phase 3 检索关键词 = `规范化产品名 + " " + 原始规格/子类型`。`售卖模式`、`优惠策略` 和 `返佣（%）` 原样透传。
2. **`found=false`** 或命令行默认输出等于原始输入：视为未找到高置信产品。
   - 规范化产品名列：保留**原始关键词**（即原始的"产品原文 + 子项"）
   - 缩写列：填 `-`
   - Phase 3 检索关键词列：保留**原始关键词**
   - 在 Phase 4 备注"产品名规范化未高置信命中，使用原始关键词检索"
3. 对有规格/子类型的条目，Phase 3 检索关键词应优先使用"规范化产品名 + 原始规格/子类型"；如果未找到高置信产品，则使用原始搜索关键词。
4. **禁止**凭常识自行补齐脚本未返回的官方产品名、规格或关键词；**禁止**把文档标题、API 字段、说明文字当作产品名。
5. 同一规范化产品名 + 规格组合去重后写入产物；同一产品多个规格仍必须逐条保留。

---

## intl 字段透传分支（仅 site=intl）

site=intl 时，**不调用** `tencent-cloud-product-mapping` 脚本，但 Phase 2.5 临时文件仍按相同列结构产出，所有字段从上游临时文件直接透传。

### 输入

- `<CPQ_SESSION_DIR>/phase1.md` 中 `来源判断 = 腾讯云` 的所有条目
- `<CPQ_SESSION_DIR>/phase2.md`（若存在）中"我方对标产品" ≠ `-` 的所有条目

### 各列填法

| 列                   | site=intl 填法                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `row_id`             | 原样透传 Phase 1 的 `row_id`（如 `r001`）                                                                                 |
| `status`             | 原样透传 Phase 1 的 `status`（`stable` / `dirty` / `removed`）                                                            |
| `规范化产品名`       | Phase 1 腾讯云行：取 Phase 1 的"产品名"列原值<br>Phase 2 我方对标行：取 Phase 2 的"我方对标产品"列原值                    |
| `缩写`               | **统一留空 / 填 `-`**（intl 无规范化脚本输出，无 slug 信息）                                                              |
| `Phase 3 检索关键词` | Phase 1 腾讯云行：**字符级原样透传** Phase 1 的"搜索关键词"列<br>Phase 2 我方对标行：拼接为"我方对标产品 + 原始规格/子项" |
| `站点`               | 原样透传 Phase 1 的 `站点`（此分支恒为 `intl`）；每行必填，与首行 `site` 标记一致，永不为 `-`                             |
| `地域`               | 原样透传 Phase 1 的 `地域`；上游为 `-` 时继续填 `-`                                                                       |
| `售卖模式`           | 原样透传上游 `售卖模式` 列；上游为 `-` 时继续填 `-`                                                                       |
| `优惠策略`           | 原样透传上游 `优惠策略` 列；上游为 `-` 时继续填 `-`                                                                       |
| `返佣（%）`          | 原样透传上游 `返佣（%）` 列；上游为 `-` 时继续填 `-`                                                                      |
| `约束条件`           | **原样透传** Phase 1 的 `约束条件` 列；上游为 `-` 时继续填 `-`                                                            |
| `推断标记`           | **原样透传** Phase 1 的 `推断标记` 列；上游为 `-` 时继续填 `-`                                                            |

### 硬约束

- ❌ **禁止**调用 `tencent-cloud-product-mapping/scripts/tencent_cloud_product_map.py`（数据源不覆盖国际站）
- ❌ **禁止**凭常识或自身知识"规范化"产品名（如把 `TencentDB for MySQL` 改写成中文）——所有内容必须能追溯到 Phase 1 / Phase 2 临时文件
- ❌ **禁止**在 `Phase 3 检索关键词` 列做任何简化、截断或改写（**字符级一致性**：phase2_5.md 的 `Phase 3 检索关键词` 必须与 phase1.md 同 row_id 的 `搜索关键词` 字符级完全一致）
- ❌ **禁止**丢失 `站点` / `地域` / `约束条件` / `推断标记` 列（Phase 1 v2 起这些列都是接力链一部分，下游 Phase 4 映射表展示用户需要看到站点 / 地域 / 约束）
- ✅ 末行 done 标记中 `normalized` 必须为 `0`，`fallback` 必须等于 `total`

### Phase 2.5 产物示例（site=intl）

```
<!-- site: intl -->
| row_id | status | 规范化产品名 | 缩写 | Phase 3 检索关键词         | 站点 | 地域      | 售卖模式        | 优惠策略 | 返佣（%） | 约束条件  | 推断标记              |
| ------ | ------ | ------------ | ---- | -------------------------- | ---- | --------- | --------------- | -------- | --------- | --------- | --------------------- |
| r001   | stable | 云服务器 CVM | -    | 云服务器 CVM 标准型 2核16G | intl | Singapore | 预留实例 RI 3年 | -        | -         | IOPS≥1800 | Ice_Lake→S6（已拒绝） |
| r002   | stable | 云硬盘 CBS   | -    | 云硬盘 CBS SSD 40GB        | intl | Singapore | 预留实例 RI 3年 | -        | -         | IOPS≥1800 | -                     |

<!-- phase2_5-done: total=2 normalized=0 fallback=2 -->
```

---

## 出口（交还主流程）

写完临时文件后，在对话里告诉主流程：

- 临时文件路径
- `total / normalized / fallback` 三个计数

主流程拿到 Phase 2.5 产物即进入 **Phase 2.6 选品意图识别**（见 [how-to-identify-selection-intent.md](./how-to-identify-selection-intent.md)），Phase 2.6 完成后再调用 `cpq product batch-search` 批量搜索所有 `Phase 3 检索关键词`。

子文档使命到此结束，主流程后续不需要再读本文。

## Phase 2.5 产物示例（site=cn）

```
<!-- site: cn -->
| row_id | status | 规范化产品名        | 缩写 | Phase 3 检索关键词  | 站点 | 地域   | 售卖模式 | 优惠策略     | 返佣（%） | 约束条件 | 推断标记 |
| ------ | ------ | ------------------- | ---- | ------------------- | ---- | ------ | -------- | ------------ | --------- | -------- | -------- |
| r001   | stable | 云服务器            | cvm  | 云服务器 标准型 S5  | cn   | 广州   | 包年包月 | 0.42         | 0         | -        | -        |
| r002   | stable | 云服务器            | cvm  | 云服务器 标准型 S8  | cn   | 广州   | -        | 0.42         | 0         | -        | -        |
| r003   | stable | 云服务器            | cvm  | 云服务器 内存型 M5  | cn   | 上海   | -        | -            | -         | -        | -        |
| r004   | stable | 对象存储            | cos  | 对象存储 标准存储   | cn   | 广州   | 按量计费 | 2.5 元/次/月 | 5         | -        | -        |
| r005   | stable | 对象存储            | cos  | 对象存储 低频存储   | cn   | 广州   | 按量计费 | 0.45         | -         | -        | -        |
| r006   | stable | 数据安全审计        | CDS  | 数据安全审计 标准版 | cn   | -      | -        | -            | -         | -        | -        |
| r007   | stable | 服务网格 TCM 标准版 | -    | 服务网格 TCM 标准版 | cn   | -      | -        | -            | -         | -        | -        |

<!-- phase2_5-done: total=7 normalized=6 fallback=1 -->
```
