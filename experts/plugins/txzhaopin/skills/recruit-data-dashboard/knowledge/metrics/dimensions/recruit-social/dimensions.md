# 招活-社招维度定义

> 本文件定义**`GROUP BY` 切片轴**（数据展开维度）。
>
> ⚠️ **关键边界**：维度（GROUP BY）≠ 运行时筛选参数（WHERE）。
> - 「我要按渠道分组看转化率」→ 用本文件的维度，写在 `GROUP BY`
> - 「我要只看某一个渠道的数据」→ 用 [`filter-parameters.md`](./filter-parameters.md) 的参数，写在 `WHERE`
>
> 同一个字段（如 `channel_id`）**既可作维度又可作筛选**，但二者职责不同：
> - 作维度：`GROUP BY t1.channel_id, t1.channel_name`（不进 WHERE）
> - 作筛选：`AND t1.channel_id LIKE :channel_id`（不进 GROUP BY）
> - **同时使用**也合法（如"按渠道分组 + 只看某一类渠道"）

## 维度速查表

| 维度 ID | 中文名 | 来源字段 | 默认值 | GROUP BY 写法 |
| --- | --- | --- | --- | --- |
| `dim-org` | 组织维度 | `t1.recruit_post_belong_org_full_name`<br>或 `t1.recruit_post_org_full_name`（v3.1 新增）<br>或 `t2.recruit_post_org_full_path` | 全部 | 见下方 |
| `dim-post` | 岗位维度 | `t1.post_id`、`t1.post_name_cn` | 全部 | `GROUP BY t1.post_id, t1.post_name_cn`（v3.1 删除 `is_secret_post`、`recruit_post_org_id_cb`）|
| `dim-recruit-owner` | 招聘经理维度 | `t1.recruit_owner_id`、`t1.recruit_owner` | 全部 | `GROUP BY t1.post_id, t1.recruit_owner_id, t1.recruit_owner` |
| `dim-channel` | 招聘渠道维度 | `t1.channel_id`、`t1.channel_name` | 全部 | `GROUP BY t1.channel_id, t1.channel_name` |
| `dim-country` | 工作地国家维度 | `t1.location_country_name` | `LIKE '%中国%'` | `GROUP BY t1.location_country_name` |
| `dim-position-family` | 职位族维度 | `t1.position_family_name`（待校验字段名） | 全部 | `GROUP BY t1.position_family_name` |

---

## 1. `dim-org` 组织维度

**字段**：
- `T_FLOW.recruit_post_belong_org_full_name`：岗位归属组织全路径中文名
- `T_POST.recruit_post_belong_org_full_name`：同上（招聘岗位表）

**WHERE 筛选**（按部门）：
```sql
AND t2.recruit_post_belong_org_full_name LIKE '%TEG技术工程事业群%'
```

**GROUP BY**（按组织全路径每一层展开，PostgreSQL/Trino 风格）：
```sql
SELECT split_value AS org_full_name, COUNT(*) AS metric_value
FROM (
  SELECT t1.*, t2.recruit_post_belong_org_full_name
  FROM ... JOIN ... WHERE ...
) base
LATERAL VIEW EXPLODE(SPLIT(recruit_post_belong_org_full_name, '/')) tab AS split_value
WHERE split_value IS NOT NULL AND split_value != ''
GROUP BY split_value
LIMIT 1000;
```

**StarRocks 等价语法**（实测时需校准方言）：
- StarRocks ≥ 2.5：`UNNEST(SPLIT_TO_ARRAY(recruit_post_belong_org_full_name, '/'))`
- StarRocks < 2.5：`LATERAL VIEW EXPLODE(SPLIT(...))`

---



### ⚠️ v3.1 决策（2026-06-09）：组织维度新增 `recruit_post_org_full_name`

治理基线 新版要求按 `recruit_post_org_full_name`（流程表的岗位组织全路径中文名）做 GROUP BY。

**新版推荐写法**：
```sql
-- 仅按组织名分组（不展开路径每层）
GROUP BY recruit_post_org_full_name

-- 或按全路径每层展开（如需多级钻取）
GROUP BY recruit_post_org_full_path  -- T_POST 表字段
```

适用所有非"有简历评估面试数"的指标。

---

## 2. `dim-post` 岗位维度

**字段**：
- `T_FLOW.post_id`、`T_FLOW.post_name_cn`


> ⚠️ **v3.1 决策（2026-06-09）**：岗位维度从 v3.0 的
> `GROUP BY t1.post_id, t1.post_name_cn, is_secret_post, recruit_post_org_id_cb`
> 简化为 `GROUP BY t1.post_id, t1.post_name_cn`
> （删除 `is_secret_post` 和 `recruit_post_org_id_cb`，理由：维度更清晰，且这两个字段不是用户直接关心的切片轴）


**GROUP BY**：
```sql
GROUP BY t1.post_id, t1.post_name_cn
```

**WHERE 筛选**（指定岗位）：
```sql
AND t1.post_id = ':post_id'
```

---

## 3. `dim-recruit-owner` 招聘经理维度

**字段**：
- `T_FLOW.recruit_owner_id`、`T_FLOW.recruit_owner`

**GROUP BY**（与岗位联合）：
```sql
GROUP BY t1.post_id, t1.recruit_owner_id, t1.recruit_owner
```

**注意**：通常招聘经理维度是**与岗位联合**的（即"岗位 × 招聘经理"），因为同一岗位可能有多个招聘经理。

**WHERE 筛选**：
```sql
AND t1.recruit_owner_id = ':recruit_owner_id'
```

---

## 4. `dim-channel` 招聘渠道维度

**字段**：
- `T_FLOW.channel_id`、`T_FLOW.channel_name`

**GROUP BY**：
```sql
GROUP BY t1.channel_id, t1.channel_name
```

**WHERE 筛选**：
```sql
AND t1.channel_id = ':channel_id'
```

---

## 5. `dim-country` 工作地国家维度

**字段**：`T_FLOW.location_country_name`

**默认强制过滤**：所有招活-社招指标默认 `LIKE '%中国%'`（仅看国内口径）。

**GROUP BY**：
```sql
GROUP BY t1.location_country_name
```

**WHERE 筛选**（切换到全球口径）：
```sql
-- 默认（国内）
AND t1.location_country_name LIKE '%中国%'

-- 切换全球
-- 去掉本条 WHERE
```

---

## 6. `dim-position-family` 职位族维度（TODO）

**字段**：待校验，可能在 `T_FLOW.position_family_name` 或需 JOIN 其他表。

**待办**：
- [ ] 通过 `Report_Recruit_Flow_Detail.json` 字段元数据确认职位族字段名
- [ ] 如不在此表，需补充 JOIN 关系

---

## 时间维度（特殊维度）

时间不算"业务维度"，但所有指标都需要时间窗。本治理库统一使用占位符：

| 占位符 | 含义 | 默认值 |
| --- | --- | --- |
| `:begin_date` | 统计开始日期 | YTD：当年 1 月 1 日 |
| `:end_date` | 统计截止日期 | 昨天（T-1） |
| ~~`:next_date`~~ | ~~`:end_date + 1 day`~~ | 🚫 **v3.0 已删除**：直接用 `DATE_ADD(:end_date, INTERVAL 1 DAY)` 表达式替代 |

**前端动态计算**：
```sql
SET :begin_date = DATE_FORMAT(CURRENT_DATE, '%Y-01-01');
SET :end_date   = DATE_SUB(CURRENT_DATE, INTERVAL 1 DAY);
-- v3.0：不再使用 :next_date 占位符；时点边界直接用 DATE_ADD(:end_date, INTERVAL 1 DAY)
```

或在调用处直接做日期算术：
```sql
WHERE start_intv_time >= DATE_FORMAT(CURRENT_DATE, '%Y-01-01')
  AND start_intv_time <  CURRENT_DATE
```
