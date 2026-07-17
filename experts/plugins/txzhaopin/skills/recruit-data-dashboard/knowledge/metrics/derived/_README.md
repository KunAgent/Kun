# 派生指标层 derived/

> **定义**：含子查询、跨表 JOIN、时点状态快照等复杂逻辑的指标。
> **特点**：复杂度最高，使用前必须看「血缘」+「时点语义」+「JOIN 关系」。

## 招活-社招派生指标清单（8 个）

| 文件 | 指标数量 | 说明 |
| --- | --- | --- |
| [`recruit-social/on-going-post.md`](./recruit-social/on-going-post.md) | 1 | 在招需求数（含 register_cnt 子查询） |
| [`recruit-social/finished-demand.md`](./recruit-social/finished-demand.md) | 2 | 已完成需求数（入职 / offer 两版本） |
| [`recruit-social/snapshot-stages.md`](./recruit-social/snapshot-stages.md) | 5 | 流程状态快照（全流程中/评估中/面试中/offer中/入职中） |

## 派生指标的治理特点

### 1. 时点语义 vs 区间语义

| 类型 | 语义 | 例子 |
| --- | --- | --- |
| **时点快照** | 截至 :end_date 当时的状态人数 | "面试中"=此刻还在面试的人 |
| **区间累计** | :begin_date ~ :end_date 之间发生的事件人次 | "入职数"=这段时间入职的人 |

派生指标常常**混合两种语义**，必须显式标注。

### 2. 子查询的依赖（字段级，不是指标级）

`recruit-on-going-post-count`（在招需求数）含一个 `register_cnt` 子查询。
**该子查询是字段/逻辑层组件，不是独立指标**——治理基线未将其定义为独立指标，因此治理库不为其建卡。
派生指标卡内显式描述子查询逻辑即可（见 [`on-going-post.md`](./recruit-social/on-going-post.md)）。

> 治理纪律：派生指标的"组件"是字段/子查询，不是独立指标。不要凭空创造原档中不存在的指标 ID。

### 3. 跨表 JOIN 的 JOIN 字段

| 主表 | JOIN 表 | JOIN 字段 |
| --- | --- | --- |
| `T_FLOW` | `T_POST` | `t1.post_id = t2.recruit_post_id` |
| `T_FLOW` | `T_ASSESS` | `t1.resume_assess_flow_main_id = t2.flow_main_id` |

### 4. 字段级使用约束（实测沉淀）

| 字段 | 注意事项 |
| --- | --- |
| `T_POST.is_disabled` | 🔴 **不能放 WHERE**（服务端会拦截过滤导致 0 行）。判断逻辑须放到 `CASE WHEN` 内（实测 2026-06-07） |
| `T_FLOW.staff_type_id` | 必须等于 `'2'`（字符串） |
| `T_FLOW.flow_id` | `3` = 社招，`5` = 活水 |
| `T_FLOW.state_id` | `5/6` = 社招"放弃"类，`11` = 活水"放弃"类 |
