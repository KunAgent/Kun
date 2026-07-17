# 指标总索引（多视角检索）

> 一站式入口：按 4 个维度（**类型 / 业务过程 / 数据源 / 卡片视图**）检索指标定义。
> 治理框架说明见 [`README.md`](./README.md)。
>
> 🆕 **运行时筛选参数（v3.0 简化为 9 个）**：见 [`dimensions/recruit-social/filter-parameters.md`](./dimensions/recruit-social/filter-parameters.md)。

---

## 🔄 v3.0 升级摘要（2026-06-08，对齐 治理基线 新版）

### 指标变更（44 个总数不变，但内容有调整）

| 类型 | 数量 | 详情 |
| --- | --- | --- |
| 🆕 **新增指标** | 2 | `recruit-flow-total-count`（社招流程中总人数，含简历评估）；`recruit-channel-resume-not-assessed-cnt`（渠道收到简历未评估数） |
| 🚫 **废弃指标** | 2 | `recruit-offer-approval-cnt`（offer审批中人数）；`recruit-offer-approval-rate`（进入offer审批率）—— SQL 仍保留兼容历史 |
| ✏️ **改名（加"社招"前缀）** | 4 | "在招需求数"→"社招在招需求数"；"总需求数"→"社招总需求数"；"已完成需求数入职"→"社招已完成需求数入职"；"已完成需求数offer"→"社招已完成需求数offer"。指标 ID 保持不变（向后兼容） |

### 口径变更（影响 SQL 模板）

| 项 | v2.x | v3.0 |
| --- | --- | --- |
| 聚合方式 | `SUM(CASE WHEN ... THEN 1 ELSE 0 END)`（人次） | **`COUNT(DISTINCT CASE WHEN ... THEN flow_main_id END)`**（按流程主键去重） |
| 是否标志位 | `is_xxx = 1` | **`is_xxx = '是'`**（中文枚举） |
| 国家筛选 | 固定 `WHERE location_country_name LIKE '%中国%'` | **动态参数**（默认 `'%中国%'`，可切换） |
| 管理主体筛选 | `manager_unit_id = '10101'`（数字 ID） | **`manager_unit_name_cn = '腾讯集团本部'`**（中文名） |
| `is_disabled` | 🔴 WHERE 拦截 bug；只能 CASE 内处理 | **`is_disabled_name = '在招'`** ✅ WHERE 安全 |
| 简历评估时间 | `flow_end_time` / `process_time` | **`arrive_time`**（更精准） |
| 时点占位符 | `:next_date`（独立占位符） | 直接用 `DATE_ADD(:end_date, INTERVAL 1 DAY)` 表达式 |

### 参数变更

| v2.x（12 个） | v3.0（9 个） | 变化 |
| --- | --- | --- |
| `:begin_date` | `:begin_date` | ✅ |
| `:end_date` | `:end_date` | ✅ |
| `:next_date` | — | 🚫 删（用表达式替代） |
| `:manager_unit_id` | `:manager_unit_name_cn` | ✏️ 改用中文名 |
| `:org_full_name` | `:recruit_post_org_full_name` / `:recruit_post_belong_org_full_name` | ✏️ 区分流程表/岗位表 |
| `:post_id` | `:post_id` | ✅ |
| `:post_name_cn` | `:post_name_cn` | ✅ |
| `:recruit_owner_id` | `:recruit_owner` | ✏️ 改用姓名 |
| `:channel_id` | — | 🚫 删（治理基线 新版未列） |
| `:work_location_id` | — | 🚫 删（治理基线 新版未列） |
| `:mapping_position_id` | `:mapping_position_name` | ✏️ 改用中文名 |
| `:is_disabled` | `:is_disabled_name` | ✏️ 改用中文枚举（且 v3.0 起 WHERE 安全） |
| — | `:location_country_name` | 🆕 国家从固定→动态 |

---

## 🗂️ 视图 1：按指标类型分

| 类型 | v2.x | v3.0 | 入口 |
| --- | --- | --- | --- |
| 🟢 **原子指标 atomic/** | 25 | **25**（含 +1 新增 `recruit-channel-resume-not-assessed-cnt`、−1 废弃 `recruit-offer-approval-cnt`） | [`atomic/_README.md`](./atomic/_README.md) |
| 🟠 **复合指标 composite/** | 11 | **10**（−1 废弃 `recruit-offer-approval-rate`） | [`composite/_README.md`](./composite/_README.md) |
| 🟣 **派生指标 derived/** | 8 | **9**（+1 新增 `recruit-flow-total-count`） | [`derived/_README.md`](./derived/_README.md) |

> 合计 **44 项**（v3.0 仍为 44，与 治理基线 新版严格一一对应；废弃的 2 项保留卡片以兼容历史看板）。

---

## 🎯 视图 2：按业务过程分（招聘漏斗节点导览）

```
简历评估 → 发起面试 → 部门内 → 通道面委 → 用人决策 → HR 资格 → 薪资谈判 → Offer 审批 → 发送 Offer → 入职
   ↓                                                                                                ↓
渠道收到评估                                                                                  拒 Offer / Turndown
```

| 业务节点 | 原子指标 | 复合指标 | 派生指标 |
| --- | --- | --- | --- |
| **需求与岗位** | — | `recruit-total-post-count`、`recruit-avg-recruit-days` | `recruit-on-going-post-count`、`recruit-finish-post-onboard-cnt`、`recruit-finish-post-offer-cnt` |
| **简历评估** | `recruit-channel-resume-assess-cnt`、`recruit-resume-assess-intv-cnt` | `recruit-channel-start-interview-rate` | — |
| **发起面试** | `recruit-start-intv-cnt` | — | — |
| **部门内专业面试** | `recruit-dept-professional-intv-cnt`、`recruit-start-dept-professional-intv-cnt`、`recruit-start-dept-professional-intv-no-submit-cnt` | `recruit-dept-professional-intv-rate` | — |
| **通道面委面试** | `recruit-cf-intv-cnt`、`recruit-start-cf-intv-cnt`、`recruit-start-cf-intv-no-submit-cnt` | `recruit-cf-intv-rate` | — |
| **用人决策面试** | `recruit-dm-intv-cnt`、`recruit-start-dm-intv-cnt`、`recruit-start-dm-intv-no-submit-cnt` | `recruit-dm-intv-rate` | — |
| **HR 资格面试** | `recruit-hr-intv-cnt`、`recruit-start-hr-intv-cnt`、`recruit-start-hr-intv-no-submit-cnt` | `recruit-hr-intv-rate` | — |
| **HR 薪资谈判** | `recruit-hr-salary-negotiation-pass-cnt`、`recruit-start-hr-salary-negotiation-cnt`、`recruit-start-hr-salary-negotiation-no-submit-cnt` | `recruit-hr-salary-negotiation-rate` | — |
| **Offer 审批** | `recruit-offer-approval-cnt`、`recruit-start-offer-approval-cnt`、`recruit-offer-approval-no-submit-cnt` | `recruit-offer-approval-rate` | — |
| **发送 Offer** | `recruit-send-offer-cnt` | `recruit-send-offer-rate` | — |
| **入职** | `recruit-entry-cnt` | `recruit-entry-rate` | — |
| **流程状态快照** | — | — | `recruit-flow-active-count`、`recruit-flow-evaluating-count`、`recruit-flow-interviewing-count`、`recruit-flow-offer-stage-count`、`recruit-flow-onboarding-count` |
| **放弃/拒绝** | `recruit-turndown-cnt`、`recruit-offer-giveup-cnt` | — | — |

---

## 🗃️ 视图 3：按数据源分

| 数据源 | 短码 | 完整路径 | 指标数量 |
| --- | --- | --- | --- |
| 招聘流程主表 | `T_FLOW` | `catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail` | 30+ |
| 招聘岗位维表 | `T_POST` | `catalog_dos_da_mcp.hrdw.Report_Position_Management_Recruitment_P_I_Daily_Slice` | 2（独立）+ 多个 JOIN 用 |
| 简历评估宽表 | `T_ASSESS` | `catalog_dos_da_mcp.hrdw.Report_Recruit_Resume_Assessment` | 2 |

JOIN 关系：
- `T_FLOW.post_id = T_POST.recruit_post_id`
- `T_FLOW.resume_assess_flow_main_id = T_ASSESS.flow_main_id`

---

## 📺 视图 4：按卡片（前端展示位置）— 仅供前端开发参考

> ⚠️ 卡片是**展示视角**，不是治理结构。指标本身仍然由 atomic/composite/derived 三层管理。

| 卡片 | 包含项 | 拼装样例 |
| --- | --- | --- |
| **A 卡片**：需求与漏斗概览 | A1-A12（12 项） | [`recipes/recruit-social/card-A-demand-overview.md`](./recipes/recruit-social/card-A-demand-overview.md) |
| **B 卡片**：环节通过/进度数量 | B1-B11（11 项） | [`recipes/recruit-social/card-B-funnel-counts.md`](./recipes/recruit-social/card-B-funnel-counts.md) |
| **C 卡片**：漏斗通过率 | C1-C9（9 项） | [`recipes/recruit-social/card-C-funnel-rates.md`](./recipes/recruit-social/card-C-funnel-rates.md) |
| **D 卡片**：辅助指标 | D1-D12（12 项） | [`recipes/recruit-social/card-D-helper.md`](./recipes/recruit-social/card-D-helper.md) |

---

## 🔍 视图 5：指标 ID 速查表（按字母序）

| 指标 ID | 中文名 | 类型 | 文件 |
| --- | --- | --- | --- |
| `recruit-avg-recruit-days` | 社招平均招聘天数 | composite | [link](./composite/recruit-social/avg-recruit-days.md) |
| `recruit-cf-intv-cnt` | 通道面委面试通过数 | atomic | [link](./atomic/recruit-social/interview-count.md) |
| `recruit-cf-intv-rate` | 通道面委面试通过率 | composite | [link](./composite/recruit-social/funnel-rates.md) |
| `recruit-channel-resume-assess-cnt` | 渠道收到评估数（别名「渠道收到简历数」） | atomic | [link](./atomic/recruit-social/resume-assess-count.md) |
| `recruit-channel-resume-not-assessed-cnt` 🆕 | **渠道收到简历未评估数**（v3.0 新增） | atomic | [link](./atomic/recruit-social/resume-assess-count.md) |
| `recruit-channel-start-interview-rate` | 渠道发起面试率 | composite | [link](./composite/recruit-social/funnel-rates.md) |
| `recruit-dept-professional-intv-cnt` | 部门内专业面试通过数 | atomic | [link](./atomic/recruit-social/interview-count.md) |
| `recruit-dept-professional-intv-rate` | 部门内面试通过率 | composite | [link](./composite/recruit-social/funnel-rates.md) |
| `recruit-dm-intv-cnt` | 用人决策面试通过数 | atomic | [link](./atomic/recruit-social/interview-count.md) |
| `recruit-dm-intv-rate` | 用人决策面试通过率 | composite | [link](./composite/recruit-social/funnel-rates.md) |
| `recruit-entry-cnt` | 入职数 | atomic | [link](./atomic/recruit-social/entry-count.md) |
| `recruit-entry-rate` | 入职率 | composite | [link](./composite/recruit-social/funnel-rates.md) |
| `recruit-finish-post-offer-cnt` | 已完成需求数（offer）｜v3.0：**社招已完成需求数offer** | derived | [link](./derived/recruit-social/finished-demand.md) |
| `recruit-finish-post-onboard-cnt` | 已完成需求数（入职）｜v3.0：**社招已完成需求数入职** | derived | [link](./derived/recruit-social/finished-demand.md) |
| `recruit-flow-active-count` | 社招流程中总人数（除简历评估） | derived | [link](./derived/recruit-social/snapshot-stages.md) |
| `recruit-flow-total-count` 🆕 | **社招流程中总人数**（v3.0 新增，含简历评估） | derived | [link](./derived/recruit-social/snapshot-stages.md) |
| `recruit-flow-evaluating-count` | 评估中 | derived | [link](./derived/recruit-social/snapshot-stages.md) |
| `recruit-flow-interviewing-count` | 面试中 | derived | [link](./derived/recruit-social/snapshot-stages.md) |
| `recruit-flow-offer-stage-count` | offer 中 | derived | [link](./derived/recruit-social/snapshot-stages.md) |
| `recruit-flow-onboarding-count` | 入职中/调动中 | derived | [link](./derived/recruit-social/snapshot-stages.md) |
| `recruit-hr-intv-cnt` | HR 资格面试通过数 | atomic | [link](./atomic/recruit-social/interview-count.md) |
| `recruit-hr-intv-rate` | HR 资格面试通过率 | composite | [link](./composite/recruit-social/funnel-rates.md) |
| `recruit-hr-salary-negotiation-pass-cnt` | 薪资谈判通过数 | atomic | [link](./atomic/recruit-social/salary-negotiation-count.md) |
| `recruit-hr-salary-negotiation-rate` | HR 薪资谈判通过率 | composite | [link](./composite/recruit-social/funnel-rates.md) |
| `recruit-offer-approval-cnt` 🚫 | ~~offer 审批中人数~~（**v3.0 已废弃**） | atomic | [link](./atomic/recruit-social/offer-count.md) |
| `recruit-offer-approval-no-submit-cnt` | offer 审批中未审批人数 | atomic | [link](./atomic/recruit-social/offer-count.md) |
| `recruit-offer-approval-rate` 🚫 | ~~进入 offer 审批率~~（**v3.0 已废弃**） | composite | [link](./composite/recruit-social/funnel-rates.md) |
| `recruit-offer-giveup-cnt` | 拒绝 offer | atomic | [link](./atomic/recruit-social/giveup-count.md) |
| `recruit-on-going-post-count` | 在招需求数｜v3.0：**社招在招需求数** | derived | [link](./derived/recruit-social/on-going-post.md) |
| `recruit-resume-assess-intv-cnt` | 有简历评估面试数 | atomic | [link](./atomic/recruit-social/resume-assess-count.md) |
| `recruit-send-offer-cnt` | 发送 offer 数 | atomic | [link](./atomic/recruit-social/offer-count.md) |
| `recruit-send-offer-rate` | 发送 offer 率 | composite | [link](./composite/recruit-social/funnel-rates.md) |
| `recruit-start-cf-intv-cnt` | 发起通道面委面试数 | atomic | [link](./atomic/recruit-social/interview-count.md) |
| `recruit-start-cf-intv-no-submit-cnt` | 发起通道面委面试未提交数 | atomic | [link](./atomic/recruit-social/interview-count.md) |
| `recruit-start-dept-professional-intv-cnt` | 发起部门内专业面试数 | atomic | [link](./atomic/recruit-social/interview-count.md) |
| `recruit-start-dept-professional-intv-no-submit-cnt` | 发起部门内专业面试未提交数 | atomic | [link](./atomic/recruit-social/interview-count.md) |
| `recruit-start-dm-intv-cnt` | 发起用人决策面试数 | atomic | [link](./atomic/recruit-social/interview-count.md) |
| `recruit-start-dm-intv-no-submit-cnt` | 发起用人决策面试未提交数 | atomic | [link](./atomic/recruit-social/interview-count.md) |
| `recruit-start-hr-intv-cnt` | 发起 HR 资格面试数 | atomic | [link](./atomic/recruit-social/interview-count.md) |
| `recruit-start-hr-intv-no-submit-cnt` | 发起 HR 资格面试未提交数 | atomic | [link](./atomic/recruit-social/interview-count.md) |
| `recruit-start-hr-salary-negotiation-cnt` | 发起薪资谈判数 | atomic | [link](./atomic/recruit-social/salary-negotiation-count.md) |
| `recruit-start-hr-salary-negotiation-no-submit-cnt` | 发起薪资谈判未提交数 | atomic | [link](./atomic/recruit-social/salary-negotiation-count.md) |
| `recruit-start-intv-cnt` | 发起面试数 | atomic | [link](./atomic/recruit-social/interview-count.md) |
| `recruit-start-offer-approval-cnt` | 发起 offer 审批人数 | atomic | [link](./atomic/recruit-social/offer-count.md) |
| `recruit-total-post-count` | 总需求数｜v3.0：**社招总需求数** | composite | [link](./composite/recruit-social/total-demand.md) |
| `recruit-turndown-cnt` | 口头 turndown | atomic | [link](./atomic/recruit-social/giveup-count.md) |

> 共 44 条，与 治理基线 44 项严格 1:1 对应。

---

## 🔗 历史归档

按 A/B/C/D 卡片组织的旧文档已归档至：[`recruit-social/_legacy/indicators-recruit-social-by-card.md`](./recruit-social/_legacy/indicators-recruit-social-by-card.md)。
仅供 治理基线比对、信息无丢失审计使用。

---

## 📅 维护记录

| 日期 | 变更 | 操作人 |
| --- | --- | --- |
| 2026-06-07 | v1：按 A/B/C/D 卡片分组建立 indicators-recruit-social.md（44 项） | hr-ai-data agent |
| 2026-06-07 | v2：重构为治理框架（atomic 25 + composite 11 + derived 8 + dimensions + recipes） | hr-ai-data agent |
| 2026-06-07 | v2.1 纠偏：删除虚构的 `recruit-post-person-count`、`recruit-post-offer-pending-cnt`（这两个 ID 在 治理基线中不存在，是治理重构时被错误"补全"的）；同时修订 `on-going-post.md` 的 `is_disabled` WHERE 拦截 bug | hr-ai-data agent |
| 2026-06-08 | **v2.2 加固：把 治理基线 第 7 列「动态查询条件（默认值）」补到指标治理**——新建 `dimensions/recruit-social/filter-parameters.md`（11 个参数），剔除 2 个权限类参数，所有 atomic/composite/derived 指标卡顶部 banner 增加「支持的运行时筛选参数」字段，4 张 recipes 注入完整条件性 AND 拼接模板 | hr-ai-data agent |
| 2026-06-08 | **🚀 v3.0 大版本升级（对齐 治理基线 新版）**：①口径变化：聚合 `SUM(CASE)` → `COUNT(DISTINCT flow_main_id)`；②参数从 12→9 个，全部字段名验证通过；③新增 2 指标（社招流程中总人数、渠道收到简历未评估数）；④废弃 2 指标（offer审批中人数、进入offer审批率）；⑤改名 4 指标加"社招"前缀；⑥国家从固定→动态参数；⑦`is_disabled_name` v3.0 起所有指标都可用且 WHERE 安全；⑧管理主体改用 `manager_unit_name_cn`（中文名）。详见本文件顶部 v3.0 升级摘要 | hr-ai-data agent |

---

## 🔒 治理纪律（v2.1 沉淀）

**核心铁律：只搬运业务方已定义的指标，不创造、不拆分、不合并。**

| 行为 | 是否允许 |
| --- | --- |
| 把指标按 atomic/composite/derived 重新组织 | ✅ 允许（纯治理结构） |
| 给指标补元数据（业务过程/同义词/血缘 ID） | ✅ 允许（只要是事实） |
| 把派生指标的"字段组件"独立为原子指标 | ❌ **禁止**（这是 v2.1 纠偏的核心错误） |
| 把"指标 A + 指标 B"合并为新指标 C | ❌ 禁止（除非业务方明确定义了 C） |
| 给原档没有的指标命名/创建指标卡 | ❌ 禁止（属于幻觉污染） |

**违反纪律的代价**：上一轮我创造了 `recruit-post-person-count` 和 `recruit-post-offer-pending-cnt`，导致用户提出"我的原始文档里没有这个指标"——这是**指标知识库被 AI 污染**的典型场景。

---

## 已收集完整口径（其他专题）

详见 [`indicators.md`](./indicators.md)：
- 在职人数、HC、管理者、流入流出、离职率、校招漏斗等 22 个核心指标


---

## 🎯 v3.1 消歧规则（2026-06-09）

### 「流程中」的默认指向

用户提问中出现"流程中"、"还在流程里"、"在跑的"等模糊表述时，skill **默认指向**：

| 用户问法 | 默认指标 ID | 中文名 | 业务含义 |
| --- | --- | --- | --- |
| "流程中" / "进行中" / "社招流程中总人数" | `recruit-flow-total-count` | 社招流程中总人数 | **包含简历评估**在内的所有未完结流程 |
| "面试中（不含评估）" / "已开始面试" | `recruit-flow-no-assess-count` | 社招流程中（不含简历评估） | 显式排除简历评估阶段 |

**消歧策略**：
- 若用户问题里**有**"评估"、"含评估"等明示词 → 命中"含评估"那一个
- 若用户问题里**有**"不含评估"、"除评估"、"已开始面试"等否定词 → 命中"不含评估"那一个
- 其他情况 → 默认"包含评估"（覆盖面广，业务通用习惯）

---
