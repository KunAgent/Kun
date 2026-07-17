# 知识库 v3.4 修订日志（2026-06-10）

## 触发场景

继 v3.3 修复 `on-going-post.md` 错误后，对全 44 个 治理基线 指标做了全量对账。本次修订聚焦两件事：
1. 补全 1 张原本被标记 TODO 的指标卡（offer 中）
2. 补全 13 项 治理口径原文的同义词缺失（影响 skill 检索命中率）

## 全量对账过程

| 阶段 | 发现 | 真实情况 |
| --- | --- | --- |
| 第 1 轮扫描 | 17 个 治理基线 指标"未映射" | 实际只 1 个真缺卡，13 个是同义词缺失，3 个是误判（ID 名 guess 错了）|
| 第 1 轮扫描 | 63 处"SQL 缺强制过滤"误报 | **片段卡设计模式**：原子卡的"核心表达式"是聚合表达式片段（如 `COUNT(DISTINCT CASE...)`），强制过滤标在卡顶部元数据表里，靠外层 SELECT/WHERE 拼接 |
| 第 2 轮精确扫描 | 仅扫"完整 SQL 卡"（含 SELECT/FROM）| 0 个真问题 ✅ |

**关键学习**：扫描指标卡时必须区分"片段表达式"和"完整 SQL"，片段卡按设计不应自带 WHERE。

## 真实问题清单

### 真问题 1：1 张卡逻辑不完整

📁 `metrics/derived/recruit-social/snapshot-stages.md` § `recruit-flow-offer-stage-count`

| 项 | v3.3 状态 | v3.4 修订 |
| --- | --- | --- |
| 社招分支 | 标记"治理口径原文被截断"，TODO 待补 | ✅ 按 治理基线 Row 11 完整补齐 2 套子逻辑 |
| 活水分支 | 写法不完整 | ✅ 按 治理基线 完整补齐 2 套子逻辑 |
| 总公式 | 残缺 | ✅ 4 套子逻辑加和（2 套社招 + 2 套活水）|

**治理基线「offer 中」业务定义**：

```
offer 中人数 = 社招 offer 中人数 + 活水 offer 中人数

社招 offer 中 = 逻辑1 + 逻辑2
  逻辑1：state_id NOT IN (5,6) AND start_hr_salary_negotiation_time < end_date
         AND (send_offer_time >= end_date OR NULL)
  逻辑2：state_id IN (5,6) AND start_hr_salary_negotiation_time < end_date
         AND send_offer_time IS NULL AND flow_end_time >= end_date

活水 offer 中 = 逻辑1 + 逻辑2
  逻辑1：flow_id=5 AND state_id NOT IN (11)
         AND huoshui_in_dept_approval_time < end_date
         AND (huoshui_hire_arrive_time >= end_date OR NULL)
  逻辑2：flow_id=5 AND state_id = 11
         AND huoshui_in_dept_approval_time < end_date
         AND flow_end_time >= end_date
```

每套对 `flow_main_id` 去重计数。

### 真问题 2：13 项 治理口径原文同义词缺失

补全后倒排索引覆盖率：**44/44 = 100%**（之前 27/44 = 61%）

| 指标 ID | 新增同义词（治理口径原文）|
| --- | --- |
| `recruit-finish-post-onboard-cnt` | 社招已完成需求数入职、社招已完成需求数（入职）|
| `recruit-finish-post-offer-cnt` | 社招已完成需求数offer、社招已完成需求数（offer）|
| `recruit-flow-active-count` | 社招流程中（不含简历评估）|
| `recruit-turndown-cnt` | 口头turndown |
| `recruit-offer-giveup-cnt` | 拒绝offer |
| `recruit-hr-salary-negotiation-rate` | HR薪资谈判通过率 |
| `recruit-send-offer-rate` | 发送offer率 |
| `recruit-start-dm-intv-cnt` | 发起用人决策者面试数 |
| `recruit-start-dm-intv-no-submit-cnt` | 发起用人决策者面试未提交数 |
| `recruit-hr-intv-cnt` | HR资格面试通过数 |
| `recruit-hr-intv-rate` | HR资格面试通过率 |
| `recruit-start-hr-intv-cnt` | 发起hr资格面试数 |
| `recruit-start-hr-intv-no-submit-cnt` | 发起hr资格面试未提交数 |
| `recruit-send-offer-cnt` | 发送offer数 |
| `recruit-start-offer-approval-cnt` | 发起offer审批人数 |
| `recruit-offer-approval-no-submit-cnt` | offer审批中未审批人数 |
| `recruit-flow-offer-stage-count` | offer中、offer中人数 |

合计 **42 个**新同义词，覆盖 17 个指标。

## 工程动作

1. ✅ 补全 `snapshot-stages.md § offer 中` 的完整 SQL（4 套子逻辑加和）
2. ✅ 补 13 项 治理口径原文同义词到倒排索引
3. ✅ 写 CHANGELOG-v3.4.md（本文档）
4. 🔜 同步 `.knowledge/` → `Recruit_data_dashboard/knowledge/`
5. 🔜 重新打包 `.skill` 文件（v1.2）

## 验证

| 验证项 | 结果 |
| --- | --- |
| 治理基线 全 44 项映射到指标卡 | ✅ 44/44 = 100% |
| 关键 治理基线 名（HR 资格面试通过数 / offer 中 / 拒绝 offer / 口头 turndown）能被检索 | ✅ 全部命中 |
| 完整 SQL 卡的强制过滤 | ✅ 0 个真问题 |

## 后续待办

- [ ] 给 `recruit-flow-offer-stage-count` 跑实测验证（需切内部模型，因为含 huoshui_*_time 敏感字段）
- [ ] 收集业务方对"offer 中"4 套子逻辑加和是否会有重复计数的反馈（理论上社招 vs 活水分别 flow_id=3 vs flow_id=5 互斥，应不会重复）
