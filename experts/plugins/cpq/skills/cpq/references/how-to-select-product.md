# 选品决策：将产品添加到报价单

将用户提供的产品清单解析并批量添加到 CPQ 报价单。支持腾讯云产品直接导入，也支持友商产品先经 Winback 转换再导入。具体每行的选品策略（精确查找 / 推荐常用 / 框架选品）由 Phase 2.6 在行级做意图识别（见 [how-to-identify-selection-intent.md](./how-to-identify-selection-intent.md)）。

> **段定位**：本文是 **C 选品段**的编排说明，覆盖运行时 Phase 2.5 → 2.6 → 3 → 4 → 5 → 6。其中 Phase 1（解析清单，见 [how-to-parse-product-list.md](./how-to-parse-product-list.md)）属 **A 上下文准备段**、Phase 2（Winback，见 [winback.md](./winback.md)）属 **B 友商对标段**，二者是上游，本文只在 I/O 衔接处引用其产物。
>
> **C / D 解耦**：询价是独立的 **D 段**（见 [how-to-query-pricing.md](./how-to-query-pricing.md)），不在本文流程内。C（选品落库）与 D（询价）互不依赖，可由用户决定先后或只跑其一。

---

## 核心原则

- **站点上下文（site）必须在 Phase 1 之前确定并贯穿全流程**：取值 `cn`（国内站，默认）/ `intl`（国际站）。`site` 必须写入 Phase 1 / 2 / 2.5 / 2.6 四个临时文件首行 `<!-- site: cn|intl -->`，下游 Phase 读到首行标记缺失或与上游不一致，必须停止流程。`site=intl` 强制委托 `cloud-mapping-intl`；Phase 2.5 在 intl 下**仍然产出临时文件并遵守同样的列结构**，仅跳过主体规范化脚本调用，走"字段透传分支"（原因见主 [SKILL.md](../SKILL.md) §段编排总则）。
- **友商产品必须先 Winback**：非腾讯云产品不能直接添加到 CPQ，必须先通过 [Winback 对标](winback.md) 得到我方对标产品再导入；委托对象按 site 分叉（cn → `cloud-mapping`，intl → `cloud-mapping-intl`）。
- **前置准备阶段（Phase 1 / 2 / 2.5 / 2.6）只通过临时文件衔接**：这四个 Phase 必须把产物落到 `<CPQ_SESSION_DIR>/phase<N>.md`（`<CPQ_SESSION_DIR>` 解析与跨平台兼容性见[cpq-session-dir.md](./cpq-session-dir.md)），下一个 Phase 只读上游临时文件即可执行，**执行完即可丢弃前一阶段的详细规则上下文**。Phase 3 同样落 `phase3.md`（见下方契约表）；Phase 4 落 `phase4.md` + `phase4_confirm.json`，由 `check-phase4-confirm.mjs` 机器门控；Phase 5（落库 row add / save）、Phase 6（结果报告）不落临时文件。**Phase 2.5 临时文件在 cn 和 intl 下都必须产出**，区别仅在主体执行内容（cn 调用脚本规范化，intl 字段透传）。**Phase 2.6 在两种 site 下都必须执行，不可跳过**。
- **售卖模式全链路透传**：Phase 1 必须从输入描述/行描述中识别 `售卖模式`（如预付费、按量计费、后付费、包年包月、竞价、包销、预留等），Phase 2 / 2.5 / 2.6 只能原样透传，Phase 3 使用该列过滤匹配结果的 `payMode`。
- **站点 / 地域全链路透传**：Phase 1 必须为每行落 `站点`（`cn` / `intl`，必选，来自启动判断 0）和 `地域`（具体地域名，可选，来自用户意图识别；无则 `-`；多地域按笛卡尔积拆行）。`站点` / `地域` 与 `售卖模式` 一样是 Phase 1 → Phase 2 / 2.5 / 2.6 → Phase 3 的固定透传列，下游只能原样透传，不得删除、改写或凭常识替换。Excel 输入存在纵向合并单元格时，Phase 1 必须在**读取阶段**基于 openpyxl 合并元数据展平（详见 [how-to-parse-product-list.md](./how-to-parse-product-list.md) §合并单元格展平规则）。
- **选品意图必须在 Phase 3 之前确定**：Phase 2.6 必须为每行落一个 `a`（推荐常用）/ `b`（框架选品）/ `c`（精确查找）的选品意图标记。Phase 3 从 Phase 2.6 产物读取检索关键词和选品意图，Phase 4 映射表必须展示选品意图列。
- **row_id / 约束条件 / 推断标记 全链路透传**（Phase 1 v2 新增）：Phase 1 重构后引入 `row_id` / `status` / `约束条件` / `推断标记` 四列，作为接力链锚点。Phase 2 / 2.5 / 2.6 / 3 / 4 必须**原样透传**（不得删除、改写、凭常识替换）。Phase 4 映射表必须展示 `row_id` / `约束条件` / `推断标记` 三列让用户决策时参考。
- **Phase 1 单次执行原则**（Phase 1 v2 新增）：phase1.md 落盘 + check-phase1.mjs gate 通过 ⇒ Phase 1 进入完成态，下游不重新执行 Phase 1，只读 phase1.md 文件。详见 [how-to-parse-product-list.md](./how-to-parse-product-list.md) §Phase 1 单次执行原则 + [how-to-update-phase1-incrementally.md](./how-to-update-phase1-incrementally.md)。

---

## 阶段间临时文件流转契约（Phase 1 / 2 / 2.5 / 2.6 / 3）

> **设计目标**：让前置准备阶段自包含 · 上下文可遗忘。AI 完成某阶段后，只需保留临时文件路径即可继续下一阶段，不需要回读任何上游 Phase 的细节规则。
>
> **范围说明**：临时文件契约适用于 Phase 1 / 2 / 2.5 / 2.6 / 3 / 4（Phase 4 产物为 `phase4.md` + `phase4_confirm.json`，由 `check-phase4-confirm.mjs` 机器门控）。Phase 5（落库）、Phase 6（结果报告）不落临时文件。

| Phase                  | 子文档                                                                                 | 产物临时文件                    | 下游读取者                                | 触发条件                                                 |
| ---------------------- | -------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------- | -------------------------------------------------------- |
| Phase 1 解析清单       | [how-to-parse-product-list.md](./how-to-parse-product-list.md)                         | `<CPQ_SESSION_DIR>/phase1.md`   | Phase 2 / Phase 2.5 / Phase 2.6 / Phase 3 | 任何选品请求                                             |
| Phase 2 Winback        | [winback.md](./winback.md)                                                             | `<CPQ_SESSION_DIR>/phase2.md`   | Phase 2.5 / Phase 2.6 / Phase 3           | Phase 1 含友商行                                         |
| Phase 2.5 产品名规范化 | [how-to-normalize-tencent-product-name.md](./how-to-normalize-tencent-product-name.md) | `<CPQ_SESSION_DIR>/phase2_5.md` | Phase 2.6                                 | **两种 site 都触发**（cn 调用脚本规范化；intl 字段透传） |
| Phase 2.6 选品意图识别 | [how-to-identify-selection-intent.md](./how-to-identify-selection-intent.md)           | `<CPQ_SESSION_DIR>/phase2_6.md` | Phase 3                                   | **强制 · 两种 site 都触发 · 不可跳过**                   |
| Phase 3 匹配产品       | [how-to-search-product.md](./how-to-search-product.md)                                 | `<CPQ_SESSION_DIR>/phase3.md`   | Phase 4                                   | Phase 2.6 产物就绪                                       |

**通用规则**（约束上述五个 Phase）：

- `<ts>` 用 `date +%Y%m%d-%H%M%S` 生成，**同一次会话中 Phase 1 / 2 / 2.5 / 2.6 共用同一个 `<ts>`**，方便串联追溯
- **每个临时文件首行必须是 `<!-- site: cn -->` 或 `<!-- site: intl -->`**，与上游 Phase 1 一致；缺失或不一致即为流程违规，下游 Phase 必须停止
- 每个临时文件末尾必须追加 HTML 注释行 `<!-- phase<N>-done: ... -->` 作为门控标记，下游 Phase 读到该行才视为上游完成
- 临时文件用 Markdown 表格存储，列结构由各 Phase 子文档/段落明确规定，禁止自由发挥
- **格式硬约束（防过度交付）**：`<CPQ_SESSION_DIR>/phase<N>.md` 是 AI 自身消费的中间产物，必须用 `write_to_file` 直接写**纯 Markdown**，**禁止**：
  - ❌ 生成 Excel / PDF / DOCX / 带样式 HTML 等任何非 MD 格式
  - ❌ 写 Python 脚本（openpyxl / pandas / docx 等）来生成中间产物 —— 直接 `write_to_file` 写 MD 即可
  - ❌ 增量修改时重跑全脚本生成 v1/v2/v3 版本 —— 用 `replace_in_file` 改对应行
  - ❌ 给中间产物加图例、配色、合并单元格、统计面板等"美化"元素（这些只属于 Phase 4 面客交付物）
  - ✅ 仅 Phase 4 面客最终交付物（最终选品清单 / 报价单导出）允许使用 openpyxl / docx-manipulation 等富格式工具。**生成面客 Excel 前必须读取 [how-to-export-excel.md](./how-to-export-excel.md) 并应用其格式规范**
- `站点`、`地域`、`售卖模式`、`优惠策略` 和 `返佣（%）` 是 Phase 1 → Phase 2/2.5/2.6 → Phase 3 的固定透传列：上游为 `-` 时下游继续填 `-`（`站点` 必选，永不为 `-`）；上游有值时下游不得删除、改写或凭常识替换
- `选品意图` 是 Phase 2.6 新增、Phase 3/4 必须透传的列：写法为 `中文名（字母码）`，取值固定为 `精确查找（c）` / `框架选品（b）` / `推荐常用（a）` 之一，禁止为空或其它值；括号内字母码 `a`/`b`/`c` 是下游分流/校验的机器锚点，必须保留
- 若某 Phase 输入文件缺失或缺少 `phase<N>-done` 标记，**必须停止**并提示主流程补齐，禁止跳过前置阶段
- **site=intl 时 Phase 2.5 仍产出临时文件、仍遵守同样的列结构**，只是不调用 `tencent-cloud-product-mapping` 规范化脚本，所有字段从 Phase 1 / Phase 2 直接透传；Phase 3 的输入契约因此统一为"读 `<CPQ_SESSION_DIR>/phase2_6.md`"，不再按 site 分叉

---

## 执行流程

> 以下每个 Phase 段**只声明 I/O 契约与触发条件**，详细规则一律在各自子文档；主流程读完本段即可派发，无需在本文中展开任何 Phase 的内部规则。

### Phase 1: 解析清单 & 识别产品来源

> 详见 [how-to-parse-product-list.md](./how-to-parse-product-list.md)

- **输入**：用户原始清单（Markdown / 表格 / JSON / 自由文本 / Office 或 PDF 附件）
- **附件类型识别**：若输入为 `.xlsx/.docx/.pptx/.pdf` 附件，优先按主 [SKILL.md](../SKILL.md) §附件处理能力 加载对应 skill 解析（不可用时退化）
- **执行**：按子文档完成 Excel 合并单元格展平（读取阶段）、清单解析、规格展开、地域笛卡尔积展开、产品来源判断，并识别每行的 `站点` / `地域` / `售卖模式` / `优惠策略`
- **产物临时文件**：`<CPQ_SESSION_DIR>/phase1.md`
  - 列固定为（v2，与算法文档一致）：`# | row_id | status | 产品名 | 规格/子类型 | 搜索关键词 | 站点 | 地域 | 来源判断 | 售卖模式 | 优惠策略 | 约束条件 | 推断标记`
  - `row_id` / `status` / `约束条件` / `推断标记` 是 v2 接力链锚点，必须落盘并向下游 Phase 2.5 / 2.6 / 3 / 4 原样透传
  - `站点` 填 `cn` / `intl`，必选，每行必填且与首行标记一致；`地域` 填具体地域名，可选，无则 `-`，多地域笛卡尔积拆行
  - `售卖模式` 填用户原文中的收费模式描述；未识别到填 `-`
  - 完整列语义与 `<!-- phase1-done: ... -->` 门控标记的全部字段以 [how-to-parse-product-list.md](./how-to-parse-product-list.md) §输出契约为准（本文不重复，避免漂移）
- **派发规则**（主流程读 `phase1-done` 计数后决定）：
  - `competitor > 0` → 友商行送入 Phase 2 Winback；Winback 输出的"我方对标产品"再进入 Phase 2.5
  - `tencent > 0` → 腾讯云行直接进入 Phase 2.5
  - 两路最终在 Phase 2.5 产物中合流，统一进入 Phase 3

### Phase 2: Winback 转换（仅友商产品触发）

> **触发条件**：仅当 `<CPQ_SESSION_DIR>/phase1.md` 末行 `phase1-done` 标记中 `competitor > 0` 时执行。腾讯云条目不进入本阶段。

按 [Winback 对标](winback.md) 完整执行，得到一张 Winback 对标配置清单。

- **输入**：从 Phase 1 临时文件中筛出 `来源判断 = 友商` 的所有行
- **委托对象按 site 分叉**（详见 [winback.md](winback.md) 步骤二）：
  - `site=cn` → 委托 `cloud-mapping` skill（含字典查询 + migraq 兜底）
  - `site=intl` → 委托 `cloud-mapping-intl` skill（仅字典查询；字典未命中直接 `unresolved`，**禁止 migraq 兜底**，原因见 `cloud-mapping-intl/SKILL.md` 红线 #2）
- **产物临时文件**：`<CPQ_SESSION_DIR>/phase2.md`
  - 首行：`<!-- site: cn -->` 或 `<!-- site: intl -->`，与 Phase 1 一致
  - 内容为 Winback 对标配置清单，至少包含：友商原始产品名、售卖模式、我方对标产品（可能为 `-`）、对标说明
  - `售卖模式` 必须原样透传 Phase 1 友商行的值；Winback 不重新推断、不默认补齐
  - `site=intl` 时备注列禁止出现 `migraq(session:*)`，仅可能是 `dict:*` 或 `[unresolved]`
  - 末行必含 `<!-- phase2-done: total=<N> matched=<M> no_counterpart=<X> -->`
- **派发规则**：
  - "我方对标产品"为 `-` 的条目 → 标记"无对标，跳过"，**不进入** Phase 2.5/Phase 3，直接在 Phase 6 报告
  - 有我方产品名的条目：
    - `site=cn` → 提取"我方对标产品"列作为腾讯云产品名，连同原始规格和 `售卖模式` 送入 Phase 2.5 主体规范化流程
    - `site=intl` → 同样送入 Phase 2.5，但 Phase 2.5 走"字段透传分支"：把"我方对标产品 + 原始规格/子项"直接填入 `Phase 3 检索关键词` 列，`售卖模式` 原样透传，不调用规范化脚本

> Winback 输出的面客材料同时展示给用户，供用户确认对标结果后再继续。

### Phase 2.5: 腾讯云产品名规范化（两种 site 都执行；intl 走字段透传分支）

> 详见 [how-to-normalize-tencent-product-name.md](./how-to-normalize-tencent-product-name.md)

- **触发条件**：**两种 site 都触发**。区别只在主体执行内容：
  - `site=cn` → 调用 `tencent-cloud-product-mapping/scripts/tencent_cloud_product_map.py` 固定脚本规范化产品名
  - `site=intl` → 跳过脚本调用，走"字段透传分支"（原因：脚本数据源 MCP 产品目录目前不覆盖国际站商品，强行调用会得到低置信噪声污染检索关键词）
  - **两种 site 下临时文件必须产出，列结构完全一致**
- **覆盖范围**：所有即将进入 Phase 3 的腾讯云产品条目都必须经过本阶段，包括：
  - Phase 1 临时文件中 `来源判断 = 腾讯云` 的所有条目
  - Phase 2 临时文件中"我方对标产品" ≠ `-` 的所有条目
- **输入**：上述两个上游临时文件的腾讯云条目，包含 `售卖模式`
- **执行**：
  - `site=cn` → 按子文档调用固定脚本，只规范化产品名，不改写 `售卖模式`
  - `site=intl` → 不调用脚本，按子文档 §intl 字段透传分支的列填法直接落盘（`规范化产品名` / `Phase 3 检索关键词` 取自 Phase 1/2 原值，`缩写` 留空 / 填 `-`，`售卖模式` 原样透传）
- **产物临时文件**：`<CPQ_SESSION_DIR>/phase2_5.md`
  - 首行：`<!-- site: cn -->` 或 `<!-- site: intl -->`，与 Phase 1 一致
  - 列固定为：`row_id | status | 规范化产品名 | 缩写 | Phase 3 检索关键词 | 站点 | 地域 | 售卖模式 | 优惠策略 | 返佣（%） | 约束条件 | 推断标记`
  - `row_id` / `status` / `约束条件` / `推断标记` 原样透传自 Phase 1（v2 接力链锚点，不得丢列）
  - `站点` / `地域` 原样透传 Phase 1 的值，不规范化、不改写
  - 末行必含 `<!-- phase2_5-done: total=<N> normalized=<H> fallback=<L> -->`
    - `site=cn`：`H` = 脚本高置信命中数，`L` = 回落到原始关键词的条数
    - `site=intl`：`H` 固定为 `0`，`L` 等于 `<N>`（所有条目按 fallback 处理）
- **下游**：Phase 2.6 在 Phase 2.5 产物基础上新增"选品意图"列，再交给 Phase 3 使用

### Phase 2.6: 选品意图识别（强制 · 两种 site 都触发 · 不可跳过）

> 详见 [how-to-identify-selection-intent.md](./how-to-identify-selection-intent.md)

- **触发条件**：Phase 2.5 临时文件产出后强制触发，两种 site（cn / intl）下都必须执行，不可跳过
- **输入**：`<CPQ_SESSION_DIR>/phase2_5.md` 的全部数据行
- **执行**：按子文档完成三步算法（Step B/C 构成两层选择：Step B 整单生效，Step C 单行生效）
  - Step A · 自动判定每行 `has_spec`，命中详细规格信号的行直接 `intent=c`
  - Step B（第一层 · 整单框架确认） · 若 `整单总行数 > 5` 且存在规格不明确行，先问用户"是否整单框架"；选"是"时**全单所有行**（含已自动判成 `c` 的有规格行）一律设为 `b`，意图当场全部确定并**跳过 Step C**；选"否"进 Step C
  - Step C（第二层 · 逐行确认） · 仅对规格不明确的行逐行选 `c`（精确查找）/ `a`（推荐常用）/ `b`（框架选品，仅本行生效），询问时必须附带三种模式的中文解释；有规格的行保持 `c` 不变
- **产物临时文件**：`<CPQ_SESSION_DIR>/phase2_6.md`
  - 首行：`<!-- site: cn -->` 或 `<!-- site: intl -->`，与 Phase 2.5 一致
  - 列固定为：`row_id | status | 规范化产品名 | 缩写 | Phase 3 检索关键词 | 站点 | 地域 | 售卖模式 | 优惠策略 | 返佣（%） | 约束条件 | 推断标记 | 选品意图`（在 Phase 2.5 列基础上追加 `选品意图`）
  - `row_id` / `status` / `约束条件` / `推断标记` 原样透传自 Phase 2.5；`站点` / `地域` 原样透传 Phase 2.5 的值
  - "选品意图"列写法为 `中文名（字母码）`，取值必须是 `精确查找（c）` / `框架选品（b）` / `推荐常用（a）` 之一，禁止空 / `-` / 裸字母 / 其它值；下游按括号内字母码分流
  - 末行必含 `<!-- phase2_6-done: total=<N> intent_a=<X> intent_b=<Y> intent_c=<Z> -->`，三者之和必须等于 `<N>`
- **下游**：Phase 3 读 `Phase 3 检索关键词` + `售卖模式` + `选品意图` 三列；Phase 4 映射表必须保留并展示"选品意图"列和"优惠策略"列

### Phase 3: 匹配产品

> 详见 [how-to-search-product.md](./how-to-search-product.md)

- **输入（两种 site 统一）**：Phase 2.6 产物 `<CPQ_SESSION_DIR>/phase2_6.md` 的 `Phase 3 检索关键词` + `售卖模式` + `选品意图` 三列（已涵盖所有腾讯云条目和 Winback 我方对标产品；site=cn 经脚本规范化，site=intl 字段透传）
- **执行**：**先按 `选品意图` 列分流**（分流规则见子文档入口段）：
  - `intent=b`（框架选品）/ `intent=a`（推荐常用）→ 加载 [`stage/frame.md`](./stage/frame.md)，使用框架推荐脚本按类目推荐高频 SPU
  - `intent=c`（精确查找）→ 按子文档的方式 A→B→C→D 流程链逐条匹配，命中即停。**方式 D（四层编码查找）**：方式 A/B/C 未命中且该行无 SPUID 时，按 [how-to-query-four-layer.md](./how-to-query-four-layer.md) 查码（优先 `tencent-cloud-pricing`、`inquiry-price-parallel` 兜底，此处用工具是**查码不是询价**）；若本会话 **D 段**已先行询价并把四层编码收割进 `phase4_1.md`，直接复用其 `四层编码` 列、不必重查；该列若为哨兵值 `未找到`，表示 D 段已试过且无果，方式 D 不再重查，直接落 `未匹配（四层不可用）`
  - 当 `售卖模式` 不为 `-` 时，优先保留对应 `payMode` 的产品结果。`选品意图` 列原样透传到搜索结果，供 Phase 4 映射表展示
- **产物**：每条产品的搜索结果记录（原始产品名 → 搜索关键词 → 售卖模式 → SPU ID / 四层 code → 匹配状态）
- **完成标志**：所有关键词均走完流程链，每条都有明确终态（待添加 / 待添加（四层）/ 多候选待用户选择 / 未匹配）。**方式 A/B/C 未命中但未走方式 D 的条目 = Phase 3 未完成**

> ❌ **硬约束**：Phase 3 阶段只执行搜索/查询命令，禁止执行 `row add`。
> ❌ **硬约束**：在 Phase 4 获得用户确认前，禁止执行任何写入操作。
> ❌ **硬约束**：禁止截断 SPU 变体——同一关键词命中的所有有效付费变体（预付费/后付费/包销/竞价等）必须全部保留并逐条记录，禁止为了效率只取 top 1。
> ❌ **硬约束**：禁止跳过 Phase 2.6 直接从 Phase 2.5 进入 Phase 3。Phase 2.6 临时文件不存在或缺 `phase2_6-done` 标记时，Phase 3 不可启动。

### Phase 4: 确认（⚠️ 门控点 — 禁止跳过）

> **强制规则**：无论用户是否表达"全部添加""尽量齐全"等意图，本阶段都必须执行。
> AI 在获得用户对映射表的**明确确认**前，**禁止执行任何 `row add` 操作**。

向用户展示完整映射表，包含所有条目的状态。

> **⚠️ 行粒度约束：每个 SPU ID 独占一行**。同一搜索关键词命中多个 SPU（如同一产品的预付费/后付费/包销变体），必须拆成多行分别展示，不能合并写在一行。这样映射表的"待添加"行数 = 最终 `row add` 的 SPU 数量，用户可以逐行审核和删除不需要的 SPU。"待用户选择"的多候选项也逐行展示，用户可以逐条确认或排除。

| #   | row_id | 清单产品       | 搜索关键词     | 站点 | 地域 | 售卖模式 | 选品意图      | 约束条件  | 推断标记 | 匹配结果（CPQ 产品节点名）           | SPU ID | 四层映射                                                  | CPQ payMode   | 优惠策略      | 状态           |
| --- | ------ | -------------- | -------------- | ---- | ---- | -------- | ------------- | --------- | -------- | ------------------------------------ | ------ | --------------------------------------------------------- | ------------- | ------------- | -------------- |
| 1   | r001   | 云服务器 CVM   | CVM 标准型S5   | cn   | 广州 | 包年包月 | 精确查找（c） | -         | -        | 云服务器CVM-标准型S5（预付费）       | 21793  | —                                                         | prepay        | 0.42          | 待添加         |
| 2   | r001   | 云服务器 CVM   | CVM 标准型S5   | cn   | 广州 | -        | 精确查找（c） | -         | -        | 云服务器CVM-标准型S5（后付费）       | 21794  | —                                                         | postpay       | 0.42          | 待添加         |
| 3   | r001   | 云服务器 CVM   | CVM 标准型S5   | cn   | 广州 | -        | 精确查找（c） | -         | -        | 云服务器CVM-标准型S5（包销）         | 21795  | —                                                         | underwritepay | 0.02 元/次/月 | 待添加         |
| 4   | r002   | 蓝盾流水线     | 蓝盾流水线     | cn   | -    | 包月     | 推荐常用（a） | -         | -        | —                                    | —      | 购买页（包月/企业版）=> 四层（p_coding/sp_coding_devops） | —             | -             | 待添加（四层） |
| 5   | r003   | 某未知产品     | 某未知产品     | cn   | -    | -        | 精确查找（c） | -         | -        | —                                    | —      | pricing 无此产品                                          | —             | -             | 未匹配         |
| 6   | r004   | 云数据库 MySQL | MySQL 高可用版 | cn   | 广州 | -        | 精确查找（c） | IOPS≥5000 | -        | 云数据库MySQL-高可用版（预付费）     | 801    | —                                                         | prepay        | 0.42          | 待用户选择     |
| 7   | r004   | 云数据库 MySQL | MySQL 金融版   | cn   | 广州 | -        | 精确查找（c） | IOPS≥5000 | -        | 云数据库MySQL-金融版三节点（预付费） | 804    | —                                                         | prepay        | 0.45          | 待用户选择     |

> - 每个 SPU ID 独占一行，同一搜索关键词命中多个 SPU（如不同付费模式变体）时拆成多行
> - **`row_id` 列**（v2 新增）：来自 Phase 1 → Phase 2.5 → Phase 2.6 透传值，是接力链锚点。同一 row_id 下的多行 SPU 共享同一行的所有透传字段（站点 / 地域 / 售卖模式 / 选品意图 / 约束条件 / 推断标记）；详见 [`how-to-update-phase1-incrementally.md`](./how-to-update-phase1-incrementally.md) §跨 phase 文件的 row_id 一致性
> - `站点` / `地域` 列来自 Phase 1 → Phase 2.6 透传值（`站点` 必有值，`地域` 可能为 `-`）
> - `售卖模式` 列来自 Phase 2.5 透传值；`CPQ payMode` 列来自产品搜索返回或四层结果，不得混填
> - `选品意图` 列来自 Phase 2.6 透传值，写法为 `中文名（字母码）`（如 `精确查找（c）` / `框架选品（b）` / `推荐常用（a）`），不得为空或其它值
> - **`约束条件` 列**（v2 新增）：来自 Phase 1 → Phase 2.5 → Phase 2.6 透传值。包含 PERFORMANCE_FILTER（如 `IOPS≥1800`）/ COMPLIANCE（如 `等保 2.0`）/ DEFAULT_ATTR / UNCLASSIFIED token；用户在 Phase 4 决策时**用它筛选不满足约束的候选 SPU**（如同一 row_id 下两个候选都不满足 IOPS≥5000，应排除）
> - **`推断标记` 列**（v2 新增）：来自 Phase 1 → Phase 2.5 → Phase 2.6 透传值。展示 IMPLICIT_SPEC 推断映射 + 用户的确认状态（`✓` / `（未确认）` / `（已拒绝）`）；让用户在 Phase 4 复核 AI 在 Phase 1 阶段做的隐式 SKU 推断
> - 通过方式 A/B/C 匹配的产品：填 SPU ID 和 `CPQ payMode`，"四层映射"列为 `—`
> - 通过方式 D 匹配的产品：SPU ID 为空，"四层映射"列填入 `购买页（规格参数）=> 四层（四层编码）` 格式
> - 方式 D 也失败的产品：标注失败原因（`pricing 无此产品` / `四层不可用`）
> - "待用户选择"的多候选项也逐行展示（每个候选 SPU 一行），用户可逐条确认或排除
> - 映射表的"待添加"行数应与最终 `row add` 的 SPU 数量一致，方便用户审核

**门控检查清单**（AI 自检，全部通过后才可展示映射表；本清单同时是产物校验规则——任意一项未达 = 流程违规）：

**A. 上游产物完备性**

- [ ] Phase 2.5 / Phase 2.6 / Phase 3 三份临时文件均已产出，各自首行 `site` 与 Phase 1 一致
- [ ] **Phase 1 合并展平 / 地域 Gate 已通过**：Phase 1 末行 `phase1-done` 含 `merged_flatten` / `source_rows` / `region_expanded` 三字段且取值合法；`merged_flatten=yes` 时已通过 [how-to-parse-product-list.md](./how-to-parse-product-list.md) §「🚦 合并单元格展平 Gate」六项自检；行数自洽：`total = source_rows + region_expanded`
- [ ] **站点 / 地域已全链路透传到 Phase 3 与映射表**：Phase 3 产物每条记录都带 `站点`（必有值）/ `地域`（可能为 `-`），且与 Phase 1 对应行一致；映射表已含 `站点` / `地域` 列
- [ ] Phase 2.6 末行 `phase2_6-done` 满足 `intent_a + intent_b + intent_c = total`，且每行 `选品意图` 都是 `精确查找（c）` / `框架选品（b）` / `推荐常用（a）` 之一（`中文名（字母码）` 格式，无空 / `-` / 裸字母 / 其它非法值）
- [ ] **site=cn**：所有进入 Phase 3 的条目（含 Winback "我方对标产品"）都能追溯到一次 `tencent-cloud-product-mapping` 固定脚本调用；禁止运行时临时生成脚本替代；`found=false` / 低置信 / 未找到时必须保留原始输入作为检索关键词
- [ ] **site=intl**：Phase 2.5 临时文件 `normalized=0 fallback=total`，所有 `规范化产品名` / `Phase 3 检索关键词` 都能追溯到 Phase 1 / Phase 2 原值（未调用规范化脚本）

**B. Phase 3 覆盖率**

- [ ] `<CPQ_SESSION_DIR>/phase3.md` 数据行数 ≥ Phase 2.6 `total`（不足 = 有关键词未搜索，必须补齐）
- [ ] 覆盖率 = 已匹配 + 四层匹配 + 未匹配 + 多候选 + 无对标跳过 = Phase 1 总数及其展开规格数
- [ ] 方式 A/B/C 均失败的条目都已执行方式 D（`tcloud-price search` → 有产品代码则继续 `quote --with-four-level` 或 `four-level query`）；**禁止**跳过方式 D 直接标 "未匹配"

**C. 映射表行结构**

- [ ] 同一关键词命中的多个付费变体已拆成多行（每行一个 SPU ID + CPQ payMode）
- [ ] 多候选条目已按每个候选 SPU 一行逐行展示（非合并）
- [ ] Phase 2.6 的 `售卖模式` / `选品意图` 已完整透传到 Phase 3 结果和 Phase 4 映射表；映射表已含"选品意图"列；非 `-` 售卖模式已用于过滤 `payMode`
- [ ] 每行状态唯一标注：`待添加` | `待添加（四层）` | `未匹配` | `待用户选择`（多候选）| `无对标跳过`（仅友商）
- [ ] "未匹配" 已明确原因（`pricing 无此产品` / `四层不可用` / `--with-four-level` 返回 skipped 且 manual path 无匹配）

**D. ID / 编码来源（禁止编造）**

- [ ] 每个 SPU ID 都能追溯到本次会话 `product search` / `product quick-search` / `product batch-search` 的实际返回
- [ ] 每个四层映射都能追溯到 `tcloud-price quote --with-four-level` 或 `tcloud-price four-level query` 的实际 JSON 返回
- [ ] 不得使用记忆中的 ID、猜测的 ID 或从其他报价单复制的 ID

**E. 执行隔离**

- [ ] 映射表展示并获得用户确认前，**禁止**同一轮次混合执行 `product search` 与 `row add`（搜索阶段只搜索，添加阶段只添加）
- [ ] 已等待用户的 "确认" / "继续" / "全部添加" 等明确回复；**或**用户在初始指令中已包含"全部添加"/"直接添加产品"/"请直接全部添加产品"等前置授权（此时视为预确认，无需再次弹出确认问题）

**F. 优惠 / 返佣数据完整性**（batch-update 前自检）

- [ ] **不支持优惠的行已跳过**：优惠信息为「产品不支持优惠申请」的行，batch-update JSON 中**不含** `preference` 字段（注意：「10 折」不是跳过，应设 `{"preferenceType":"discount","value":100}`）
- [ ] **折扣精度无损 + 无浮点尾差**：折扣值必须用 `round(float(折数) × 10, 6)`（如 `2.61 折` → `26.1`，非 `26.099999...`），禁止拆分整数/小数部分；反算 `value / 10` 与原值误差 ≤ 0.001
- [ ] **一口价来源正确**：用户输入清单含一口价时，preference 中的 `value` 使用用户原始数值，未被询价接口返回值覆盖
- [ ] **返佣无遗漏**：Phase 1 中 `返佣（%）` 非 `-` 的所有行，在 batch-update JSON 中都有对应的 `"rebate"` 字段（含值为 `"0"` 的行）
- [ ] **折后价与折扣一致**：`priceAfterDiscount` = `priceBeforeDiscount × discount / 1000`（允许尾差 ≤ 0.01）；`priceAfterDiscountDeleteTax` = `priceAfterDiscount / 1.06`（允许尾差 ≤ 0.01）

有"未匹配"条目时，主动询问用户是否需要调整关键词重新搜索或跳过。
有"待用户选择"条目时，列出全部候选项让用户选择，不自动决策。
用户给出明确确认后（如"确认""全部添加""跳过未匹配的"），或用户在初始指令中已给出前置授权，并经 `check-phase4-confirm.mjs` 门控通过（校验 `phase4.md` + `phase4_confirm.json`）后，方可进入 Phase 5。

> **Phase 4 确认后的分叉（C / D 解耦）**：
>
> - 用户要**落 CPQ 报价单** → 进入 Phase 5（本文 C 段）
> - 用户**只要价格、不落库**（临时对客报价 / 售前预估） → 转 **D 段询价**（见 [how-to-query-pricing.md](./how-to-query-pricing.md)），D 与 C 互不依赖、可单独发起，**不在本文流程内**

### Phase 5: 批量添加

> **前置条件**：Phase 4 门控已通过，用户已明确确认要落 CPQ 报价单（非 D 段仅询价分支）。

对所有"待添加"条目（通过方式 A/B/C 匹配的），使用 SPU ID 添加：

```command
row add --spu-ids "spuId1,spuId2"
```

`--spu-ids` 的值对应 `batch-search` 返回结果中 `hits[].results[].spuId` 字段（或 `quick-search` 返回的 `spuId`）。超过 100 个时分批执行，建议每批 50-100 个。

> ⚠请使用 `--spu-ids` 或 `--four-layer-codes`。
> 对所有"待添加（四层）"条目（通过方式 D 匹配的），使用四层编码添加：

```command
row add --four-layer-codes "p_cvm/sp_cvm_ma9,p_cos/sp_cos_standard"
```

四层 code 值来自方式 D 产出的映射中 `productCode/subProductCode` 拼接。CLI 内部取每项最后一段（斜杠分隔）作为查询 code，所以以下写法等效：

- `"sp_cvm_ma9"` — 只传 subProductCode
- `"p_cvm/sp_cvm_ma9"` — 带 productCode 前缀（推荐，可读性更好）

映射表中已展示的四层格式为：

```
购买页（包年包月/内存型MA9/MA9.MEDIUM16/2核/16GiB）=> 四层（p_cvm/sp_cvm_ma9/v_cvm_mem/sv_cvm_mem_ma9）
```

传给 `row add` 时只需取到 `productCode/subProductCode` 层级（如 `p_cvm/sp_cvm_ma9`），不需要传 valueItemCode / valueSubItemCode。

`--spu-ids` 的值必须与 `product` 命令返回的 id 精确一致。`--four-layer-codes` 的值必须与 `tcloud-price` 返回的四层编码精确一致。条目较多时分批执行（建议每批 ≤ 10 个），避免单次操作过大。

> ⚠️ 两种来源参数（`--spu-ids` / `--four-layer-codes`）互斥，不能在同一条命令中混用。需要分开执行。

批量添加完成之后需要执行

```command
cpq save
```

### Phase 5.5: 选品完整性校验（强制 · 紧跟 save 之后 · 不可跳过）

> **为什么需要**：Phase 5 `row add` 分批执行时可能遗漏 SPU（CLI 报错被忽略、分批拆分遗漏、四层编码未命中等），不做校验会导致最终报价单缺行。

`cpq save` 完成后，必须立即执行以下校验：

1. **统计应添加行数**：从 Phase 4 映射表中统计所有状态为"待添加"和"待添加（四层）"的行数 `N_expected`
2. **获取实际行数**：执行 `row list` 或 `row count` 获取报价单当前实际行数 `N_actual`
3. **比对**：
   - `N_actual >= N_expected` → 校验通过，进入 Phase 6
   - `N_actual < N_expected` → 差集分析：对照 Phase 4 映射表的 SpuId 列表与 `row list` 返回的已有 SpuId，找出遗漏的 SpuId
4. **补添加**：对遗漏的 SpuId 重新执行 `row add`，然后再 `cpq save`，重复校验直到 `N_actual >= N_expected`
5. **最大重试**：补添加最多重试 2 次；仍有遗漏的 SpuId 在 Phase 6 报告为"添加失败"并附 CLI 错误信息

> ❌ **禁止**未执行完整性校验就进入 Phase 6 结果报告。

### Phase 6: 结果报告

按最终状态分类汇报：

- **添加成功**：列出产品名
- **添加失败**：列出产品名 + 错误原因
- **未匹配**：Phase 3 无法定位的条目
- **无对标跳过**（仅友商清单）：Phase 2 中无我方对标的友商产品

> **与 F 交付质检的关系**：F 段（交付质检）先做"价格 / 编码 / 状态来源真实性"兜底自检；本 Phase 6 在 F 通过后，按选品最终状态向用户分类汇报。两者职责不同，不可互相替代。

---

## 注意事项

- 每次 `invokeClient` 只传一条 command
- 同一分类路径只浏览一次，复用结果匹配多个清单条目
- 匹配歧义时主动请用户澄清，不猜测添加
- 按具体型号/规格逐条搜索，不要只搜产品