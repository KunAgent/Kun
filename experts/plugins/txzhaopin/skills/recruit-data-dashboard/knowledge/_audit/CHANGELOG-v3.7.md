# CHANGELOG v3.7（2026-06-11）

## 触发来源
用户精读 card-A § A7 评估中 SQL 截图，识别出 3 个问题（数据源缺失、方向反、混入活水语义）。

---

## 🔴 重大修订 1：评估中（A7）的整段社招分支缺失

### 问题
**治理基线 Row 9「评估中」明确**：

```
评估中人数 = 社招评估中人数 + 活水评估中人数
```

| 子分量 | 来源表 | 关键字段 | 筛选条件 |
| --- | --- | --- | --- |
| 社招评估中 | T_ASSESS = `Report_Recruit_Resume_Assessment` | `arrive_time` / `process_time` | `arrive_time < end_date` AND (`process_time >= end_date` OR NULL) |
| 活水评估中 | T_FLOW = `Report_Recruit_Flow_Detail` | `start_huoshui_resume_assess_time` / `huoshui_resume_assess_time` | `start_huoshui_resume_assess_time < end_date` AND (`huoshui_resume_assess_time >= end_date` OR NULL) |

但 **v3.6 之前的 SQL** 只实现了"活水分量"，整个社招分支完全缺失。还在 `snapshot-stages.md` 加了一段错误的注释「BI 团队实测覆盖了社招简历评估场景」—— 这是错误判断。

### 影响

- A7「评估中」实际**只算了活水评估中**的人数
- **整个社招简历评估漏斗最前端的所有候选人全部丢失**（量级很大，社招简历评估是入口环节）
- A6.5「社招流程中总人数（含简历评估）」= A6 + A7 → 因 A7 偏低，A6.5 也偏低

### 修订

#### 修订 1.1：`snapshot-stages.md § 2 评估中`

- 重写整段卡，类型从"片段卡"改为"完整 SQL 卡"
- 完整化为两个独立子查询加和（社招用 T_ASSESS、活水用 T_FLOW）
- 强制过滤齐全（location_country_name + manager_unit_name_cn）

#### 修订 1.2：`card-A-demand-overview.md § A7`

A3-A12 大 SQL 的 FROM 是 `T_FLOW INNER JOIN T_POST`，**无法直接拼入 T_ASSESS 数据**。采用与 A1/A2 相同的"独立 SQL + 前端加法"模式：

- A3-A12 大 SQL 内的 A7 仅算**活水分量**，字段名改为 `flow_evaluating_huoshui_cnt`
- 新增「## A7 评估中拆分说明」章节，含 A7_社招独立 SQL（查 T_ASSESS）
- 前端做加法：`a7_total = flow_evaluating_huoshui_cnt + flow_evaluating_shezhao_cnt`
- 更新 A6.5 加法说明，强调要用 A7 总数而不是单独活水分量

---

## 🔴 重大修订 2：活水分支时点方向反了

### 问题

```sql
-- 修订前（错）：
huoshui_resume_assess_time > DATE_ADD(:end_date, INTERVAL 1 DAY) OR IS NULL

-- 治理基线要求：
huoshui_resume_assess_time >= end_date OR 为空
```

差异：现 SQL 多卡 1 天 + 用 `>` 不含等号，会**漏算"今天处理完成"和"end_date 当天处理"的候选人**。

### 修订

`card-A-demand-overview.md § A7` 改为 `>= DATE_ADD(:end_date, INTERVAL 1 DAY)`（等价于 `> end_date`）。

> ⚠️ 实际上 `>= DATE_ADD(end_date, 1)` 等价于 `> end_date`，本次仅修方向（`>` → `>=` + 调整 +1 day 偏移），保留 v3.0 区间扩 1 天的统一约定。

---

## 🔴 重大修订 3：渠道收到简历未评估数 process_time 方向

### 问题

`atomic/resume-assess-count.md § 3 渠道收到简历未评估数`：

```sql
-- 修订前：process_time > DATE_ADD(:end_date, INTERVAL 1 DAY)
-- 治理基线（Row 25）：process_time > end_date
```

注意：**Row 9 评估中**用 `>=` end_date，**Row 25 未评估数**用 `>` end_date，治理基线 故意写不一样：
- Row 9（时点型快照）：`>=` 含等号 — "截至 end_date 当时仍未处理"
- Row 25（区间型）：`>` 不含等号 — "end_date 之后才会处理"

两者业务语义不同，**不能随意统一**。

### 修订

`atomic/resume-assess-count.md § 3` 改为 `process_time > :end_date OR IS NULL`（去掉 +1 day 偏移）。

并在卡里新增对照说明，明确区分 Row 9（`>=`）和 Row 25（`>`）的语义差异。

---

## 修订内容清单

| 文件 | 修订位置 | 类型 |
|---|---|---|
| `metrics/derived/recruit-social/snapshot-stages.md` | § 2 评估中（整段重写）| 🔴 重大 |
| `metrics/recipes/recruit-social/card-A-demand-overview.md` | § A3-A12 内 A7 + 新增 § A7 拆分说明 + § A6.5 公式更新 | 🔴 重大 |
| `metrics/atomic/recruit-social/resume-assess-count.md` | § 3 渠道收到简历未评估数 | 🔴 重大 |

## 业务影响估算

修订后预计：
- A7「评估中」数值会**显著上升**（补回完整的社招简历评估候选人池），增量量级取决于该期间简历投递量
- 「渠道收到简历未评估数」会**略微上升**（补回当天处理完成的简历份数）
- 「渠道发起面试率」分母变大 → 比率会**略微下降**

需要切内部模型实测对比 v3.6 vs v3.7 数值差异。

---

## 累计版本历史

| 版本 | 关键修订 |
|---|---|
| v3.0 | 聚合方式（DISTINCT）+ 字段勘误（is_xxx='是'） |
| v3.1 | 国家从固定改为动态参数 + 维度调整 |
| v3.2 | 时点边界翻转 + 渠道收到评估数口径 |
| v3.3 | TEG 在招需求数 6917→336 重大 bug 修复 |
| v3.4 | 5 张缺卡补齐 + 42 同义词补全 + offer 中卡完整化 |
| v3.5 | 4 张原子卡 + 1 张复合卡的卡顶国家/管理主体声明 + SKILL.md 全局铁律 |
| v3.6 | card-A T_POST 子查询补 recruit_staff_type_name + 新增 R2.9 回归规则 |
| **v3.7** | **A7 评估中整段社招分支补全 + 活水方向修正 + 区间型 process_time 方向修正** |
