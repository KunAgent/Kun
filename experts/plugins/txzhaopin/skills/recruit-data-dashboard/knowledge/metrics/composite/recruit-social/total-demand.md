# 总需求数（复合指标，加法）

> **支持的运行时筛选参数**：与两个加数（`recruit-on-going-post-count` + `recruit-finish-post-onboard-cnt`）的并集一致；详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md)。
> ⚠️ 由于两个加数时间口径不同（前者"截至时点"，后者"区间内"），运行时参数 `:next_date` 与 `:begin_date/:end_date` 都需要传入。
>
> 🔄 **v3.0 口径变化（2026-06-08，对齐 治理基线 新版）**：
> - **聚合方式**：`SUM(CASE WHEN ... THEN 1 ELSE 0 END)`（人次）→ **`COUNT(DISTINCT CASE WHEN ... THEN flow_main_id END)`**（按 flow_main_id 去重）
> - **管理主体筛选**：从 `manager_unit_id = '10101'` 改为 **`manager_unit_name_cn = '腾讯集团本部'`**（中文名直接匹配）
> - **国家筛选**：从「固定过滤」→ **「动态参数」**（默认 `'%中国%'`，可切全球）
> - **`:next_date` 占位符已删除**：直接用 `DATE_ADD(:end_date, INTERVAL 1 DAY)` 表达式替代
> - 详见 [`filter-parameters.md`](../../dimensions/recruit-social/filter-parameters.md) v3.0 章节

## 总需求数 `recruit-total-post-count`

| 元数据 | 值 |
| --- | --- |
| ID | `recruit-total-post-count` |
| 类型 | composite（加法） |
| 业务过程 | 需求与岗位 |
| 统计口径 | 人数（HC 数 + 已完成需求数） |
| 同义词 | 总岗位数、需求总量 |

**业务定义**：截至 :end_date 的招聘需求总量 = 当前在招需求 + 已完成需求（入职）。

**公式**：
```
总需求数 = 在招需求数 + 已完成需求数（入职）
```

**depends_on**：
- 加数 1：`recruit-on-going-post-count`（在招需求数，派生指标）
- 加数 2：`recruit-finish-post-onboard-cnt`（已完成需求数入职，派生指标）

**实现方式**：

✅ **推荐：前端层做加法**（无需独立 SQL）：
```js
const totalPostCount = onGoingPostCount + finishPostOnboardCnt;
```

❌ **不推荐**：在 SQL 中重复定义。理由：两个加数原子定义已存在，重复会引发口径漂移。

**注意事项**：
- 时间口径：`recruit-on-going-post-count` 是"截至时点状态"，`recruit-finish-post-onboard-cnt` 是"区间内"，两者**口径不一致**
- 因此本指标的语义是"时间窗内的累计需求"（含未完成 + 已完成入职两类），与 BI 看板上的"YTD 总需求"语义一致
- ⚠️ 不要把它理解为"瞬时存量需求"
