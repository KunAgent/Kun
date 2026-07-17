# 售卖模式别名词典（BILLING alias）

> **定位**：把**友商措辞 / 业内通用说法**归一到**腾讯云官方售卖模式术语**。Phase 1 阶段 A.1 列级语义分类把列归到 BILLING 类后，逐 token 查本词典；命中即归一替换，未命中走 [`how-to-resolve-phase1-ambiguity.md`](../../how-to-resolve-phase1-ambiguity.md) §A.1 追问。
>
> **加载顺序**：在 [`how-to-classify-tokens.md`](../../how-to-classify-tokens.md) Step 3 词典查找之**前**先做一次 BILLING 别名归一（因为 BILLING token 已在 A.1 列级阶段被识别 / 隔离到 `售卖模式` 列，不进 A.2 的 SPEC/CONSTRAINT 词典查找流程，所以本词典专门服务于 `售卖模式` 列）。
>
> **加载条件**：当 phase1.md 的 `售卖模式` 列即将填值时，必须先把候选值在本词典做一次别名归一。
>
> **核心原则**：腾讯云官方售卖模式术语只有 6 种 → `prepay`（预付费/包年包月）/ `postpay`（后付费/按量计费）/ `underwritepay`（包销）/ `spotpay`（竞价）/ `reservedpay`（预留实例 RI）/ `savingsplan`（节省计划 SP）。任何在本词典外的值进入 `售卖模式` 列都属于违规，应进追问。

---

## 友商 / 通用措辞 → 腾讯云术语映射表

| 别名 token（原文）    | 归一为（腾讯云术语） | 对应 payMode  | 适用 site | 备注 / 来源                                       |
| --------------------- | -------------------- | ------------- | --------- | ------------------------------------------------- |
| 按需                  | 按量计费             | postpay       | cn,intl   | 阿里云 / AWS 通用措辞                             |
| 按需付费              | 按量计费             | postpay       | cn,intl   | 同上                                              |
| 按使用量计费          | 按量计费             | postpay       | cn,intl   | 阿里云                                            |
| on-demand             | 按量计费             | postpay       | intl      | AWS 标准术语                                      |
| On-Demand             | 按量计费             | postpay       | intl      | AWS 标准术语（首字母大写）                        |
| OnDemand              | 按量计费             | postpay       | intl      | 紧凑写法                                          |
| pay-as-you-go         | 按量计费             | postpay       | cn,intl   | GCP / Azure                                       |
| Pay-As-You-Go         | 按量计费             | postpay       | cn,intl   | 同上                                              |
| PAYG                  | 按量计费             | postpay       | intl      | Azure 缩写                                        |
| 预付费                | 预付费               | prepay        | cn,intl   | 腾讯云原生（保留）                                |
| 包年包月              | 包年包月             | prepay        | cn,intl   | 腾讯云原生（保留）                                |
| 包年                  | 包年包月             | prepay        | cn,intl   | 简写                                              |
| 包月                  | 包年包月             | prepay        | cn,intl   | 简写                                              |
| 后付费                | 后付费               | postpay       | cn,intl   | 腾讯云原生（保留）                                |
| 按量计费              | 按量计费             | postpay       | cn,intl   | 腾讯云原生（保留）                                |
| 按量                  | 按量计费             | postpay       | cn,intl   | 简写（保留）                                      |
| 包销                  | 包销                 | underwritepay | cn,intl   | 腾讯云原生（保留）                                |
| 竞价                  | 竞价                 | spotpay       | cn,intl   | 腾讯云原生（保留）                                |
| 竞价实例              | 竞价                 | spotpay       | cn,intl   | 腾讯云原生（保留）                                |
| Spot                  | 竞价                 | spotpay       | intl      | AWS 标准术语                                      |
| Spot Instance         | 竞价                 | spotpay       | intl      | AWS 全称                                          |
| 抢占式                | 竞价                 | spotpay       | cn,intl   | 阿里云 / GCP 措辞                                 |
| 抢占式实例            | 竞价                 | spotpay       | cn,intl   | 阿里云全称                                        |
| Preemptible           | 竞价                 | spotpay       | intl      | GCP 术语                                          |
| 预留                  | 预留实例             | reservedpay   | cn,intl   | 腾讯云原生（保留）                                |
| 容量预留              | 预留实例             | reservedpay   | cn,intl   | 腾讯云原生（保留）                                |
| 预留实例              | 预留实例             | reservedpay   | cn,intl   | 腾讯云原生（保留）                                |
| RI                    | 预留实例             | reservedpay   | cn,intl   | AWS 缩写（注意：与"独享"不冲突，看上下文）        |
| Reserved Instance     | 预留实例             | reservedpay   | intl      | AWS 全称                                          |
| Reserved              | 预留实例             | reservedpay   | intl      | 简写                                              |
| 节省计划              | 节省计划             | savingsplan   | cn,intl   | 腾讯云原生（保留）                                |
| SP                    | 节省计划             | savingsplan   | cn,intl   | AWS 缩写（注意：避免与"系统盘 SP"冲突，看上下文） |
| Savings Plan          | 节省计划             | savingsplan   | intl      | AWS 全称                                          |
| Savings Plans         | 节省计划             | savingsplan   | intl      | AWS 复数形式                                      |
| Compute Savings Plans | 节省计划             | savingsplan   | intl      | AWS 子类                                          |

---

## 易混淆与例外

### 1. "RI" 的歧义

`RI` 在云行业里通常指 Reserved Instance（预留实例）。但腾讯云硬件规格里偶尔出现 `RI` 后缀（极罕见），如果在 BILLING 列上下文出现 `RI`，归为 `预留实例`；在 SPEC 列上下文出现 `RI` 应进 UNCLASSIFIED 追问。

### 2. "SP" 的歧义

`SP` 在 BILLING 列上下文 = 节省计划（Savings Plans）。但在云硬盘 SPEC 上下文 `SP` 可能是磁盘类型缩写。**A.1 列级分类已经隔离**：本词典只服务于 `售卖模式` 列，不会在 SPEC 列被误用。

### 3. "Preemptible" / "抢占式" 的归一

腾讯云没有完全等价的 SKU，但语义最接近 `spotpay`（竞价）。归一后 Phase 4 询价时如果实际需要更精确语义，由用户在阶段 D 追问中确认。

### 4. ❌ 严禁 "承诺三年" → "包销 3年" 这类语义跳跃

> **历史违规模式**（2026-06-18 现网命中）：源 Excel 「承诺使用周期」列原值是「三年」，AI 凭"招标 / 承诺 / 长期"语义联想成「包销 3年」并自填 ambiguity_resolved=yes，但用户从未确认。

- 「三年」/ 「1 年」/ 「时长」类纯时间值 = **承诺周期（QUANTITY 时间维度）**，**不是 BILLING token**
- 即便上下文有"招标"、"长期合作"、"框架协议"等线索，也**不允许**自动归一为 `包销` / `预留实例` / `包年包月`
- 必须按 [`how-to-resolve-phase1-ambiguity.md`](../../how-to-resolve-phase1-ambiguity.md) §A.1 追问 4 个候选（包年包月 / RI / SP / 包销）
- gate 兜底：当售卖模式列出现的值**字符级不属于本词典 + 触发词列表**时（如"包销 3年"这种合成形态），可以视为 fail（v3 待补强校验）

---

## 维护规则

- ✅ Append-only：新增条目，不改老条目
- ✅ 新别名先入词典再补 SKILL（与其他词典一致）
- ✅ 启用条目 `启用` 字段缺省即 `yes`，停用切到 `no` 但保留历史
- ❌ 禁止 AI 自行新增条目（即使语义合理也必须由 SA / PM 走 issue 提议）
- ❌ 禁止把"承诺周期"类时间词写入本词典

完整治理流程见 [`token-dict-schema.md`](../../../../../../../docs/cpq/phase1-refactor/token-dict-schema.md) §四。
