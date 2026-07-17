---
name: cpq
description: >
  腾讯云 CPQ 客户报价专家 Skill。当用户涉及以下任何场景时必须使用：生成选品清单、报价产品清单、友商 Winback 对标、从账单/产品清单/Excel/PDF/Word/BOQ 附件提取选型、询价/估价/查刊例价/补充价格/给对客报价金额、生成优惠方案、折扣测算、制定整单折扣策略、生成系统配置单（报价单）、创建/维护/保存/提交 CPQ 配置单、添加报价行、配置单行优惠、维护客户信息、搜索/查询配置单或报价行。即使用户没有直接提到"CPQ"或"配置单"或"报价单"，只要提到"帮我估价""多少钱""算一下价格""产品对比""预算分配""报价明细""价格明细""折扣方案""选品""配置清单""BOQ""Winback""友商迁移对标""产品匹配""续费报价""扩容方案""增购""采购清单""上云方案""迁移方案""资源清单"等，也应触发本 Skill。特别注意：当用户上传了包含云产品、服务器配置、资源规格等内容的 Excel/PDF/Word 附件时，即使用户只说"帮我处理这个文件"或"看看这个表格"，也很可能需要本 Skill——请主动检查附件内容判断是否为报价相关。核心交付物是面客可用的选品清单、价格/询价明细、优惠方案和系统配置单；cpq CLI 只是在需要查询或写入 CPQ 系统时配合使用的执行工具。
---

# CPQ 客户报价工作流

> **术语统一**：「配置单」与「报价单」指同一事物（CPQ 系统中的 Quotation）；面客统一用**配置单**，CLI 与内部文档沿用 `cpq` 原始命名。「**选品**」= 把产品匹配到 CPQ 系统节点（写系统，不一定带价）；「**询价**」= 查刊例 / 估价 / 给对客价格明细（不写系统）。

这个 Skill 的主线不是"怎么使用 `cpq` 命令"，而是"怎样交付一份可信的客户报价"。先判断用户要哪类业务成果，再加载对应方法文档；只有当需要查询或写入 CPQ 系统时，才使用 `cpq` CLI。

> **选品（C）与询价（D）是两条相互独立的叶子**：可只跑其一、可换序、可先后衔接。编排规则见 §段编排总则。

## 核心交付物

| 交付物            | 用户通常怎么说                                                          | 判断重点                                                                                |
| ----------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 生成选品清单      | "帮我做选品""把这份清单转成腾讯云方案""按账单导入产品""做 Winback 对标" | 是否已有 CPQ 配置单；是否需要面客清单还是直接落系统                                     |
| 生成价格/询价明细 | "这些多少钱""查下刊例价""给个对客报价金额""补充价格"                    | 只要价格不写系统 → 走 D 询价；有 SPUID 直接 SPU 询价，无 SPUID 走预估漏斗               |
| 生成优惠方案      | "按 65 折做方案""总预算 100 万怎么分折扣""给整单一个优惠策略"           | 是否已有配置单和报价行；预算、目标折扣/折后价是否满足两项；客户分层是否可取得           |
| 生成系统配置单    | "创建配置单""把产品加到 CPQ""保存/提交配置单""配置单行优惠"             | 是空白创建还是从产品输入生成完整配置单；是否已有项目号/配置单号；产品是否已完成选品匹配 |

> "读什么文档 / 用什么 CLI" 由「渐进加载路由」表（§渐进加载路由）按用户意图查；本节不重复。路由判据见「启动判断 + 快速路由决策树」（§启动判断）。

## 附件处理能力

CPQ 任务遇到 Office / PDF 附件时，必须优先保留结构化信息，尤其是报价明细、产品清单、折扣列、合并单元格、表头层级和页内表格位置。

- Word(.doc;.docx)：优先使用 `docx-manipulation`，按段落、表格、合并单元格读取，不要先转 Markdown
- Excel(.xls;.xlsx;.csv)：优先使用 `xlsx-manipulation`，按工作表、行列、公式、合并单元格读取；生成报价明细或测算结果时也用它输出 `.xlsx`。**输出 Excel 前必须读取 `references/how-to-export-excel.md` 并按格式规范调整列颜色等样式**
- PowerPoint(.ppt;.pptx)：优先使用 `pptx-manipulation`，按 slide、shape、table 提取结构
- PDF(.pdf)：优先使用 `pdf-extraction`，优先抽取表格与页码位置；扫描件需要先说明 OCR 可能影响准确率
- 禁止为省事使用统一的 Office → Markdown 转换来处理表格型附件，除非用户明确只要纯文本摘要
- **退化兜底**：若对应 skill 不可用 / 解析失败 / 文件结构无法识别，可退化为通用脚本（openpyxl / python-docx / pdfplumber 等），但必须向用户说明本次未走 skill 路径及原因

---

## 启动判断

收到请求后，先完成以下判断，再动手：

0. **站点（site）—— 全流程零号要素，必须在任何段执行前确定**：国内站（`cn`）还是国际站（`intl`）？默认 `cn`。判定规则：
   - 用户原始请求直接说明（"国内站""国际站""走 intl""海外报价"）→ 直接锁定
   - 清单/上下文出现海外信号词（Singapore / Tokyo / Frankfurt / Seoul / Mumbai / Bangkok / Hong Kong / Silicon Valley / 国际站 / intl / oversea / TencentCloud（不是 cloud.tencent.com）/ USD 计价 / 跨境 / 海外业务 / 历史含 `--oversea`）→ 锁定 `intl`，并口头确认一次"已按国际站处理"
   - 同时含国内与海外地域、或用户明示"两个站点都要" → `askUser` 单选 `国内站 cn / 国际站 intl / 拆成两单`
   - 其余 → 默认 `cn`
   - 锁定后由 A 写入 `context.md` / `phase1.md` 首行 `<!-- site: cn|intl -->`，下游各段读该标记决定分支
1. **业务意图**（路由第一判据）：选品（C）/ 询价（D）/ 优惠方案（E）/ 纯 CLI 操作？**C 与 D 可同时要、可只要其一**。
   - 进入 **C 选品**：生成系统报价单 / 走报价流程 / 生成 cpq 配置单 / cpq 选品 / 向已有 cpq 单加选品（需 AI 选品判断那种）
   - 进入 **D 询价**：生成面客配置单 / 对客报价单 / 刊例价 / 查看价格 / 补充价格（带价或面客）
   - 歧义（分不清要"CPQ 选品"还是"只补价格"）→ **先问用户**，不擅自推断。完整进入条件见 `references/how-to-select-product.md`（选品）/ `references/how-to-query-pricing.md`（询价）
2. **exec_mode 检测**：主 agent 跑 A 时自检能否 spawn 子 agent → A 把 `exec_mode=subagent|main` 写入 `context.md`，主 agent 据此决定 B/C/D 用子 agent 并发还是内联顺序（见 §会话目录 / `references/how-to-prepare-context.md`）
3. **落地范围**：只生成面客材料，还是写入 CPQ 系统并 save / submit？
4. **信息完备性**（按意图区分必需输入，缺失先补齐，不猜测）：
   - 选品 / 配置单 → 必需：产品清单或附件；可选：项目号（仅落系统时需要）
   - 询价 → 必需：产品清单或附件（有 SPUID/四层编码更精确）
   - 优惠方案 → 必需：配置单号（或已有报价行）+ 预算/折扣目标至少两项
   - 操作已有配置单 → 必需：配置单号；创建空白配置单 → 必需：项目号
5. **附件类型**（仅当用户提供 Office / PDF 附件时）：按 §附件处理能力 加载对应 skill；不可用时按该段退化兜底并说明。

**快速路由决策树**（**进入本树前必须已锁定 site**）：

```
用户请求
├─ 锁定 site（cn / intl，默认 cn；判定见判断 0）——未锁定禁止进入下方
├─ A 上下文准备（必跑）：解析清单 → context.md（含 site / 业务意图 / exec_mode / 路线）+ phase1.md
├─ B 产品 mapping / Winback（条件：A 解析出现友商行 competitor>0）→ 读 winback.md（按 site 委托 mapping 技能）
├─ 业务意图含选品 → C 选品（独立叶子）：读 how-to-select-product.md
├─ 业务意图含询价 → D 询价（独立叶子）：读 how-to-query-pricing.md
│        C 与 D 相互独立、可换序、可只跑其一；有 SPUID 的行 D 直接 SPU 询价（不依赖先选品）
├─ 业务意图 = 优惠方案（已有配置单号 + 折扣/预算目标）→ E：读 how-to-make-discount-plan.md
├─ 业务意图 = 创建空白配置单（有项目号无产品输入）→ CLI 直接 `create`（读 cpq-cli.md）
└─ 业务意图 = 查询/操作已有配置单或产品（查看/查询/保存/提交/复制/转交/删除/搜索）→ CLI 直接操作（读 cpq-cli.md）
```

> **路由铁律**（细节在 §段编排总则 / 各段 ref，本节不复述）：
>
> 1. **第一判据是业务意图，不是"是否提供了产品清单"**。同一份清单在"选品/询价"和"贴上下文查历史"下走不同路径——先确认意图。
> 2. **C 与 D 解耦**：可只跑其一、可换序；含精确 SPUID 的行在 C 决策树 b 步直接加行、在 D 直接走 SPU 询价（不再由路由层预分流）。
> 3. **路由层不预判产品来源 / site 分支 / 规范化路径**——由各段执行时按 A 的解析结果与已锁定 site 自动完成。

## 会话目录（CPQ_SESSION_DIR）

A / B / C / D 的中间产物及若干 CLI 中转文件落盘到本次会话目录；reference 中 `<CPQ_SESSION_DIR>` 占位符 = 该目录的绝对路径。

- **A 启动前必须解析一次**：`node scripts/resolve-session-dir.mjs`，输出带**随机后缀**的目录（`.cpq-tmp/<ts>-<rand4>/`，确保同秒多任务互不干扰），绑定到本会话上下文，全段复用。同会话跨段复用同一目录时把首次的 `<ts>-<rand4>` 作为参数回传。
- **解析顺序**：`CPQ_TMP_DIR` env → `<cwd>/.cpq-tmp/<ts>-<rand4>/`（默认）→ `<os.tmpdir()>/cpq/<ts>-<rand4>/`（兜底）
- **关键中间文件**：`context.md`（A · 含 site / 业务意图 / `exec_mode` / 路线）、`phase1.md`（A）、`phase2.md`（B）、`phase2_5/2_6/3/4.md` + `phase4_confirm.json`（C）、`phase4_1.md`（D）
- **完整契约**（跨平台落点表 / 文件命名 / env 覆盖 / 调试清理 / 故障排查）见 [`references/cpq-session-dir.md`](references/cpq-session-dir.md)

> ❌ **禁止**用裸 `/tmp/...` 替代 `<CPQ_SESSION_DIR>` —— 系统临时目录是工作区外，且不跨 Windows / 小O沙箱兼容。

## 段编排总则

> **字母只是标签，不是强制顺序**：A 必先于 B/C/D；B 是 C/D 的条件前置（仅 competitor>0 时触发）；**C 与 D 相互独立、可换序、可只跑其一**；E 需要 C 落库后的报价行；F 永远最后兜底。各段 gate 脚本优先于 AI 自检——单一权威定义在各段 reference，本节只给编排骨架。

> **前置授权（Pre-authorization）机制**：当用户在初始指令中包含"全部添加"/"直接添加产品"/"请直接全部添加产品"/"不用确认"/"直接创建配置单"等明确表达跳过中间确认环节的意图时，视为用户对整个流程的前置授权。此时：
> - C 的 Phase 4 门控自动通过（无需展示映射表等用户回复）
> - `row add` 无需额外的破坏性操作预告
> - `create` 可在选品完成后直接执行
>
> 前置授权**不豁免**的环节：A~C 的 Phase 1-3 实际执行（选品质量不可跳过）、F 交付质检（真实性不可跳过）、`save`（持久化不可跳过）。

0. **站点 site 是所有段的前置（最高优先级）**：site 未锁定前禁止进入 A、禁止读 `cloud-mapping[-intl]` 字典、禁止调 `tencent-cloud-product-mapping`。site 锁定后贯穿全程，下游读到首行标记缺失或不一致必须停。site 判定见 §启动判断 0；**cn/intl 字典隔离的单一权威定义见 `references/winback.md`**（cn 全量 vs intl 64 款产品/18 地域，禁止跨站点取数据）。
1. **A 上下文准备（必跑入口）**：解析清单 → `phase1.md` + `context.md`（含 site / 业务意图 / `exec_mode` / 路线建议）。主 agent 读 `context.md.exec_mode` 决定 B/C/D 用子 agent 并发还是内联顺序。编排详见 `references/how-to-prepare-context.md`（A4 解析算法见 `references/how-to-parse-product-list.md` 的 ABCD 四阶段）。
   - **单次执行原则**：`phase1.md` 落盘 + `node scripts/check-phase1.mjs --session-dir <CPQ_SESSION_DIR>` exit 0 ⇒ A 进入完成态。`phase1.md` 是 A 的唯一权威产物，下游需要时从它读取，**禁止重跑 A**（重解析 / 重追问 / 重伴生拆分）。
   - **局部更新 ≠ 重启 A**：用户在下游改产品 / 地域 / 数量是对 `phase1.md` 的增量更新（见 `references/how-to-update-phase1-incrementally.md`），不重新走全量 A。
2. **B 产品 mapping / Winback（条件触发）**：A 解析出现友商行才触发，按 site 委托 `cloud-mapping[-intl]` 对标 → `phase2.md`。完整契约（site 分支、字典隔离、伴生拆分）见 `references/winback.md`。
3. **C 选品（独立叶子）**：运行时 Phase 2.5（规范化）→ 2.6（意图识别）→ 3（搜索匹配）→ 4（映射表，**写入门控**：展示+用户确认）→ 5（`row add` + **必须 save**）。快捷路径（含 SPUID 直接加行）/ 规范化 / 意图识别 / 搜索 / 四层查询的单一权威定义在 `references/how-to-select-product.md` 及其子 ref，本节不重复。
4. **D 询价（独立叶子）**：产物 `phase4_1.md`（由 `fill-phase4-1.mjs` 写盘）。有 SPUID 的行直接 SPU 询价；无 SPUID 的行走预估漏斗（① `inquiry-price-parallel` → ② `tcloud` 兜底），过非 SPU 工具后把四层编码**反哺**中间表（供 C 复用）。前导 gate（A 完成 + B 完成或明确跳过）+ 漏斗顺序见 `references/how-to-query-pricing.md`。
5. **save / submit**：`save` 是 C 的 Phase 5 内**强制收尾**——`row add` / `row import` / `row update` / `row batch-update` / `row rm` 只在会话内存生效，**不 `save` 则线上数据为空**；`submit` 是独立 CLI 动作，仅用户明确要求才执行。
6. **报价行唯一标识 = `spuId + payMode`**：统计 / 复制报价行按 `节点ID`（`{spuId}_{payMode}`）计数与对比，而非去重后的 SPU ID。`row add --spu-ids` 只传 spuId 会展开该 SPU 全部付费变体；需精确时传 `12345_prepay`，复制场景应直接传精确的 `spuId_payMode` 列表。
7. **搜索关键词不可篡改 + 售卖模式透传**：A 产出的搜索关键词与 `售卖模式` 在后续各段不得简化 / 截断 / 改写；C 的 Phase 3 必须用 `售卖模式` 过滤 `payMode`（硬约束，见 §全局禁令第 4 条）。

## 渐进加载路由

只加载当前任务必需的 reference，避免把命令细节和内部策略提前塞进上下文。

| 用户意图                                                                              | 必须读取                                                                                                                                                                                                                                                                                                                                                                                          | 不要提前读取                  | CLI 使用点                                                                                                                |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 用户提供 Office / PDF 附件作为输入材料（与下方任意 Phase 路由叠加）                   | §附件处理能力 中对应的 sibling skill 的 `SKILL.md`（`xlsx-manipulation` / `docx-manipulation` / `pptx-manipulation` / `pdf-extraction`）                                                                                                                                                                                                                                                          | —                             | 解析阶段不调 CLI                                                                                                          |
| 从已有 SPU ID 的清单创建配置单（快捷路径）                                            | 无需额外 reference（Phase 1 提取 + Phase 4 确认即可）                                                                                                                                                                                                                                                                                                                                             | 选品/优惠文档                 | `create`、`row add --spu-ids`、`save`                                                                                     |
| A 上下文准备：解析清单 + 锁 site + 识别路线 / `exec_mode`（每个任务入口必跑）         | `references/how-to-prepare-context.md`（编排 / `context.md` / `exec_mode`）+ `references/how-to-parse-product-list.md`（A4 ABCD 主算法）；阶段 A.2 token 分类按需加 `references/how-to-classify-tokens.md`；阶段 D 歧义出口加 `references/how-to-resolve-phase1-ambiguity.md`；非表格输入加 `references/how-to-normalize-input.md`；下游改单加 `references/how-to-update-phase1-incrementally.md` | 选品/询价/优惠文档            | `resolve-session-dir.mjs`、`check-context.mjs`、`check-phase1.mjs`                                                        |
| C 选品：从产品清单/报价明细/BOQ/附件生成选品清单或创建系统配置单                      | A 必读 `references/how-to-select-product.md`；含友商行时再读 `references/winback.md`（按 site 自动委托）                                                                                                                                                                                                                                                                                          | 优惠策略文档                  | `product batch-search`、`row add`、需要落系统时加 `create`、`save`                                                        |
| D 询价：只要价格/刊例/对客报价金额、补充价格（不写系统）                              | `references/how-to-query-pricing.md`；含友商行先经 B 对标，无 SPUID 行需查四层读 `references/how-to-query-four-layer.md`                                                                                                                                                                                                                                                                          | 选品/优惠文档                 | `cpq product price`（SPU 精确）/ `inquiry-price-parallel` ① / `tencent-cloud-pricing` ②                                   |
| 从客户账单生成选品清单                                                                | 本文件"生成系统配置单"中的账单导入规则；如需二次匹配再读 `references/how-to-select-product.md`                                                                                                                                                                                                                                                                                                    | Winback 文档                  | `row import`                                                                                                              |
| 创建空白配置单                                                                        | 无需额外 reference                                                                                                                                                                                                                                                                                                                                                                                | 选品/优惠文档                 | `create`                                                                                                                  |
| 搜索产品 / 不确定如何构造搜索关键词                                                   | `references/how-to-search-product.md`                                                                                                                                                                                                                                                                                                                                                             | 优惠策略文档                  | `product batch-search` / `product quick-search -q`                                                                        |
| 识别每行的选品意图（推荐常用/框架/精确）                                              | `references/how-to-identify-selection-intent.md`                                                                                                                                                                                                                                                                                                                                                  | 优惠策略文档                  | 无 CLI（仅写 `<CPQ_SESSION_DIR>/phase2_6.md`）                                                                            |
| Phase 3 中 intent=b（框架选品）的行                                                   | `references/stage/frame.md`                                                                                                                                                                                                                                                                                                                                                                       | 优惠策略文档                  | `node scripts/frame-recommend.mjs`、`product batch-search`（互斥检测）                                                    |
| 生成整单优惠方案                                                                      | `references/how-to-make-discount-plan.md`                                                                                                                                                                                                                                                                                                                                                         | Winback 文档                  | `customer info`、`row list`、`row batchUpdate`                                                                            |
| 配置单行精细优惠                                                                      | `references/how-to-preference-one-row.md`；如识别为新商品库，再读 `references/scenario-new-spu-preference.md`                                                                                                                                                                                                                                                                                     | Winback 文档                  | `row cat`、`row update`                                                                                                   |
| 设置报价行价格（预估消耗/折后价） / 返佣                                              | `references/how-to-set-price.md`                                                                                                                                                                                                                                                                                                                                                                  | 优惠策略文档                  | `row batch-update`                                                                                                        |
| 从已有配置单复制产品到新配置单                                                        | `references/how-to-copy-rows.md`                                                                                                                                                                                                                                                                                                                                                                  | 选品/优惠文档                 | `row list`、`row add`、`row rm`、`save`                                                                                   |
| 业务意图为查询/操作已有配置单或产品（查看、查询、保存、提交、复制、转交、删除、搜索） | 无需额外 reference；CLI 用法见 `references/cpq-cli.md`                                                                                                                                                                                                                                                                                                                                            | 选品/优惠/Winback/复制行 文档 | `create`、`save`、`submit`、`copy`、`share`、`delete`、`search`、`info`、`cpq360`、`row list/search/inspect/cat` |

## 六段入口

> 每段的详细执行步骤全部下放到对应 reference / subagent 文档；本节只给"哪一段、读什么、产出什么"。各段 gate 脚本（`scripts/check-*.mjs`）是机器门控，优先于 AI 自检。

- **A 上下文准备**（必跑入口）：解析产品清单 / 附件，提取产品名 / 配置 / 数量 / 地域 / 售卖模式（同一 CPQ 节点去重，配置差异保留在行内）+ 锁定 site + 检测 `exec_mode` → `phase1.md` + `context.md`。编排读 `references/how-to-prepare-context.md`，解析算法读 `references/how-to-parse-product-list.md`。
- **B 产品 mapping / Winback**（A 解析出现友商行才触发）：按 site 委托 `cloud-mapping[-intl]` 对标 → `phase2.md`；混合清单无需路由层拆分，B 只对含友商的行触发，腾讯云行自然进入 C/D。读 `references/winback.md`。
- **C 选品**（要写系统 / 走报价流程时）：规范化（Phase 2.5）→ 意图识别（2.6）→ 搜索匹配（3）→ 映射表 **Phase 4 用户确认**（门控）→ `row add` + **`save`**（Phase 5）。两个特例：①清单已含 SPUID → 快捷加行；②按客户账单导入 → `row import`（覆盖当前产品，须预告）。读 `references/how-to-select-product.md`。面客输出用产品名 / 规格 / 数量 / 地域 / 计费方式，**不输出**内部查询词 / 文件路径 / "映射命中"。
- **D 询价**（只要价格、不写系统时）：有 SPUID 行直接 SPU 询价；无 SPUID 行走预估漏斗（① `inquiry-price-parallel` → ② `tencent-cloud-pricing` 兜底）→ `phase4_1.md`（价格明细 + 反哺四层编码）。读 `references/how-to-query-pricing.md`。面客只给价格明细，不透露脚本路径 / 内部词。
- **E 优惠方案**（已有报价行 + 折扣/预算目标）：缺报价行但有产品清单时先走 C；金额/比例三项（总预算 / 期望综合折扣 / 折后总价）至少给两项才可计算。`customer info` 取客户分层 + `row list` 取报价行 → 构造计算输入 → 面客只呈现折扣率 / 折后价 / 整单结果，不透露通过率 / 审批概率 / 内部路径。读 `references/how-to-make-discount-plan.md`（设置报价行价格 / 返佣读 `references/how-to-set-price.md`，单行优惠读 `references/how-to-preference-one-row.md`，新商品库再读 `references/scenario-new-spu-preference.md`）。
- **F 交付质检**（任何即将面客交付前的内部自检）：逐项回溯每个数据点来源——配置单链接 / 项目号 / SPU 匹配 / 优惠数据 / `save` 是否真实执行；任一不可溯源则**不输出该数据点**，如实告知状态。判定标准见 §全局禁令第 10 条（真实性铁则）。这是历史上 AI 在前序步骤失败后编造交付物的兜底拦截关卡，不替代任何前序门控。

## 常见陷阱

- **跳过 C 的 Phase 4 门控直接写入**：Phase 3 搜索完成后必须先展示映射表、等用户确认，才能 `row add`。即使结果看起来"很明确"也不能跳过——硬门控，不是建议。（唯一例外：用户在初始指令中已包含"全部添加"/"直接添加产品"等前置授权时，Phase 4 自动通过，无需再次弹出确认）
- **在 Phase 4 之前就 create / 定位配置单**：`create` / `info` 必须在 Phase 4 用户确认后才执行，否则用户调整映射时配置单内容已错。（例外：用户初始指令含前置授权时，Phase 4 自动通过，`create` 可紧接选品完成后执行）
- **用已有配置单代替 create**：用户说"创建配置单"时不能因上下文有已存在单号就复用，除非用户明确"用这个配置单 / 加到已有单里"。
- **违反 C 的 site 分支契约 / 跳过意图识别**：AI 易在"产品名已是标准腾讯云名""intl 不用规范化""每行都有规格就不用 2.6"等错觉下跳步或错调脚本——单一权威定义在 `references/how-to-select-product.md` 及其子 ref，动手前对照，不靠记忆推断。
- **误解折扣含义**：CPQ"折扣"= 折扣率（乘数），0.65 = 六五折 = 实付 65%；"打 35% 折扣" = 折扣率 0.65。歧义表述（"给 65% 的折扣"）必须追问确认，避免把"65 折"误传成"折扣 65%（实付 35%）"。
- **折扣数值被截断/四舍五入**：从 Excel 解析折扣时用 `int(rate * 10)` 或 `round()` 会丢失精度（如 `3.919 折` → `39` → `3.9 折`，导致折后价偏差数千元）。必须原样传递原始浮点值，见 §全局禁令第 0 条。
- **优惠设置失败后静默跳过**：CPQ API 对某些产品（容量预留、带策略折扣）的 preference 有精度/格式限制，`row update --key preference` 可能返回「设置优惠失败」。此时必须降级到直接写 `priceAfterDiscount`，不得跳过。见 §全局禁令第 0.1 条。
- **批量脚本用 `set -e` + `&&` 链式命令**：单个优惠设置失败会导致同行后续的 priceBeforeDiscount / priceAfterDiscount 命令被跳过，出现刊例价=0 的异常。必须每条命令独立执行。见 §全局禁令第 0.1 条。
- **附件配置单的正确路径**：`解析附件 → 锁 site → A → (含友商行触发 B Winback，按 site 委托 mapping 技能) → C(2.5 → 2.6 → 3 → Phase 4 确认) → create → Phase 5 写入 → save`。常见错误：只要项目号 `create` 后结束；读完文档跳过 A~C 直接 `create`；未锁 site 就进入 A。
- **只给折扣目标 / 只要空白单**：用户"按 65 折做报价"但只给产品清单 → 先 C 选品 + 写报价行再进 E，不能只凭折扣目标直接算；用户"创建空白配置单"且无产品输入 → 可只 `create` 并说明是空白单。
- **只缺价格列的完整产品表 → 误判精确报价**：xlsx 已有产品名 / 规格 / 数量但缺刊例价，用户说"补个价 / 查个价"。**产品名 ≠ SPUID**——无 SPUID 行 D 走的是预估漏斗（估价，远端工具可能自补默认值 / 自挑可用区），不是精确 SPU 报价。若用户实际要精确报价，需先 C 选品拿 SPUID 再 D 询价；AI 分不清"要精确报价还是估价"时**先追问**，不擅自决定。漏斗逐层降级由 `scripts/check-phase4-1-funnel-gate.mjs` 机器校验，禁止跳级。
- **搜索关键词被偷偷简化 / 含禁用 token**（A 解析铁律）：关键词 = 产品名（含中文全名）+ 显式规格 + 已确认隐式规格。❌ 删中文全名（"云服务器 CVM"→"CVM"）；❌ 把地域 / 数量 / 售卖模式塞进关键词（各有独立列）。`scripts/check-phase1.mjs` 组 D 黑名单正则机审拦截。Phase 2.5（intl 字段透传分支）必须**字符级原样透传** A 的关键词。
- **未拆伴生产品**：CVM 行的"系统盘 SSD 40GB / 数据盘 SSD 250GB"必须按 [`references/how-to-identify-companion-products.md`](references/how-to-identify-companion-products.md) 拆成独立 CBS 行，否则 Phase 5 `row add` 漏掉这些 SPU。触发词字典 `references/data/phase1-token-dict/companion-trigger.md`，命中即拆；`check-phase1.mjs` 组 C 反向印证 `companion_expanded`。
- **凭常识默认售卖模式 / 静默丢未识别列**：❌ 看到"承诺三年"默认填包年包月（可能 RI / SP / 包销任一），按 [`references/how-to-resolve-phase1-ambiguity.md`](references/how-to-resolve-phase1-ambiguity.md) §A.1 追问；❌ 含约束列（Ice Lake / IOPS≥1800）直接丢弃，必须进 `约束条件` 列并在 Phase 4 展示；❌ 静默忽略不认识的列，必须列入 `unmapped_columns` 一次性告知用户。`check-phase1.mjs` 组 B 兜底。

---

## cpq CLI 工具箱

> 偶发失败时重试 2-3 次；仍失败则按"CLI 可用性前置检查"小节处理。

> **⚠️ CLI 可用性前置检查（硬性门槛）**：
>
> 在任何需要调用 `cpq` CLI 的段/步骤之前（包括但不限于 C 的 `product batch-search`（Phase 3）、`create`、`row add`（Phase 5），D 的询价工具等），**必须完成以下初始化**：
>
> 1. **验证可用性**：`command-auth whoami`
>    - 成功 → 后续统一使用 `cpq <command>`
>    - 失败（未授权）→ 遵循 CLI 输出的引导完成授权，或向用户明确报告 "`cpq` CLI 不可用，流程终止于 Phase X"
>
> - 禁止以任何替代方式跳过此检查继续执行——包括但不限于：凭自身知识猜测 SPU ID / 产品匹配结果、编造搜索结果、使用记忆中的历史数据、模拟 CLI 输出等
> - 本约束优先级高于所有 Phase 执行规则：CLI 不可用 = 流程不可继续 = 必须停止并告知用户

`cpq` CLI 是查询和写入 CPQ 系统的工具；使用前先读 `references/cpq-cli.md` 获取完整命令、用法和参数。

## 常用功能

注意，使用`cpq`命令时，必须先执行`cpq help <command>`,查看使用文档后执行：

| 命令                                | 作用               | 说明                                                    |
| ----------------------------------- | ------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------ |
| `project search [keyword]`          | 查询我名下的项目   | [keyword] [--uin uin] [--oversea                        | --domestic] [-p page] [-s size]搜索项目列表（支持关键词、UIN、区域过滤） |
| `cpq search`                        | 查询我名下的配置单 | 搜索配置单（默认国内站，--intl 国际站，--all 查全部人） |
| `cpq rename {cpqcode} {配置单名称}` | 重命名配置单名称   | 设置配置单名称                                          |

国内站配置单地址：https://panshi.woa.com/cpq/quotation/apply/{cpqcode}?hideSider=1&hideLayout=1

国际站配置单地址：https://intl.panshi.woa.com/cpq/quotation/apply/{cpqcode}?hideSider=1&hideLayout=1

## 全局禁令

以下规则在整个 Skill 生命周期内有效，不因用户偏好、效率诉求或看似明确的搜索结果而豁免：

0. **数值精度铁律——禁止对折扣/价格做四舍五入或截断**：

   > **历史教训**：agent 用 `int(rate * 10)` 将 Excel 中的 `3.919 折` 转为 CPQ discount 值 `39`（实际 3.9 折），导致 34 行产品的折后总价与原始报价偏差数千元。`int()` 是截断（floor toward zero），不是四舍五入，但**两者都不允许**——任何精度损失都会导致最终报价金额错误。
   - ❌ **禁止** 使用 `int()`、`math.floor()`、`math.ceil()`、`round()` 或任何取整函数处理折扣率、价格、金额
   - ❌ **禁止** 将小数折扣乘以 10 再取整（如 `int(3.919 * 10)` → `39`）——这是最常见的精度丢失模式
   - ✅ **必须** 将 Excel 原始折扣值**原样**传递给 CPQ CLI（如 `3.919 折` → discount 值 `39.19`，或按 CLI 要求的精度格式传递原始浮点数）
   - ✅ **必须** 价格/金额字段使用 Excel 单元格的原始字符串值，不做二次计算或格式化
   - ✅ **适用范围**：所有 Python / Node.js / Shell 脚本中对折扣率（`discount`）、刊例价（`priceBeforeDiscount`）、折后价（`priceAfterDiscount` / `priceAfterDiscountDeleteTax`）、一口价（`fixedPrice`）、税率（`taxRate`）的处理

0.1. **折扣设置失败必须重试——禁止静默跳过**：

   > **历史教训**：agent 设置折扣优惠时，CPQ API 返回「设置优惠失败」，agent 检测到 8 条失败命令但判断为"非关键警告"直接 save+submit，导致 6 个产品的优惠字段为空、1 个产品刊例价归零。

   - ❌ **禁止** 在 `row update` / `row batch-update` 的 preference 设置失败后静默跳过——优惠为空意味着该行报价无效
   - ❌ **禁止** 在批量更新脚本中使用 `set -e` + `&&` 链式命令——单个字段失败会导致同行后续字段（priceBeforeDiscount / priceAfterDiscount）被跳过
   - ✅ **必须** 对每条 `row update` 的返回结果检查是否包含「失败」/「error」，失败行记录到 retry 列表
   - ✅ **必须** discount 设置失败时，按以下降级策略依次尝试：
     1. 用 `preference` 字段设置带策略的折扣（适用于含地域/规格条件的折扣）
     2. 若 preference 也失败，直接设置 `priceAfterDiscount`（折后含税价）+ `priceAfterDiscountDeleteTax`（折后不含税价），跳过 discount 字段
     3. 降级后必须在最终输出中告知用户哪些行使用了降级方案
   - ✅ **必须** 批量更新脚本中每条命令独立执行（不用 `&&` 串联），单条失败不影响后续命令
   - ✅ **必须** save 前验证所有行的 `priceBeforeDiscount` 和 `priceAfterDiscount` 非零（除非原始 Excel 中确实为 0），发现异常必须修复后再 save

0.2. **批量写入后必须全量校验——禁止盲目 save+submit**：

   > **历史教训**：agent 跑完 696/704 条更新命令后，未对失败的 8 条做任何处理，直接 save+submit，导致产出报价单有 7 个字段异常。

   - ✅ **必须** 批量写入完成后、save 之前，执行 `row list` 或 `row inspect` 抽检关键字段：
     - `priceBeforeDiscount` 不为 0（除非原始数据确实为 0）
     - `discount` 或 `preference` 非空（除非该产品标记为"不支持优惠"）
     - `priceAfterDiscount` 非空
   - ✅ **必须** 发现异常行时先修复再 save，不得带着已知缺陷提交
   - ❌ **禁止** 将 CPQ API 返回的业务错误（如「设置折扣优惠失败」「当前报价行已被锁定」）判断为"非关键警告"而忽略

1. **文档先于执行**：在阅读对应方法文档前，不得执行该文档中的命令或脚本；顶层路由只负责决定读哪个文档。
2. **Phase 门控不可绕过**：C 的 Phase 4 获得用户明确确认前，不得执行 `row add` / `row import` / `row update` / `create`。**例外（前置授权）**：若用户在初始指令中已明确表达"全部添加"/"直接添加产品"/"请直接全部添加产品"/"直接创建配置单"等跳过确认的意图，Phase 4 视为自动通过——用户的初始指令本身即视为对选品结果的预确认，无需在 Phase 4 再次弹出确认问题。规范化（Phase 2.5）/ 意图识别（2.6）必须按 `references/how-to-select-product.md` 及其子 ref 的契约执行：产物缺失或不合规时下游必须停止，不得自行推断。读完文档 ≠ 执行完——每段必须按当前 site 的契约产出对应产物。
3. **数据只来自权威源（且按站点隔离）**：友商映射字典按 site 隔离的完整规则与字典路径见 `references/winback.md`（**单一权威**）；计费四层编码只用 `references/billing-catalog/` 数据。两个站点字典覆盖范围不同（国际站只有 64 款产品 / 18 个地域，cn 全量），**禁止跨站点取数据**——混读会得到该站点无法售卖的规格。无结果就是无对标，不得凭自身知识填充或推测。原因：AI 训练数据中的产品对应关系可能过时或错误，用它做映射会给客户一份不可信的报价。
4. **搜索关键词不可篡改**：Phase 1/2.5 产出的完整搜索关键词在后续 Phase 中不得简化、截断或改写；Phase 3 搜索结果中同一关键词命中的多个有效 SPU 付费变体必须全部保留。原因：关键词的每一部分（产品名+规格+子类型）都承载了用户原始需求信息，简化会导致搜索偏移、命中错误产品。
5. **歧义必须人工决策**：有歧义的产品匹配结果必须列出候选项让用户确认，不得自动决策。
6. **面客输出无内部词汇**：禁止在面客输出中使用"映射""grep""查询""命中""脚本路径""通过率""审批概率"等内部实现词汇。
7. **破坏性操作必须预告**：`row import`、批量更新、删除、提交审批前必须说明影响范围，不得静默执行。**例外**：当用户在初始指令中已给出前置授权时，`row add` 不属于需要预告的破坏性操作——用户的初始指令本身已覆盖该预告义务。
8. **先拿数据再追问**：获取必要数据前不追问策略偏好；先读取产品/客户/报价行/映射/折扣上下文，再判断真正缺什么。原因：很多看似"缺少的信息"其实已在系统中（如客户分层、建议折扣），提前追问会浪费用户时间并显得不专业。
9. **写入后必须 save（最高频遗漏项）**：任何执行了 `row add` / `row import` / `row update` / `row batch-update` / `row rm` / `customer set` 的流程，结束前**必须**执行 `cpq save --cpqcode {code}`。cpq CLI 的写入类命令只在本地会话生效，不 save 则线上配置单数据为空。这是与 Phase 门控同等级别的硬约束。
10. **真实性铁则——AI 输出的每个业务数据点都必须可溯源（F 交付质检的根基）**：

    > **为什么这条比所有其他规则优先级都高**：CPQ 的输出直接决定客户报价金额和商务决策。一个虚构的配置单链接被 SA 转发给客户后，无法召回；一个编造的折扣率被写入审批系统后，可能造成真实的财务损失。AI "不确定但诚实" 的输出永远优于 "看起来完整但含有编造" 的输出。
    >
    > 本条与 F（交付质检）互为表里：F 是质检动作，本条是质检背后的判定标准。

    **可溯源的含义**：输出中的每个业务数据点必须能在本次会话中找到明确来源——要么是 CLI 命令的实际返回，要么是用户的明确输入/确认。如果找不到来源，该数据点就是编造，不得输出。

    | 数据类型                   | 唯一合法来源                                                        | 编造的典型表现                                                         |
    | -------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
    | 配置单链接 / 配置单号      | `create` / `info` / `url` 命令的实际返回                            | 凭 URL 模式拼接虚假链接（如 `https://cpq.tencentcloud.com/quote/xxx`） |
    | 项目号                     | 用户原始输入 或 `project search` 后用户确认                         | 从上下文推测、从产品名猜测、编造数字                                   |
    | SPU ID / 产品匹配          | `product batch-search` / `quick-search` 实际返回                    | 凭产品名猜测 ID、使用训练数据中的过期映射                              |
    | 折扣率 / 折后价 / 优惠方案 | `calc-discount` 脚本实际输出 或 `row list` 返回的 `suggestDiscount` | 凭"经验"估算折扣、编造通过率                                           |
    | Phase 中间产物             | 对应 Phase 的实际执行结果（CLI 返回 + 用户输入）                    | 跳过 Phase 执行直接写临时文件                                          |

    **当来源缺失时**（CLI 失败 / 未执行 / 用户未提供）：
    - ✅ 如实告知用户当前状态和失败原因
    - ✅ 给出可操作的下一步（如"请提供项目号"、"请确认权限"、"请稍后重试"）
    - ❌ 绝不编造替代数据来维持"任务完成"的假象

## 错误恢复

| 错误场景                                              | 处理策略                                                                                                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| CLI 命令超时或网络错误                                | 重试一次；仍失败则告知用户当前系统状态并建议稍后重试，不要静默跳过该步骤                                                                  |
| `create` 返回权限错误（如"没有这个项目的权限"）       | **立即停止流程**，如实告知用户权限不足的原始错误信息，建议用户确认项目归属或联系项目管理员添加权限。❌ 绝对禁止编造配置单号或链接假装成功 |
| `create` 返回其他业务错误                             | 如实展示错误原文，根据错误类型给出可操作建议（如项目号不存在→确认项目号；项目已关闭→联系PM），不编造结果                                  |
| C 的 Phase 3 搜索返回空结果                           | 按 A→B→C→D 四种方式逐级兜底；全部穷尽后标记"未匹配"，在 Phase 4 映射表中明确展示                                                          |
| D 询价：无 SPUID 行 ① `inquiry-price-parallel` 未命中 | 走 ② `tencent-cloud-pricing` 兜底；仍无价则该行价格留空 + 标注"未询到"，不编造价格                                                        |
| `row add` 部分成功                                    | 向用户报告成功/失败明细，不吞掉失败行；用户确认后可对失败行重试或跳过                                                                     |
| 折扣计算脚本返回 `success: false`                     | 按 `references/how-to-make-discount-plan.md` 的"计算失败处理"表引导用户调整                                                               |
| 用户中途变更需求（如 Phase 3 进行中要求换产品）       | 回退到受影响的最早 Phase 重新执行，不在当前 Phase 上打补丁                                                                                |
| 任何 CLI 命令返回 `success: false` 或非零退出         | 如实向用户报告错误原文和影响范围，给出可操作的下一步建议。**禁止**编造成功输出或虚假交付物（§全局禁令第 10 条）                           |

## 辅助 Reference 索引

以下 reference 文件不在主路由表中，但在对应子流程内被引用：

| 文件                                               | 用途                                                                  | 被引用处                                                          |
| -------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `references/cpq-session-dir.md`                    | `<CPQ_SESSION_DIR>` 完整契约（跨平台 / 命名 / 调试 / 故障排查）       | 主 SKILL.md §会话目录、所有段 ref                                 |
| `references/how-to-query-four-layer.md`            | 查四层编码（≠询价）：tcloud 优先 / inquiry 兜底，复用 / `未找到` 短路 | C 选品搜索失败兜底、D 反哺四层                                    |
| `references/constants.md`                          | CLI 常量定义（分页大小、字段列表等）                                  | `cpq-cli.md` 内部引用                                             |
| `references/discount-strategy.md`                  | 折扣策略到参数映射、输入 JSON 规范                                    | `how-to-make-discount-plan.md` 引用（E）                          |
| `references/winback-strategy.md`                   | Winback 双策略（性能对等/成本优先）定义                               | `winback.md` 引用（B）                                            |
| `references/how-to-identify-companion-products.md` | 伴生产品拆分规则（磁盘/带宽→独立 SPU）                                | `winback.md`（B）、A 解析引用                                     |
| `references/how-to-export-excel.md`                | 面客 Excel 交付物格式契约（列结构 / 表头 / 工作表命名等）             | §附件处理能力、`how-to-select-product.md`（C）、`winback.md`（B） |
