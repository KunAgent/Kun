# 原子指标层 atomic/

> **定义**：单表 + 单聚合表达式 + 无任何依赖。
> **特点**：最稳定、最可复用、所有上层指标的源头。

> ⚠️ **v3.1 决策（2026-06-09）**：国家筛选**不再是强制过滤**，改为动态参数 `:location_country_name`（默认 `'%中国%'`，可切 `'%亚太%'`、`'%全球%'` 等）。详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md) #6。

## 招活-社招原子指标清单（25 个，按业务过程分组）

| 业务过程节点 | 文件 | 数量 |
| --- | --- | --- |
| 简历评估 | [`recruit-social/resume-assess-count.md`](./recruit-social/resume-assess-count.md) | 2 |
| 面试节点（5 类面试通过 + 总发起 + 5 类面试发起） | [`recruit-social/interview-count.md`](./recruit-social/interview-count.md) | 13 |
| HR 薪资谈判 | [`recruit-social/salary-negotiation-count.md`](./recruit-social/salary-negotiation-count.md) | 3（薪谈通过/发起/未提交） |
| Offer 节点 | [`recruit-social/offer-count.md`](./recruit-social/offer-count.md) | 4（审批中/审批未提交/发送/审批发起） |
| 入职 | [`recruit-social/entry-count.md`](./recruit-social/entry-count.md) | 1 |
| 放弃/拒绝 | [`recruit-social/giveup-count.md`](./recruit-social/giveup-count.md) | 2（口头 turndown / 拒 offer） |

> **关于"招聘岗位"**：在招需求数（`recruit-on-going-post-count`）使用 `T_POST` 的 `person_count` 字段 + `T_FLOW` 子查询作为内部组件，但这些组件**不是独立指标**（治理基线未定义），故 atomic 层不为其建卡。该指标完整定义见 [`derived/recruit-social/on-going-post.md`](../derived/recruit-social/on-going-post.md)。

## 通用约定

- **强制过滤**：所有 `T_FLOW`/`T_ASSESS` 表的原子指标必带 `staff_type_id = '2' AND flow_id = 3`
- **时间占位符**：`:begin_date` / `:end_date` / `:next_date`
- **统计口径**：原子指标全部为「人次」，**不去重**（同一候选人多次流程会被多次计算）

## 指标卡的标准模板

每张原子指标卡包含：

```markdown
### {{中文名}} `{{metric-id}}`

| 元数据 | 值 |
|---|---|
| ID | recruit-xxx-cnt |
| 类型 | atomic |
| 业务过程 | xxx |
| 数据源 | T_FLOW |
| 关键字段 | is_xxx, xxx_time |
| 统计口径 | 人次 |
| 时间字段 | xxx_time |
| 强制过滤 | staff_type_id='2' AND flow_id=3 |
| 同义词 | xxx, xxx |
| 业务负责人 | 招活产研 |
| 接入时间 | 2026-06-07 |

**业务定义**：xxx

**核心表达式（v3.0 推荐 - DISTINCT 口径）**：
```sql
COUNT(DISTINCT CASE WHEN is_xxx = '是'
                     AND xxx_time >= :begin_date
                     AND xxx_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
                THEN flow_main_id END)
```

**v2.x 历史表达式（SUM CASE 人次口径，兼容保留）**：
```sql
SUM(CASE WHEN is_xxx = '是'
         AND xxx_time >= :begin_date
         AND xxx_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
    THEN 1 ELSE 0 END)
```

**血缘下游**（被哪些复合/派生指标引用）：
- `recruit-xxx-rate`（C 组比率分子）

**备注**：xxx
```
