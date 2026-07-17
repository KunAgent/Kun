# A 段：上下文准备（context.md）

> **定位**：本文档是 **A 段（上下文准备）** 的**入口与编排说明**，是所有 CPQ 任务的**唯一入口**与**唯一会话目录分配者**。A 永远**内联**在主 agent 里跑，产出两份文件：
>
> - `context.md` —— 本任务的"身份证 + 路线"：site / 业务意图 / `exec_mode` / run_C·run_D·顺序 / spuid·四层分布。**本文档负责这份**。
> - `phase1.md` —— 解析展开后的产品清单。解析算法（A4）详见 [how-to-parse-product-list.md](./how-to-parse-product-list.md)。
>
> A 完成后主流程读 `context.md` 决定派发 B/C/D；B/C/D 只读 A 的产物即可独立执行，**无需回读本文细节**。

---

## A 段总览（先产 context.md，再解析 phase1.md）

| 步骤 | 内容                                                                                 | 产物 / 字段                                                               |
| ---- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| A0   | 任务边界（新任务 vs 局部更新）+ 解析会话目录                                         | `node scripts/resolve-session-dir.mjs` 拿带随机后缀的 `<CPQ_SESSION_DIR>` |
| A1   | 锁定 site（cn / intl，默认 cn）                                                      | `context.md` 的 site + `phase1.md` 首行 `<!-- site: ... -->`              |
| A2   | 业务意图 → 路线（run_C? run_D? 顺序）                                                | `context.md`：intent / run_c / run_d / order                              |
| A2.5 | **exec_mode 检测**（能否 spawn 子 agent）                                            | `context.md`：`exec_mode=subagent\|main`                                  |
| A3   | 信息完备性检查（按意图查必需输入，缺则追问）                                         | —                                                                         |
| A4   | 解析 + 拆表格（详见 [how-to-parse-product-list.md](./how-to-parse-product-list.md)） | `phase1.md` 数据表                                                        |
| A5   | 每行 SPUID 检测（沉淀值 + 汇总 coverage）                                            | `phase1.md` 的 `SPUID` 列 + `context.md` 的 spuid_coverage                |
| A6   | 四层信息可用性标注                                                                   | `phase1.md` 的 `四层编码` 列 + `context.md` 的 four_layer_available       |
| A7   | 路线落盘 → `context.md`                                                              | 见下方 schema                                                             |
| A8   | gate：`check-context.mjs` + `check-phase1.mjs` 均 exit 0                             | —                                                                         |

> A0 任务边界（新任务 vs 局部更新）的判定信号：用户**给了新清单 / 附件 / 切换 site / 明说"新建另一单"** → 新任务，铸新会话目录；**没给新清单、只文字增删改当前清单**（"再加""改成""去掉""第 3 行换…"）→ 局部更新，复用当前 `<CPQ_SESSION_DIR>` 并走增量更新。会话目录解析（含 `<ts>-<rand4>` 随机后缀）见 [cpq-session-dir.md](./cpq-session-dir.md)。

### exec_mode 检测（A2.5 · 并发能力自检）

A 在此自检**当前环境能否 spawn 子 agent**，写入 `context.md` 的 `exec_mode`：

- `subagent` → 环境支持 spawn，主 agent 可把 B/C/D 作为独立子 agent **并发 / 隔离**派发；
- `main` → 不支持（或不确定），B/C/D **内联顺序**执行（退化路径，I/O 契约不变）。
- **不确定保守置 `main`**（内联永远可用）。`exec_mode` 是 `check-context.mjs` 的**必填**字段，缺失即 gate 失败。
- exec_mode 只影响**派发方式**，不影响 B/C/D 的输入 / 产物 / gate 契约。

### context.md schema（A7 产物 · Markdown + HTML 注释门控）

```markdown
<!-- context: cn version=1 -->

# CPQ 任务上下文

## 摘要

- **本阶段做了什么**：解析清单（N 行）、锁定 site、识别意图、检测 spuid/四层分布、检测 exec_mode
- **关键判断 / 分叉结论**：site=cn；意图=只询价不落单；spuid 部分覆盖；无自带四层；无友商行
- **给主 agent 的路由建议**：run_D=yes / run_C=no；competitor=0 → 可跳过 B；建议直接派 D
- **给下游 subagent 的用法**：D 读 phase1.md 数据行做 spuid 分叉
- **异常 / 留空 / 失败行**：无

| 字段                 | 值                                 |
| -------------------- | ---------------------------------- |
| site                 | cn                                 |
| 业务意图             | 询价（不落单）                     |
| run_C                | no                                 |
| run_D                | yes                                |
| 执行顺序             | D                                  |
| exec_mode            | main                               |
| spuid_coverage       | partial                            |
| four_layer_available | no                                 |
| 会话目录             | /abs/.cpq-tmp/20260621-103500-a3f9 |

<!-- context-done:
  site=cn intent=inquiry
  run_c=no run_d=yes order=D exec_mode=main
  spuid_coverage=partial four_layer_available=no
  session_dir=/abs/.cpq-tmp/20260621-103500-a3f9
-->
```

> `context-done` 的**必填字段**：`site` / `intent` / `run_c` / `run_d` / `order` / `exec_mode` / `session_dir`（缺任一 → `check-context.mjs` 失败）。摘要段五要点同样被 gate 校验。无友商行时还须标 `b_status=skipped(no_competitor)`（供 D 前导 gate 判定 B 已明确跳过）。

### A 段 gate

```bash
node scripts/check-context.mjs --session-dir <CPQ_SESSION_DIR>
node scripts/check-phase1.mjs  --session-dir <CPQ_SESSION_DIR>
# 两者 exit 0 → A 完成，主流程按 context.md 路线派发 B / C / D
```

---

## 出口（交还主流程）

A 完成后在对话里告诉主流程：

- 会话目录绝对路径（= 本任务标识）+ `context.md` / `phase1.md` 路径
- 当前 `site` 取值（`cn` / `intl`）+ 业务意图 / 路线（run_C / run_D / 顺序）+ `exec_mode`
- 总条目数 / 腾讯云条目数 / 友商条目数（来自 `phase1-done`）+ spuid 覆盖 / 四层可用性

主流程据此派发（按 `order` 决定 C/D 先后）：

- **存在友商条目（competitor>0）** → 先走 B（[winback.md](./winback.md)，Phase 2），委托对象按 site 分叉：
  - `site=cn` → 委托 `cloud-mapping`，其输出的"我方对标产品"再走 Phase 2.5 主体规范化
  - `site=intl` → 委托 `cloud-mapping-intl`，其输出送入 Phase 2.5 字段透传分支（仍产出 `phase2_5.md`，不调用规范化脚本）
- **`run_C`（要落 CPQ 报价单 / 选品）** → C（[how-to-select-product.md](./how-to-select-product.md)）：Phase 2.5 规范化（cn 调脚本 / intl 字段透传）→ Phase 2.6 选品意图识别（两种 site 都强制，不可跳过）→ Phase 3 起。
- **`run_D`（询价 / 估价 / 补价）** → D（[how-to-query-pricing.md](./how-to-query-pricing.md)）：按行 spuid 分叉走两漏斗，可独立于 C 执行。

无友商行（competitor=0）时主流程可直接跳过 B 派发 C/D。
