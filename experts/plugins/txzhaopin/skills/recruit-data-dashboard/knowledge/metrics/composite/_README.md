# 复合指标层 composite/

> **定义**：基于 ≥2 个原子/派生指标做四则运算（含比率、加法、平均）。
> **特点**：必须显式声明 `depends_on`，否则口径漂移；分母兜底处理是必备项。

## 招活-社招复合指标清单（11 个）

| 文件 | 指标数量 | 说明 |
| --- | --- | --- |
| [`recruit-social/funnel-rates.md`](./recruit-social/funnel-rates.md) | 9 | 漏斗通过率（C1-C9） |
| [`recruit-social/total-demand.md`](./recruit-social/total-demand.md) | 1 | 总需求数（A2，加法） |
| [`recruit-social/avg-recruit-days.md`](./recruit-social/avg-recruit-days.md) | 1 | 社招平均招聘天数（A5） |

## 治理约束

### 1. 必须显式声明 `depends_on`

```yaml
depends_on:
  numerator: [recruit-entry-cnt]                    # 分子原子指标
  denominator: [recruit-send-offer-cnt]             # 分母原子指标
```

### 2. 分母兜底（防除零）

所有比率指标都用：
```sql
COALESCE(
  CASE WHEN <分母> <> 0
    THEN CAST(<分子> AS DECIMAL) / <分母>
    ELSE 0
  END, 0
)
```

### 3. 时间窗与维度的一致性约束

⚠️ **重要**：分子分母**必须用同一时间窗 + 同一过滤条件**，否则会出现"率 > 100%"或"率为负"的脏数据。

### 4. 跨指标依赖的 SQL 拼装

复合指标本身**不写完整 FROM**（避免与原子指标的 SQL 重复）。
执行时由 SQL 拼装层（`recipes/`）把原子指标 SQL 包成 CTE，再在外层做四则运算。

### 5. 复合指标卡的额外字段

| # | 字段 | 说明 |
| --- | --- | --- |
| 12 | depends_on | 依赖原子指标 ID 列表 |
| 13 | 公式 | 业务公式表达 |
| 14 | 兜底逻辑 | 异常情况处理 |
