# CHANGELOG v3.8（2026-06-11）

## 触发来源
用户提出 *"所有的 card 规则，是不是都没有跟指标规则保持一致，请以单指标规则为标准，再重新确认一次是否存在逻辑不一致的地方"* 后，做了一次系统性的 card vs 治理基线 单指标规则对账。

## 🔑 核心发现：v3.0 ~ v3.7 一直误读了 治理基线 的 end_date 语义

### 真相

治理基线每个 end_date 字段的注释都明确写着：

> **`end_date`（默认是昨天+1天，如果用户有指定日期，则替换为指定日期+1天）**

→ 治理基线 中的 `:end_date` **不是**用户原始输入的日期，而是**已经 +1 天后的值**！

### 正确的 治理基线 ↔ SQL 映射规则

| 治理口径原文 | SQL 等价写法（:end_date 是用户原始日期） |
|---|---|
| 治理基线 `< end_date` | SQL `< DATE_ADD(:end_date, INTERVAL 1 DAY)` |
| 治理基线 `<= end_date` | SQL `<= DATE_ADD(:end_date, INTERVAL 1 DAY)` |
| 治理基线 `>= end_date` | SQL `>= DATE_ADD(:end_date, INTERVAL 1 DAY)` |
| 治理基线 `> end_date` | SQL `> DATE_ADD(:end_date, INTERVAL 1 DAY)` |
| 治理基线 `:begin_date` | SQL `:begin_date`（**begin_date 不 +1 天**）|

### 历史误读

v3.0 ~ v3.7 的实现把 治理基线 `XXX_time >= end_date OR NULL` **误写**为 SQL `XXX_time > DATE_ADD(:end_date, 1) OR NULL`。

差异：
- 正确：`>= DATE_ADD(end,1)` — 含 (用户日期+1) 当天结束流程的人 = 截至用户日期仍未结束
- 误读：`> DATE_ADD(end,1)` — 漏算 (用户日期+1) 当天结束流程的人

业务影响：所有 A6/A8/A9/A10/A11 的"流程中"快照指标都会**漏算 1 天的人头**。

---

## 修订内容

### 1. SKILL.md 加 v3.8 核心铁律

新增章节「**v3.8 新增核心铁律 — 治理口径 end_date 已 +1 天，必读必记**」，含：
- 治理基线 ↔ SQL 4 种关系算符的映射表
- 反例对照（v3.7 之前的常见误读）
- 自检口诀（不要"善意推测"或"试图统一"）

### 2. 重写 card-A § A3-A12 大 SQL（最关键修订）

按 治理基线 Row 4-14 全量重写：

| 指标 | 主要修订 |
|---|---|
| A3 入职数 | ✅ 之前已对，无需改 |
| A4 offer 数 | ✅ 之前已对（治理基线 写 `>` 是 `>`，不是 `>=`） |
| A5 平均招聘天数 | ✅ 同 A3 |
| A6 流程中(除评估) | 🔴 `flow_end_time > DATE_ADD(end,1) OR NULL` → `>= DATE_ADD(end,1) OR NULL`；**新增 flow_id=3/5 显式区分** |
| A7 评估中(活水分量) | ✅ v3.7 已修方向，v3.8 复审无误 |
| A8 面试中 | 🔴 3 处 `OR NULL` 字段方向反；**新增 flow_id=3/5 显式区分** |
| A9 offer 中 | 🔴 **整段重写**：补全 4 套子逻辑（社招 2 + 活水 2），把误用的 `start_huoshui_out_first_approval_time` 改回正确的 `huoshui_in_dept_approval_time` |
| A10 入职中 | 🔴 `hire_date / flow_end_time` 多处 `OR NULL` 方向反 |
| A11 口头 turndown | ✅ 区间型，无需改 |
| A12 拒绝 offer | ✅ 同 A11 |

t1 子查询新增字段：`start_hr_salary_negotiation_time`（A9 社招分支需要）

### 3. card-B / card-D 修订 1 处

`start_offer_approval_time <= DATE_ADD(:end_date, 1)` → `<` 

按 治理基线 Row 44/45 原档「`start_offer_approval_time < end_date`」修正。原 `<=` 多包含了 (用户日期+1) 当天的数据。

### 4. 加回归规则 R7

`scripts/regression_check.py` 新增 R7 规则：
- 自动扫描所有 SQL 块，识别 `XXX_time > DATE_ADD(:end_date, 1) OR XXX_time IS NULL` 这种"OR NULL 配 `>` "的误读模式
- 已知合法豁免：`process_time`（治理基线 Row 25 渠道收到简历未评估数明确用 `>`）
- 自检验证：故意错写时退出码 1，恢复后退出码 0

新增 R6.6：SKILL.md 必须含 v3.8 治理口径 end_date 映射铁律。

---

## 🛡 规则集累计：7 类

| Rule | 检查内容 |
|---|---|
| R1 | SQL 语法（时间方向/聚合/is_xxx 中文值）|
| R2 | 完整 SQL 卡的强制过滤（含 9 个子规则）|
| R3 | 跨表 JOIN 子查询模式 |
| R4 | 卡顶元数据完整性 |
| R5 | 治理基线 全 44 项指标 100% 映射 |
| R6 | SKILL.md 含 v3.x 沉淀的关键原则（含 R6.6 v3.8 铁律）|
| R7 | 时点 OR NULL 字段方向（v3.8 治理口径 end_date 映射）|

---

## 业务影响估算

修订后 card-A 的以下指标**数值会上升**（补回漏算的 1 天人头）：
- A6 流程中(除评估)
- A8 面试中
- A9 offer 中（量级最大，因为之前社招分支整段缺失）
- A10 入职中

A11/A12/A3/A4/A5 不变。需要切内部模型实测对比 v3.7 vs v3.8 数值差异。

---

## 累计版本历史

| 版本 | 关键修订 |
|---|---|
| v3.0 | 聚合方式（DISTINCT）+ 字段勘误（is_xxx='是'）|
| v3.1 | 国家从固定改为动态参数 + 维度调整 |
| v3.2 | 时点边界翻转 + 渠道收到评估数口径 |
| v3.3 | TEG 在招需求数 6917→336 重大 bug 修复 |
| v3.4 | 5 张缺卡补齐 + 42 同义词补全 + offer 中卡完整化 |
| v3.5 | 4 张原子卡 + 1 张复合卡的卡顶国家/管理主体声明 + SKILL.md 全局铁律 |
| v3.6 | card-A T_POST 子查询补 recruit_staff_type_name + R2.9 |
| v3.7 | 评估中 A7 整段社招分支补全 + 方向修正 |
| **v3.8** | **治理口径 end_date 映射铁律 + card-A 全量重写 + R7 回归规则** |

---

## 📝 v3.8 后续补充（2026-06-11 18:30）

用户提示"再确认是否都已经改完了"后，又发现 v3.8 第一轮修订有遗漏：

### 后续发现 + 修复

| # | 文件 | 问题 | 修复 |
|---|---|---|---|
| 1 | `recipes/card-A § A3` | `hire_date <= :end_date` (×2) | 改为 `<= DATE_ADD(:end_date, 1)` |
| 2 | `recipes/card-A § A5` | `hire_date <= :end_date` 同 huoshui_transfer_date (×2) | 改为 `<= DATE_ADD(:end_date, 1)` + 加 Row 6 笔误说明 |
| 3 | `recipes/card-B § B6` (废弃) | `COALESCE(offer_approval_time, ...) >= :end_date` 不在 治理基线中 | 软删除：改为 `WHEN 1=0 THEN flow_main_id END` |
| 4 | `recipes/card-D § B6` 同上 | 同上 | 同上 |
| 5 | `atomic/resume-assess-count.md § 2 渠道收到评估数` | `flow_end_time < :end_date` 未扩天 + `flow_end_time IS NULL` 写错（应为 `process_time IS NULL`）| 修订两处 |
| 6 | `atomic/resume-assess-count.md § 3 渠道收到简历未评估数` | v3.7 错改的 `process_time > :end_date` | 恢复为 `> DATE_ADD(:end_date, 1)`（v3.8 铁律下与 治理基线 等价）|
| 7 | `composite/avg-recruit-days.md` | `hire_date <= :end_date` (×2) | 改为 `<= DATE_ADD(:end_date, 1)` |
| 8 | `derived/on-going-post.md` | 3 处 `:end_date` 直接用 | 自动批量改为 `DATE_ADD(:end_date, 1)` |
| 9 | `derived/snapshot-stages.md` | **24 处** `:end_date` 直接用（这是隐患重灾区）| 自动批量改 |
| 10 | `derived/finished-demand.md` | 6 处 `:end_date` 直接用 | 自动批量改 |

### 防御加强：R7.2 新规则

`scripts/regression_check.py § R7.2` 新增检测："任何 `XXX_time OP :end_date`（未扩 1 天）的直接写法"。

### 最终扫描结果

| 维度 | 状态 |
|---|---|
| 所有 metrics 目录下 SQL 中残留的 `:end_date` 直接用 | **0 处** ✅ |
| R1-R7 全部 7 类规则 | **全部 PASS** ✅ |
| 仅剩合法豁免（process_time `>` Row 25 区间型）| 2 处（已在豁免名单）|

**这次的全量审计累计修订了 v3.8 共 ~50 处真问题**（第一轮 9 处 + 第二轮 41 处）。
